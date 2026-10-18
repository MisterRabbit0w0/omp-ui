/**
 * Typed wrappers for the bridge HTTP API (DESIGN §5). Every request carries
 * `Authorization: Bearer <token>`; errors throw HttpError with the bridge's
 * `{error}` message.
 */
import type { AgentMessage, CatalogModel, Diagnostics, FileHit, GitChangeScope, GitChangesResult, ProjectItem, SessionListItem, UiConfig } from "@omp-ui/protocol";

export class HttpError extends Error {
	readonly status: number;
	constructor(status: number, message: string) {
		super(message);
		this.name = "HttpError";
		this.status = status;
	}
}

/** GET /api/file response (bridge contract). */
export interface FileContent {
	path: string;
	content: string;
	sizeBytes: number;
}

/** POST /api/pick-dir response; `path` is null when the user cancelled. */
export interface PickDirResult {
	path: string | null;
}

/** GET /api/dir-exists response. */
export interface DirExistsResult {
	exists: boolean;
	isDir: boolean;
}

export interface SessionListQuery {
	q?: string;
	cwd?: string;
	archived?: boolean;
}

/** The callable part of `fetch` (without statics like `preconnect`). */
export type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface BridgeHttpOptions {
	/** Default "" (same origin; the Vite dev server proxies /api). */
	baseUrl?: string;
	token?: string | (() => string | null);
	fetchImpl?: FetchFn;
}

function queryString(params: Record<string, string | undefined>): string {
	const q = new URLSearchParams();
	for (const [k, v] of Object.entries(params)) {
		if (v !== undefined) q.set(k, v);
	}
	const s = q.toString();
	return s ? `?${s}` : "";
}

export class BridgeHttp {
	private readonly baseUrl: string;
	private readonly token?: string | (() => string | null);
	private readonly fetchImpl: FetchFn;

	constructor(opts: BridgeHttpOptions = {}) {
		this.baseUrl = opts.baseUrl ?? "";
		this.token = opts.token;
		// Never store bare `fetch`: calling it as a method of this instance throws "Illegal invocation" in browsers.
		this.fetchImpl = opts.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
	}

	private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
		const token = typeof this.token === "function" ? this.token() : this.token;
		const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
			method,
			headers: {
				...(body !== undefined ? { "content-type": "application/json" } : {}),
				...(token ? { authorization: `Bearer ${token}` } : {}),
			},
			...(body !== undefined ? { body: JSON.stringify(body) } : {}),
		});
		if (!res.ok) {
			let message = res.statusText;
			const errBody: unknown = await res.json().catch(() => undefined);
			if (errBody !== null && typeof errBody === "object" && "error" in errBody && typeof errBody.error === "string") {
				message = errBody.error;
			}
			throw new HttpError(res.status, message);
		}
		return (await res.json()) as T;
	}

	listSessions(query: SessionListQuery = {}): Promise<SessionListItem[]> {
		return this.request(
			"GET",
			`/api/sessions${queryString({ q: query.q, cwd: query.cwd, archived: query.archived === undefined ? undefined : String(query.archived) })}`,
		);
	}

	getTranscript(sessionId: string): Promise<AgentMessage[]> {
		return this.request("GET", `/api/sessions/${encodeURIComponent(sessionId)}/transcript`);
	}

	async archiveSession(sessionId: string): Promise<void> {
		await this.request("POST", `/api/sessions/${encodeURIComponent(sessionId)}/archive`);
	}

	async unarchiveSession(sessionId: string): Promise<void> {
		await this.request("POST", `/api/sessions/${encodeURIComponent(sessionId)}/unarchive`);
	}

	async deleteSession(sessionId: string): Promise<void> {
		await this.request("DELETE", `/api/sessions/${encodeURIComponent(sessionId)}`);
	}

	/** Chat-model catalog (omp models --json); slow on first call, cached by the bridge. */
	listModels(): Promise<CatalogModel[]> {
		return this.request("GET", "/api/models");
	}

	/** Read-only git working-tree changes for the 变更 panel. */
	getGitChanges(cwd: string, scope: GitChangeScope): Promise<GitChangesResult> {
		return this.request("GET", `/api/git/changes${queryString({ cwd, scope })}`);
	}

	listProjects(): Promise<ProjectItem[]> {
		return this.request("GET", "/api/projects");
	}

	searchFiles(cwd: string, q: string): Promise<FileHit[]> {
		return this.request("GET", `/api/files${queryString({ cwd, q })}`);
	}

	readFile(cwd: string, path: string): Promise<FileContent> {
		return this.request("GET", `/api/file${queryString({ cwd, path })}`);
	}

	getConfig(): Promise<UiConfig> {
		return this.request("GET", "/api/config");
	}

	putConfig(config: UiConfig): Promise<UiConfig> {
		return this.request("PUT", "/api/config", config);
	}

	getDiagnostics(sessionId: string): Promise<Diagnostics> {
		return this.request("GET", `/api/diagnostics/${encodeURIComponent(sessionId)}`);
	}

	pickDir(): Promise<PickDirResult> {
		return this.request("POST", "/api/pick-dir");
	}

	/** Validate a typed project path (used when the native picker is unavailable). */
	dirExists(path: string): Promise<DirExistsResult> {
		return this.request("GET", `/api/dir-exists${queryString({ path })}`);
	}

	/** GET /api/export: raw bytes of a file previously produced by `export_html`. */
	async downloadExport(path: string): Promise<Blob> {
		const token = typeof this.token === "function" ? this.token() : this.token;
		const res = await this.fetchImpl(`${this.baseUrl}/api/export${queryString({ path })}`, {
			headers: token ? { authorization: `Bearer ${token}` } : {},
		});
		if (!res.ok) {
			let message = res.statusText;
			const errBody: unknown = await res.json().catch(() => undefined);
			if (errBody !== null && typeof errBody === "object" && "error" in errBody && typeof errBody.error === "string") {
				message = errBody.error;
			}
			throw new HttpError(res.status, message);
		}
		return res.blob();
	}
}
