/**
 * Model catalog for the welcome composer (no live session yet): `omp models --json`, parsed to
 * chat models and cached. The subprocess takes seconds and returns ~700KB, so it runs lazily
 * on the first request and concurrent callers share one run.
 */
import type { CatalogModel } from "@omp-ui/protocol";

const CACHE_TTL_MS = 10 * 60 * 1000;
const TIMEOUT_MS = 60_000;

function asNumberOrNull(value: unknown): number | null {
	return typeof value === "number" ? value : null;
}

export function parseModelCatalog(json: string): CatalogModel[] {
	const data: unknown = JSON.parse(json);
	const list = typeof data === "object" && data !== null && "models" in data && Array.isArray(data.models) ? data.models : [];
	const models: CatalogModel[] = [];
	for (const raw of list as unknown[]) {
		if (typeof raw !== "object" || raw === null) continue;
		const m = raw as Record<string, unknown>;
		if (typeof m.provider !== "string" || typeof m.id !== "string") continue;
		if (m.kind !== undefined && m.kind !== "chat") continue;
		models.push({
			provider: m.provider,
			id: m.id,
			selector: typeof m.selector === "string" ? m.selector : `${m.provider}/${m.id}`,
			name: typeof m.name === "string" ? m.name : m.id,
			contextWindow: asNumberOrNull(m.contextWindow),
			maxTokens: asNumberOrNull(m.maxTokens),
			reasoning: m.reasoning === true,
			input: Array.isArray(m.input) ? m.input.filter((x): x is string => typeof x === "string") : ["text"],
		});
	}
	return models;
}

export class ModelCatalog {
	readonly #command: string[];
	#cache: { at: number; models: CatalogModel[] } | null = null;
	#inflight: Promise<CatalogModel[]> | null = null;

	constructor(ompCommand: string[]) {
		this.#command = ompCommand;
	}

	async list(): Promise<CatalogModel[]> {
		if (this.#cache && Date.now() - this.#cache.at < CACHE_TTL_MS) return this.#cache.models;
		this.#inflight ??= this.#load().finally(() => {
			this.#inflight = null;
		});
		return this.#inflight;
	}

	async #load(): Promise<CatalogModel[]> {
		const proc = Bun.spawn([...this.#command, "models", "--json"], { stdout: "pipe", stderr: "pipe" });
		const timer = setTimeout(() => proc.kill(), TIMEOUT_MS);
		try {
			const [stdout, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
			if (code !== 0) throw new Error(`omp models --json exited with code ${code}`);
			const models = parseModelCatalog(stdout);
			this.#cache = { at: Date.now(), models };
			return models;
		} finally {
			clearTimeout(timer);
		}
	}
}
