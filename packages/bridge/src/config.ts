/**
 * Bridge config and trash handling (docs/DESIGN.md §3.6).
 *
 * Config lives at `~/.omp-ui/config.json` (or `$OMP_UI_HOME/config.json`).
 * Deleted sessions move to `<configDir>/trash/` and are purged after 30 days.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { UiConfig } from "@omp-ui/protocol";

const TRASH_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export function defaultConfigDir(env: NodeJS.ProcessEnv = process.env): string {
	return env.OMP_UI_HOME ?? path.join(os.homedir(), ".omp-ui");
}

export class ConfigStore {
	readonly dir: string;
	readonly configPath: string;
	readonly trashDir: string;
	#config: UiConfig;
	/** mtime+size of config.json when `#config` was read/written; a different value means another writer touched it. */
	#signature = "";

	constructor(dir: string = defaultConfigDir()) {
		this.dir = dir;
		this.configPath = path.join(dir, "config.json");
		this.trashDir = path.join(dir, "trash");
		this.#config = this.#load();
	}

	get config(): UiConfig {
		return this.#fresh();
	}

	update(patch: Partial<UiConfig>): UiConfig {
		this.#config = { ...this.#fresh(), ...patch };
		this.#save();
		return this.#config;
	}

	archive(sessionId: string): void {
		const archived = this.#fresh().archived;
		if (archived.includes(sessionId)) return;
		this.update({ archived: [...archived, sessionId] });
	}

	unarchive(sessionId: string): void {
		const archived = this.#fresh().archived;
		if (!archived.includes(sessionId)) return;
		this.update({ archived: archived.filter(id => id !== sessionId) });
	}

	/** Move a session file into the trash. Throws when the source is missing. */
	async moveToTrash(file: string): Promise<string> {
		await fs.promises.mkdir(this.trashDir, { recursive: true });
		const stamp = new Date().toISOString().replace(/[:.]/g, "-");
		const target = path.join(this.trashDir, `${stamp}_${path.basename(file)}`);
		try {
			await fs.promises.rename(file, target);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
			await fs.promises.copyFile(file, target);
			await fs.promises.unlink(file);
		}
		return target;
	}

	/** Delete trashed files older than 30 days. Runs at bridge startup. */
	async purgeTrash(now: number = Date.now()): Promise<number> {
		let purged = 0;
		let names: string[];
		try {
			names = await fs.promises.readdir(this.trashDir);
		} catch {
			return 0;
		}
		for (const name of names) {
			const file = path.join(this.trashDir, name);
			try {
				const stat = await fs.promises.stat(file);
				if (now - stat.mtimeMs <= TRASH_MAX_AGE_MS) continue;
				await fs.promises.rm(file, { force: true, recursive: true });
				purged++;
			} catch {
				// best effort; retry next startup
			}
		}
		return purged;
	}

	/** Current config, re-read only when another omp-ui bridge (or a hand edit) changed the file since we last looked. */
	#fresh(): UiConfig {
		let signature = "";
		try {
			const stat = fs.statSync(this.configPath);
			signature = `${stat.mtimeMs}:${stat.size}`;
		} catch {
			// missing file: fall through with an empty signature
		}
		if (signature !== this.#signature) {
			this.#config = this.#load();
			this.#signature = signature;
		}
		return this.#config;
	}

	/** Parse the file. A missing file means defaults; an unreadable/corrupt one keeps the last good config. */
	#load(): UiConfig {
		let raw: string;
		try {
			raw = fs.readFileSync(this.configPath, "utf8");
		} catch {
			return { archived: [], recentProjects: [] };
		}
		try {
			const parsed: unknown = JSON.parse(raw);
			if (typeof parsed !== "object" || parsed === null) throw new Error("config is not an object");
			const record = parsed as Partial<UiConfig>;
			return {
				...record,
				archived: Array.isArray(record.archived) ? record.archived.filter(v => typeof v === "string") : [],
				recentProjects: Array.isArray(record.recentProjects)
					? record.recentProjects.filter(v => typeof v === "string")
					: [],
			};
		} catch {
			return this.#config ?? { archived: [], recentProjects: [] };
		}
	}

	#save(): void {
		fs.mkdirSync(this.dir, { recursive: true });
		// Unique temp name: two bridges saving at once must not interleave writes into one shared `.tmp`.
		const tmp = `${this.configPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
		fs.writeFileSync(tmp, `${JSON.stringify(this.#config, null, 2)}\n`, "utf8");
		fs.renameSync(tmp, this.configPath);
		const stat = fs.statSync(this.configPath);
		this.#signature = `${stat.mtimeMs}:${stat.size}`;
	}
}
