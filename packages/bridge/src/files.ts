/**
 * `@` file search and the restricted read API (docs/DESIGN.md §5, §3.7).
 *
 * Listing prefers `git ls-files` inside a repo and falls back to a walk that
 * skips node_modules/.git. Reads resolve symlinks and refuse anything outside
 * the session cwd; files over 1MB are rejected.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import type { FileHit } from "@omp-ui/protocol";

const MAX_FILE_BYTES = 1024 * 1024;
const WALK_MAX_ENTRIES = 20_000;
const GIT_TIMEOUT_MS = 5_000;
const SEARCH_LIMIT = 50;
const SKIP_DIRS: Record<string, true> = {
	node_modules: true,
	".git": true,
	".hg": true,
	".svn": true,
};

/** Subsequence fuzzy match; higher is better, -1 = no match. */
export function fuzzyScore(query: string, candidate: string): number {
	const q = query.toLowerCase();
	const c = candidate.toLowerCase();
	if (q.length === 0) return 0;
	let score = 0;
	let streak = 0;
	let qi = 0;
	for (let ci = 0; ci < c.length && qi < q.length; ci++) {
		if (c[ci] !== q[qi]) {
			streak = 0;
			continue;
		}
		streak++;
		score += 1 + streak * 3;
		// bonus for matches at path boundaries
		if (ci === 0 || c[ci - 1] === "/" || c[ci - 1] === "\\" || c[ci - 1] === "." || c[ci - 1] === "-")
			score += 5;
		qi++;
	}
	if (qi < q.length) return -1;
	return score - c.length * 0.01; // prefer shorter paths
}

export function toFileHit(relativePath: string): FileHit {
	const normalized = relativePath.split("\\").join("/");
	const slash = normalized.lastIndexOf("/");
	const name = slash === -1 ? normalized : normalized.slice(slash + 1);
	return {
		path: normalized,
		dir: slash === -1 ? "" : normalized.slice(0, slash),
		name,
	};
}

async function gitLsFiles(cwd: string): Promise<string[] | null> {
	let proc;
	try {
		proc = Bun.spawn(["git", "-C", cwd, "ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
			stdout: "pipe",
			stderr: "ignore",
		});
	} catch {
		return null;
	}
	const result = await Promise.race([
		(async () => {
			const text = await new Response(proc.stdout).text();
			return { code: await proc.exited, text };
		})(),
		Bun.sleep(GIT_TIMEOUT_MS).then(() => null),
	]);
	if (result === null) {
		proc.kill();
		return null;
	}
	if (result.code !== 0) return null;
	return result.text.split("\0").filter(entry => entry.length > 0);
}

async function walkFiles(cwd: string): Promise<string[]> {
	const out: string[] = [];
	const walk = async (dir: string, rel: string): Promise<void> => {
		if (out.length >= WALK_MAX_ENTRIES) return;
		let dirents: fs.Dirent[];
		try {
			dirents = await fs.promises.readdir(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const dirent of dirents) {
			if (out.length >= WALK_MAX_ENTRIES) return;
			const relPath = rel ? `${rel}/${dirent.name}` : dirent.name;
			if (dirent.isDirectory()) {
				if (SKIP_DIRS[dirent.name]) continue;
				await walk(path.join(dir, dirent.name), relPath);
			} else if (dirent.isFile()) {
				out.push(relPath);
			}
		}
	};
	await walk(cwd, "");
	return out;
}

export async function searchFiles(cwd: string, query: string, limit: number = SEARCH_LIMIT): Promise<FileHit[]> {
	const paths = (await gitLsFiles(cwd)) ?? (await walkFiles(cwd));
	const scored: { hit: FileHit; score: number }[] = [];
	for (const rel of paths) {
		const score = fuzzyScore(query, rel);
		if (score >= 0) scored.push({ hit: toFileHit(rel), score });
	}
	scored.sort((a, b) => b.score - a.score);
	return scored.slice(0, limit).map(entry => entry.hit);
}

export interface SessionFileContent {
	path: string;
	content: string;
	sizeBytes: number;
}

export class FileAccessError extends Error {
	readonly code: "outside_cwd" | "not_found" | "too_large";
	constructor(code: FileAccessError["code"], message: string) {
		super(message);
		this.code = code;
	}
}

/** Restricted read: realpath must stay inside the session cwd (§3.7). */
export async function readSessionFile(cwd: string, relPath: string): Promise<SessionFileContent> {
	const cwdReal = await fs.promises.realpath(cwd).catch(() => {
		throw new FileAccessError("not_found", `cwd not found: ${cwd}`);
	});
	const target = path.resolve(cwdReal, relPath);
	const real = await fs.promises.realpath(target).catch(() => {
		throw new FileAccessError("not_found", `file not found: ${relPath}`);
	});
	if (real !== cwdReal && !real.startsWith(cwdReal + path.sep)) {
		throw new FileAccessError("outside_cwd", `path escapes session cwd: ${relPath}`);
	}
	const stat = await fs.promises.stat(real);
	if (!stat.isFile()) throw new FileAccessError("not_found", `not a file: ${relPath}`);
	if (stat.size > MAX_FILE_BYTES) {
		throw new FileAccessError("too_large", `file exceeds 1MB: ${relPath}`);
	}
	const content = await fs.promises.readFile(real, "utf8");
	return { path: path.relative(cwdReal, real).split("\\").join("/"), content, sizeBytes: stat.size };
}

export const FILE_READ_MAX_BYTES = MAX_FILE_BYTES;
