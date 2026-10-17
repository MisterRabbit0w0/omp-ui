/**
 * Session discovery on disk (docs/DESIGN.md §3.5).
 *
 * Root: `$PI_CODING_AGENT_DIR` or `~/.omp/agent`; sessions live under
 * `<root>/sessions/` (`*.jsonl`). Only the first 4KB of each file is read:
 * line 1 is the fixed-width title slot `{"type":"title",title,updatedAt,pad}`,
 * line 2 the session header `{"type":"session",version,id,timestamp,cwd}`.
 * Results are cached by (mtimeMs, size); an `fs.watch` recursive listener
 * (debounced 300ms) broadcasts `sessions_changed`.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AgentMessage, ProjectItem, SessionListItem } from "@omp-ui/protocol";

const HEADER_BYTES = 4096;
const WATCH_DEBOUNCE_MS = 300;
/** Skip absurdly large files in read-only preview. */
const TRANSCRIPT_MAX_BYTES = 256 * 1024 * 1024;

export function defaultAgentDir(env: NodeJS.ProcessEnv = process.env): string {
	if (env.PI_CODING_AGENT_DIR) return env.PI_CODING_AGENT_DIR;
	const profile = (env.OMP_PROFILE ?? env.PI_PROFILE)?.trim();
	return profile
		? path.join(os.homedir(), ".omp", "profiles", profile, "agent")
		: path.join(os.homedir(), ".omp", "agent");
}

export interface SessionHeader {
	id: string;
	cwd: string;
	title: string;
	createdAt: string;
	titleUpdatedAt?: string;
}

/**
 * Parse the first-4KB head of a session file. The title line is a fixed-width
 * slot (padded with spaces in a `pad` field, rewritten in place) — plain
 * JSON.parse handles it. Returns undefined when no session header is found.
 */
export function parseSessionHead(head: string): SessionHeader | undefined {
	const lines = head.split("\n");
	let title: string | undefined;
	let titleUpdatedAt: string | undefined;
	for (const line of lines) {
		if (line.trim().length === 0) continue;
		let entry: unknown;
		try {
			entry = JSON.parse(line);
		} catch {
			continue;
		}
		if (typeof entry !== "object" || entry === null) continue;
		const record = entry as Record<string, unknown>;
		if (record.type === "title") {
			if (typeof record.title === "string") title = record.title;
			if (typeof record.updatedAt === "string") titleUpdatedAt = record.updatedAt;
			continue;
		}
		if (record.type === "session") {
			if (typeof record.id !== "string") return undefined;
			return {
				id: record.id,
				cwd: typeof record.cwd === "string" ? record.cwd : "",
				title: title ?? (typeof record.title === "string" ? record.title : ""),
				createdAt: typeof record.timestamp === "string" ? record.timestamp : "",
				...(titleUpdatedAt !== undefined ? { titleUpdatedAt } : {}),
			};
		}
	}
	return undefined;
}

interface RawEntry {
	id: string;
	parentId?: string | null;
	type?: string;
	timestamp?: string;
	message?: AgentMessage;
}

/**
 * Parse a session jsonl into the current branch's messages (§15.7): the leaf
 * is the last entry that carries an id; follow `parentId` back to the root,
 * keep `message` entries, and return them root → leaf.
 */
export function parseTranscript(content: string): AgentMessage[] {
	const byId = new Map<string, RawEntry>();
	let leafId: string | null = null;
	for (const line of content.split("\n")) {
		const trimmed = line.trim();
		if (trimmed.length === 0 || trimmed.charCodeAt(0) !== 123) continue;
		let entry: unknown;
		try {
			entry = JSON.parse(trimmed);
		} catch {
			continue; // tolerate a truncated tail line mid-write
		}
		if (typeof entry !== "object" || entry === null) continue;
		const record = entry as Record<string, unknown>;
		if (typeof record.id !== "string") continue;
		const raw: RawEntry = {
			id: record.id,
			parentId: typeof record.parentId === "string" ? record.parentId : null,
			...(typeof record.type === "string" ? { type: record.type } : {}),
			...(typeof record.timestamp === "string" ? { timestamp: record.timestamp } : {}),
		};
		if (record.type === "message" && typeof record.message === "object" && record.message !== null) {
			// Validated boundary: the file was written by omp; the AgentMessage union is open.
			raw.message = record.message as AgentMessage;
		}
		byId.set(raw.id, raw);
		leafId = raw.id;
	}
	const messages: AgentMessage[] = [];
	const seen = new Set<string>();
	for (let id = leafId; id !== null && !seen.has(id); ) {
		seen.add(id);
		const entry = byId.get(id);
		if (!entry) break;
		if (entry.type === "message" && entry.message) messages.push(entry.message);
		id = entry.parentId ?? null;
	}
	return messages.reverse();
}

interface CacheEntry {
	mtimeMs: number;
	size: number;
	header: SessionHeader | undefined;
}

export interface SessionScannerOptions {
	/** Agent dir containing `sessions/`; defaults to $PI_CODING_AGENT_DIR or ~/.omp/agent. */
	agentDir?: string;
	isLive?: (sessionId: string) => boolean;
	isRunning?: (sessionId: string) => boolean;
	isArchived?: (sessionId: string) => boolean;
}

export class SessionScanner {
	readonly agentDir: string;
	readonly sessionsDir: string;
	readonly isLive?: (sessionId: string) => boolean;
	readonly isRunning?: (sessionId: string) => boolean;
	readonly isArchived?: (sessionId: string) => boolean;
	#cache = new Map<string, CacheEntry>();
	#watcher: fs.FSWatcher | null = null;
	#debounce: ReturnType<typeof setTimeout> | undefined;

	constructor(options: SessionScannerOptions = {}) {
		this.agentDir = options.agentDir ?? defaultAgentDir();
		this.sessionsDir = path.join(this.agentDir, "sessions");
		if (options.isLive) this.isLive = options.isLive;
		if (options.isRunning) this.isRunning = options.isRunning;
		if (options.isArchived) this.isArchived = options.isArchived;
	}

	async scan(): Promise<SessionListItem[]> {
		const files = await this.#listFiles();
		const items: SessionListItem[] = [];
		for (const file of files) {
			const item = await this.#scanOne(file);
			if (item) items.push(item);
		}
		items.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
		return items;
	}

	async projects(): Promise<ProjectItem[]> {
		const items = await this.scan();
		const byCwd = new Map<string, ProjectItem>();
		for (const item of items) {
			const existing = byCwd.get(item.cwd);
			if (existing) {
				existing.sessionCount++;
				if (item.updatedAt > existing.lastUsedAt) existing.lastUsedAt = item.updatedAt;
			} else {
				byCwd.set(item.cwd, {
					cwd: item.cwd,
					name: path.basename(item.cwd) || item.cwd,
					lastUsedAt: item.updatedAt,
					sessionCount: 1,
				});
			}
		}
		return [...byCwd.values()].sort((a, b) => (a.lastUsedAt < b.lastUsedAt ? 1 : -1));
	}

	/** Resolve a session id to its file, or undefined. */
	async findFile(id: string): Promise<string | undefined> {
		const files = await this.#listFiles();
		for (const file of files) {
			const header = await this.#headerOf(file);
			if (header?.id === id) return file;
		}
		return undefined;
	}

	/** Current branch's messages for a session id (read-only preview, §15.7). */
	async transcript(id: string): Promise<AgentMessage[] | undefined> {
		const file = await this.findFile(id);
		if (!file) return undefined;
		const stat = await fs.promises.stat(file);
		if (stat.size > TRANSCRIPT_MAX_BYTES) return [];
		const content = await fs.promises.readFile(file, "utf8");
		return parseTranscript(content);
	}

	/** Debounced recursive watch; fires `onChange` 300ms after the last event. */
	watch(onChange: () => void): () => void {
		if (this.#watcher || !fs.existsSync(this.sessionsDir)) return () => undefined;
		try {
			this.#watcher = fs.watch(this.sessionsDir, { recursive: true }, () => {
				clearTimeout(this.#debounce);
				this.#debounce = setTimeout(onChange, WATCH_DEBOUNCE_MS);
				this.#debounce.unref?.();
			});
		} catch {
			return () => undefined;
		}
		return () => {
			this.#watcher?.close();
			this.#watcher = null;
			clearTimeout(this.#debounce);
			this.#debounce = undefined;
		};
	}

	close(): void {
		this.#watcher?.close();
		this.#watcher = null;
		clearTimeout(this.#debounce);
		this.#debounce = undefined;
	}

	async #listFiles(): Promise<string[]> {
		const out: string[] = [];
		const walk = async (dir: string, depth: number): Promise<void> => {
			if (depth > 4) return;
			let dirents: fs.Dirent[];
			try {
				dirents = await fs.promises.readdir(dir, { withFileTypes: true });
			} catch {
				return;
			}
			for (const dirent of dirents) {
				const full = path.join(dir, dirent.name);
				if (dirent.isDirectory()) await walk(full, depth + 1);
				else if (dirent.name.endsWith(".jsonl")) out.push(full);
			}
		};
		await walk(this.sessionsDir, 0);
		return out;
	}

	async #headerOf(file: string): Promise<SessionHeader | undefined> {
		let stat: fs.Stats;
		try {
			stat = await fs.promises.stat(file);
		} catch {
			this.#cache.delete(file);
			return undefined;
		}
		const cached = this.#cache.get(file);
		if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.header;
		let header: SessionHeader | undefined;
		try {
			const handle = await fs.promises.open(file, "r");
			try {
				const buffer = Buffer.alloc(HEADER_BYTES);
				const { bytesRead } = await handle.read(buffer, 0, HEADER_BYTES, 0);
				header = parseSessionHead(buffer.toString("utf8", 0, bytesRead));
			} finally {
				await handle.close();
			}
		} catch {
			header = undefined;
		}
		this.#cache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, header });
		return header;
	}

	async #scanOne(file: string): Promise<SessionListItem | undefined> {
		const header = await this.#headerOf(file);
		if (!header) return undefined;
		let stat: fs.Stats;
		try {
			stat = await fs.promises.stat(file);
		} catch {
			return undefined;
		}
		const mtimeIso = new Date(stat.mtimeMs).toISOString();
		return {
			id: header.id,
			file,
			cwd: header.cwd,
			title: header.title,
			createdAt: header.createdAt || mtimeIso,
			updatedAt:
				header.titleUpdatedAt && header.titleUpdatedAt > mtimeIso ? header.titleUpdatedAt : mtimeIso,
			sizeBytes: stat.size,
			live: this.isLive?.(header.id) ?? false,
			running: this.isRunning?.(header.id) ?? false,
			archived: this.isArchived?.(header.id) ?? false,
		};
	}
}
