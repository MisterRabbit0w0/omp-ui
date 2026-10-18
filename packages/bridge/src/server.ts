/**
 * HTTP + WS bridge server (docs/DESIGN.md §5, §3.7).
 *
 * Loopback only, 32-byte random token: HTTP wants `Authorization: Bearer`,
 * the WS wants `{t:"hello",token}` as its first frame. Origin is checked on
 * both to block DNS rebinding (own origin + the Vite dev origin).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import type { Server, ServerWebSocket } from "bun";
import type {
	B2C,
	C2B,
	Diagnostics,
	ExtensionUiRequest,
	GitBranchesResult,
	RpcServerFrame,
	UiConfig,
} from "@omp-ui/protocol";
import { DEFAULT_PORT, WS_PATH } from "@omp-ui/protocol";
import { ConfigStore } from "./config";
import { FileAccessError, readSessionFile, searchFiles } from "./files";
import { gitWorktreeRoot, listGitBranches, readGitChanges, switchGitBranch } from "./git";
import { ModelCatalog } from "./models";
import { ProcessPool } from "./pool";
import { OmpProcess, resolveOmpCommand } from "./process";
import { defaultAgentDir, SessionScanner } from "./sessions";

const HELLO_TIMEOUT_MS = 5_000;
const PORT_ATTEMPTS = 20;
const DEV_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"];

const MIME_BY_EXT: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".mjs": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".map": "application/json; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".ico": "image/x-icon",
	".woff": "font/woff",
	".woff2": "font/woff2",
	".ttf": "font/ttf",
	".txt": "text/plain; charset=utf-8",
};

export interface BridgeOptions {
	/** 0 = ephemeral (tests). Otherwise auto-increments when busy. */
	port?: number;
	token?: string;
	/** omp argv; defaults to resolveOmpCommand(). */
	ompCommand?: string[];
	ompVersion?: string;
	webDist?: string;
	agentDir?: string;
	configDir?: string;
	poolMax?: number;
	/** Test seam: per-process frame ring cap. */
	ringMaxFrames?: number;
}

export interface BridgeHandle {
	port: number;
	token: string;
	/** `http://127.0.0.1:<port>/#token=<token>` */
	url: string;
	origin: string;
	ompVersion: string;
	pool: ProcessPool<OmpProcess>;
	scanner: SessionScanner;
	config: ConfigStore;
	close(): Promise<void>;
}

interface WsData {
	authed: boolean;
	attached: Set<string>;
	helloTimer?: ReturnType<typeof setTimeout>;
}

function json(data: unknown, init?: ResponseInit): Response {
	return new Response(JSON.stringify(data), {
		...init,
		headers: { "content-type": "application/json; charset=utf-8", ...(init?.headers ?? {}) },
	});
}

function errorJson(status: number, message: string): Response {
	return json({ error: message }, { status });
}

/** Requests that open a dialog and expect an answer (the ones tracked in `pendingUi`). */
function isInteractiveUiRequest(frame: RpcServerFrame): frame is Extract<ExtensionUiRequest, { id: string; method: "select" | "confirm" | "input" | "editor" | "ask" }> {
	if (frame.type !== "extension_ui_request") return false;
	const method = (frame as ExtensionUiRequest).method;
	return method === "select" || method === "confirm" || method === "input" || method === "editor" || method === "ask";
}

export async function createBridge(options: BridgeOptions = {}): Promise<BridgeHandle> {
	const token = options.token ?? [...crypto.getRandomValues(new Uint8Array(32))].map(b => b.toString(16).padStart(2, "0")).join("");
	const ompCommand = options.ompCommand ?? resolveOmpCommand();
	const config = new ConfigStore(options.configDir);
	await config.purgeTrash();
	const modelCatalog = new ModelCatalog(ompCommand, options.agentDir ?? defaultAgentDir());
	const pool = new ProcessPool<OmpProcess>(options.poolMax);

	/**
	 * True when a live process mid-run works inside the git work tree containing `dir` (any subdirectory of it,
	 * or a parent directory that contains it): a branch switch would rewrite files underneath that agent.
	 * Outside a repository the directory itself is the unit.
	 */
	const runningInWorktree = async (dir: string): Promise<boolean> => {
		const root = (await gitWorktreeRoot(dir)) ?? dir;
		const inside = (child: string, parent: string): boolean => {
			const rel = path.relative(parent, child);
			return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
		};
		for (const key of pool.keys()) {
			const proc = pool.peek(key);
			if (!proc || proc.settled) continue;
			const procDir = await fs.promises.realpath(proc.options.cwd).catch(() => proc.options.cwd);
			if (inside(procDir, root) || inside(root, procDir)) return true;
		}
		return false;
	};
	/** Sessions whose DELETE is in flight: no process may be (re)started for them meanwhile. */
	const deleting = new Set<string>();
	const deletingFiles = new Set<string>();
	const scanner = new SessionScanner({
		...(options.agentDir !== undefined ? { agentDir: options.agentDir } : {}),
		isLive: id => pool.has(id),
		isRunning: id => pool.get(id)?.settled === false,
		isArchived: id => config.config.archived.includes(id),
	});
	const webDist = options.webDist ?? path.resolve(import.meta.dir, "../../web/dist");
	const exportedPaths = new Set<string>();
	const clients = new Set<ServerWebSocket<WsData>>();
	let protocolVersion: 1 | 2 = 2;

	const send = (ws: ServerWebSocket<WsData>, message: B2C): void => {
		try {
			ws.send(JSON.stringify(message));
		} catch {
			// client vanished mid-send
		}
	};

	const broadcast = (message: B2C, filter?: (ws: ServerWebSocket<WsData>) => boolean): void => {
		const line = JSON.stringify(message);
		for (const ws of clients) {
			if (!ws.data.authed) continue;
			if (filter && !filter(ws)) continue;
			try {
				ws.send(line);
			} catch {
				// client vanished mid-send
			}
		}
	};

	const broadcastToSession = (sessionId: string, message: B2C, except?: ServerWebSocket<WsData>): void => {
		broadcast(message, ws => ws !== except && ws.data.attached.has(sessionId));
	};

	/** Processes overwritten in the pool by a successor under the same key (permission restart); their exit stays silent. */
	const replacedProcs = new WeakSet<OmpProcess>();

	const spawnSession = async (
		msg: Extract<C2B, { t: "start" }>,
	): Promise<{ key: string; proc: OmpProcess }> => {
		if (msg.resume !== undefined && deletingFiles.has(path.resolve(msg.cwd, msg.resume))) {
			throw new Error("session is being deleted");
		}
		let key: string | null = null;
		const proc = new OmpProcess(
			{
				cwd: msg.cwd,
				...(msg.resume !== undefined ? { resume: msg.resume } : {}),
				...(msg.restore !== undefined ? { restore: msg.restore } : {}),
				...(msg.model !== undefined ? { model: msg.model } : {}),
				...(msg.thinking !== undefined ? { thinking: msg.thinking } : {}),
				...(msg.approvalMode !== undefined ? { approvalMode: msg.approvalMode } : {}),
				command: ompCommand,
				...(options.ringMaxFrames !== undefined ? { ringMaxFrames: options.ringMaxFrames } : {}),
			},
			{
				onFrame: (seq, frame) => {
					if (key === null) return;
					pool.touch(key);
					broadcastToSession(key, { t: "frame", sessionId: key, seq, frame });
					// Run start/end flips `running` in the session list; tabs not attached to this session need it.
					if (frame.type === "agent_start" || frame.type === "session_settled") broadcast({ t: "sessions_changed" });
				},
				onUiResolved: (id, auto) => {
					if (key === null) return;
					broadcastToSession(key, {
						t: "ui_resolved",
						sessionId: key,
						id,
						...(auto ? { auto: true } : {}),
					});
				},
				onStateChange: (state, code, stderrTail) => {
					if (key === null) return;
					const terminal = state === "exited" || state === "crashed";
					const current = pool.get(key);
					// Replaced by a successor under the same key: either overwritten in the pool (WeakSet) or removed by
					// `stop` and superseded since (pool entry now belongs to another process). Never announce its exit.
					if (terminal && (replacedProcs.has(proc) || (current !== undefined && current !== proc))) return;
					protocolVersion = proc.protocolVersion;
					broadcast({
						t: "proc",
						sessionId: key,
						state,
						...(code !== undefined ? { code } : {}),
						...(stderrTail !== undefined ? { stderrTail } : {}),
					});
					if (terminal && current === proc) {
						void pool.remove(key);
					}
				},
			},
		);
		await proc.start();
		if (proc.sessionId !== null && deleting.has(proc.sessionId)) {
			await proc.stop();
			throw new Error("session is being deleted");
		}
		key = proc.sessionId ?? `proc-${crypto.randomUUID()}`;
		const previous = pool.get(key);
		if (previous !== undefined) replacedProcs.add(previous);
		pool.set(key, proc);
		return { key, proc };
	};

	const handleMessage = async (ws: ServerWebSocket<WsData>, raw: string): Promise<void> => {
		let msg: C2B;
		try {
			msg = JSON.parse(raw) as C2B;
		} catch {
			send(ws, { t: "error", message: "invalid JSON" });
			return;
		}
		switch (msg.t) {
			case "hello":
				return; // already authed
			case "attach": {
				const proc = pool.get(msg.sessionId);
				if (!proc) {
					send(ws, { t: "error", message: `no live process for session ${msg.sessionId}` });
					return;
				}
				ws.data.attached.add(msg.sessionId);
				const replay = proc.replay(msg.sinceSeq ?? 0);
				if (replay.kind === "resync") {
					send(ws, { t: "resync", sessionId: msg.sessionId });
				} else {
					for (const entry of replay.frames) {
						send(ws, { t: "frame", sessionId: msg.sessionId, seq: entry.seq, frame: entry.frame });
						// The ring keeps the request but never its answer: a replayed interactive request that is no
						// longer pending was already answered/cancelled, so tell the client right away.
						if (isInteractiveUiRequest(entry.frame) && !proc.pendingUi.has(entry.frame.id)) {
							send(ws, {
								t: "ui_resolved",
								sessionId: msg.sessionId,
								id: entry.frame.id,
								...(proc.autoResolved.has(entry.frame.id) ? { auto: true } : {}),
							});
						}
					}
				}
				for (const entry of proc.pendingUi.values()) {
					send(ws, { t: "frame", sessionId: msg.sessionId, seq: entry.seq, frame: entry.frame });
				}
				send(ws, { t: "proc", sessionId: msg.sessionId, state: proc.state });
				return;
			}
			case "detach":
				ws.data.attached.delete(msg.sessionId);
				return;
			case "start": {
				try {
					const { key } = await spawnSession(msg);
					const proc = pool.get(key)!;
					send(ws, {
						t: "started",
						reqId: msg.reqId,
						sessionId: key,
						...(proc.sessionFile !== null ? { sessionFile: proc.sessionFile } : {}),
					});
				} catch (error) {
					send(ws, { t: "error", reqId: msg.reqId, message: (error as Error).message });
				}
				return;
			}
			case "stop": {
				const proc = pool.get(msg.sessionId);
				if (!proc) return;
				await pool.remove(msg.sessionId);
				return;
			}
			case "rpc": {
				const proc = pool.get(msg.sessionId);
				if (!proc) {
					send(ws, { t: "error", reqId: msg.reqId, message: `no live process for session ${msg.sessionId}` });
					return;
				}
				if (deleting.has(msg.sessionId)) {
					send(ws, { t: "error", reqId: msg.reqId, message: `session ${msg.sessionId} is being deleted` });
					return;
				}
				const response = await proc.send(msg.cmd);
				if (msg.cmd.type === "export_html" && response.success) {
					const data: unknown = response.data;
					if (typeof data === "object" && data !== null && "path" in data && typeof data.path === "string") {
						exportedPaths.add(path.resolve(data.path));
					}
				}
				send(ws, { t: "rpc_result", reqId: msg.reqId, response });
				return;
			}
			case "ui_response": {
				const proc = pool.get(msg.sessionId);
				if (!proc) {
					send(ws, { t: "error", message: `no live process for session ${msg.sessionId}` });
					return;
				}
				if (proc.respondUi(msg.frame)) {
					broadcastToSession(
						msg.sessionId,
						{ t: "ui_resolved", sessionId: msg.sessionId, id: msg.frame.id },
						ws,
					);
				} else {
					// already answered elsewhere (first-response-wins) or unknown: close the dialog
					send(ws, { t: "ui_resolved", sessionId: msg.sessionId, id: msg.frame.id });
				}
				return;
			}
			case "auto_approve": {
				const proc = pool.get(msg.sessionId);
				if (proc) proc.autoApprove.add(msg.toolName);
				return;
			}
		}
	};

	const pickDir = async (): Promise<Response> => {
		if (process.platform !== "win32") {
			return errorJson(501, "native directory picker is only implemented on Windows");
		}
		const script = [
			"Add-Type -AssemblyName System.Windows.Forms",
			"$d = New-Object System.Windows.Forms.FolderBrowserDialog",
			"if ($d.ShowDialog() -eq 'OK') { $d.SelectedPath }",
		].join("; ");
		try {
			const proc = Bun.spawn(["powershell", "-NoProfile", "-STA", "-Command", script], {
				stdout: "pipe",
				stderr: "ignore",
			});
			const picked = (await new Response(proc.stdout).text()).trim();
			await proc.exited;
			return json({ path: picked.length > 0 ? picked : null });
		} catch (error) {
			return errorJson(500, (error as Error).message);
		}
	};

	const handleApi = async (req: Request, url: URL): Promise<Response> => {
		const segments = url.pathname.split("/").filter(s => s.length > 0);
		if (req.method === "GET" && url.pathname === "/api/sessions") {
			const q = url.searchParams.get("q")?.toLowerCase() ?? "";
			const cwd = url.searchParams.get("cwd");
			const archived = url.searchParams.get("archived");
			let items = await scanner.scan();
			if (cwd !== null && cwd !== "") items = items.filter(item => item.cwd === cwd);
			if (archived === "true") items = items.filter(item => item.archived);
			else if (archived !== "all") items = items.filter(item => !item.archived);
			if (q.length > 0) {
				items = items.filter(
					item => item.title.toLowerCase().includes(q) || item.cwd.toLowerCase().includes(q),
				);
			}
			return json(items);
		}
		if (segments[0] === "api" && segments[1] === "sessions" && segments.length >= 3) {
			const id = decodeURIComponent(segments[2]!);
			const action = segments[3];
			if (req.method === "GET" && action === "transcript") {
				const messages = await scanner.transcript(id);
				if (messages === undefined) return errorJson(404, `unknown session: ${id}`);
				return json(messages);
			}
			if (req.method === "POST" && action === "archive") {
				config.archive(id);
				return json(config.config);
			}
			if (req.method === "POST" && action === "unarchive") {
				config.unarchive(id);
				return json(config.config);
			}
			if (req.method === "DELETE" && segments.length === 3) {
				// Only a running session is protected (DESIGN §3.6); an idle open one is stopped first so its file is released.
				const live = pool.get(id);
				if (live !== undefined && live.settled === false) return errorJson(409, "session is running; stop it before deleting");
				if (deleting.has(id)) return errorJson(409, "session is already being deleted");
				// Atomic with run admission: from here until the file is moved, `rpc` to this session is refused and no
				// process may be started for it, so a prompt from another tab can't slip in during the awaits below.
				deleting.add(id);
				let file: string | undefined;
				try {
					file = await scanner.findFile(id);
					if (!file) return errorJson(404, `unknown session: ${id}`);
					deletingFiles.add(path.resolve(file));
					const current = pool.get(id);
					if (current !== undefined && current.settled === false) {
						return errorJson(409, "session is running; stop it before deleting");
					}
					if (current !== undefined) await pool.remove(id);
					const target = await config.moveToTrash(file);
					return json({ trashed: target });
				} finally {
					deleting.delete(id);
					if (file) deletingFiles.delete(path.resolve(file));
				}
			}
		}
		if (req.method === "GET" && url.pathname === "/api/models") {
			try {
				return json(await modelCatalog.list());
			} catch (error) {
				return errorJson(502, (error as Error).message);
			}
		}
		if (req.method === "GET" && url.pathname === "/api/projects") return json(await scanner.projects());
		if (req.method === "GET" && url.pathname === "/api/files") {
			const cwd = url.searchParams.get("cwd") ?? "";
			if (cwd.length === 0) return errorJson(400, "cwd is required");
			return json(await searchFiles(cwd, url.searchParams.get("q") ?? ""));
		}
		if (url.pathname.startsWith("/api/git/")) {
			// One validation for every git endpoint: an existing absolute directory, canonicalized. Same trust
			// model as /api/files (token-gated, any local workspace), so a freshly picked project without
			// session files works too.
			const body =
				req.method === "POST" ? ((await req.json().catch(() => null)) as { cwd?: unknown; branch?: unknown } | null) : null;
			const rawCwd = req.method === "POST" ? (typeof body?.cwd === "string" ? body.cwd : "") : (url.searchParams.get("cwd") ?? "");
			if (rawCwd.length === 0) return errorJson(400, "cwd is required");
			const workspace = await resolveWorkspaceDir(rawCwd);
			if (!workspace.ok) {
				// The branch picker probes every session's cwd; a deleted project is simply "not a repo".
				if (workspace.status === 404 && req.method === "GET" && url.pathname === "/api/git/branches") {
					return json({ repo: false, current: null, branches: [] } satisfies GitBranchesResult);
				}
				return errorJson(workspace.status, workspace.error);
			}
			const cwd = workspace.dir;

			if (req.method === "GET" && url.pathname === "/api/git/changes") {
				const scope = url.searchParams.get("scope") === "staged" ? "staged" : "unstaged";
				try {
					return json(await readGitChanges(cwd, scope));
				} catch (error) {
					return errorJson(502, (error as Error).message);
				}
			}
			if (req.method === "GET" && url.pathname === "/api/git/branches") {
				return json(await listGitBranches(cwd));
			}
			if (req.method === "POST" && url.pathname === "/api/git/switch") {
				const branch = typeof body?.branch === "string" ? body.branch : "";
				if (branch.length === 0) return errorJson(400, "cwd and branch are required");
				// Writes to the working tree: never under a running agent (it would edit files mid-switch).
				if (await runningInWorktree(cwd)) {
					return errorJson(409, "a session in this workspace is running; wait for it to finish");
				}
				const result = await switchGitBranch(cwd, branch);
				if (!result.ok) return errorJson(result.status, result.error);
				return json(await listGitBranches(cwd));
			}
			return errorJson(404, "not found");
		}
		if (req.method === "GET" && url.pathname === "/api/file") {
			const cwd = url.searchParams.get("cwd") ?? "";
			const filePath = url.searchParams.get("path") ?? "";
			if (cwd.length === 0 || filePath.length === 0) return errorJson(400, "cwd and path are required");
			try {
				return json(await readSessionFile(cwd, filePath));
			} catch (error) {
				if (error instanceof FileAccessError) {
					const status = error.code === "outside_cwd" ? 403 : error.code === "too_large" ? 413 : 404;
					return errorJson(status, error.message);
				}
				throw error;
			}
		}
		if (req.method === "GET" && url.pathname === "/api/export") {
			const filePath = url.searchParams.get("path") ?? "";
			const resolved = path.resolve(filePath);
			if (!exportedPaths.has(resolved)) {
				return errorJson(403, "path was not produced by an export_html command");
			}
			try {
				const content = await fs.promises.readFile(resolved);
				return new Response(content, {
					headers: {
						"content-type": "text/html; charset=utf-8",
						"content-disposition": `attachment; filename="${path.basename(resolved)}"`,
					},
				});
			} catch {
				return errorJson(404, "exported file no longer exists");
			}
		}
		if (url.pathname === "/api/config") {
			if (req.method === "GET") return json(config.config);
			if (req.method === "PUT") {
				const body = (await req.json()) as Partial<UiConfig>;
				return json(config.update(body));
			}
		}
		if (req.method === "GET" && segments[0] === "api" && segments[1] === "diagnostics" && segments[2]) {
			const sessionId = decodeURIComponent(segments[2]);
			const proc = pool.get(sessionId);
			if (!proc) return errorJson(404, `no live process for session ${sessionId}`);
			const diagnostics: Diagnostics = {
				sessionId,
				stderrTail: proc.stderrTail,
				parseErrors: proc.parseErrors,
				frameCount: proc.frameCount,
				droppedFrames: proc.droppedFrames,
			};
			return json(diagnostics);
		}
		if (req.method === "POST" && url.pathname === "/api/pick-dir") return pickDir();
		if (req.method === "GET" && url.pathname === "/api/dir-exists") {
			const target = url.searchParams.get("path") ?? "";
			if (target.length === 0) return errorJson(400, "path is required");
			// Only absolute paths are meaningful: a relative one would resolve against the bridge's own cwd.
			if (!path.isAbsolute(target)) return json({ exists: false, isDir: false });
			try {
				const stat = await fs.promises.stat(target);
				return json({ exists: true, isDir: stat.isDirectory() });
			} catch {
				return json({ exists: false, isDir: false });
			}
		}
		return errorJson(404, "not found");
	};

	const serveStatic = (url: URL): Response | null => {
		if (!fs.existsSync(webDist)) return null;
		let pathname = decodeURIComponent(url.pathname);
		if (pathname === "/") pathname = "/index.html";
		const filePath = path.normalize(path.join(webDist, pathname));
		if (filePath !== webDist && !filePath.startsWith(webDist + path.sep)) return null;
		const target = fs.existsSync(filePath) && fs.statSync(filePath).isFile() ? filePath : path.join(webDist, "index.html");
		if (!fs.existsSync(target)) return null;
		const ext = path.extname(target).toLowerCase();
		return new Response(Bun.file(target), {
			headers: { "content-type": MIME_BY_EXT[ext] ?? "application/octet-stream" },
		});
	};

	const isAllowedOrigin = (origin: string | null, port: number): boolean => {
		if (origin === null) return true; // non-browser clients (curl, tests)
		return (
			origin === `http://127.0.0.1:${port}` ||
			origin === `http://localhost:${port}` ||
			DEV_ORIGINS.includes(origin)
		);
	};

	const tryListen = (port: number): Server<WsData> =>
		Bun.serve<WsData>({
			hostname: "127.0.0.1",
			port,
			fetch: async (req, server) => {
				const url = new URL(req.url);
				if (url.pathname === WS_PATH) {
					if (!isAllowedOrigin(req.headers.get("origin"), server.port ?? 0)) {
						return errorJson(403, "origin not allowed");
					}
					const upgraded = server.upgrade(req, { data: { authed: false, attached: new Set<string>() } });
					return upgraded ? undefined : errorJson(400, "expected a WebSocket upgrade");
				}
				if (url.pathname.startsWith("/api/")) {
					if (!isAllowedOrigin(req.headers.get("origin"), server.port ?? 0)) {
						return errorJson(403, "origin not allowed");
					}
					if (req.headers.get("authorization") !== `Bearer ${token}`) {
						return errorJson(401, "missing or invalid bearer token");
					}
					return handleApi(req, url);
				}
				if (req.method === "GET" || req.method === "HEAD") {
					const served = serveStatic(url);
					if (served) return served;
				}
				return errorJson(404, "not found");
			},
			websocket: {
				open(ws) {
					clients.add(ws);
					ws.data.helloTimer = setTimeout(() => {
						if (!ws.data.authed) ws.close(4001, "hello timeout");
					}, HELLO_TIMEOUT_MS);
					ws.data.helloTimer.unref?.();
				},
				message(ws, raw) {
					if (typeof raw !== "string") {
						ws.close(4002, "binary frames are not supported");
						return;
					}
					if (!ws.data.authed) {
						clearTimeout(ws.data.helloTimer);
						let msg: unknown;
						try {
							msg = JSON.parse(raw);
						} catch {
							ws.close(4001, "invalid hello");
							return;
						}
						if (
							typeof msg !== "object" ||
							msg === null ||
							!("t" in msg) ||
							msg.t !== "hello" ||
							!("token" in msg) ||
							msg.token !== token
						) {
							ws.close(4001, "unauthorized");
							return;
						}
						ws.data.authed = true;
						send(ws, { t: "welcome", ompVersion, protocolVersion });
						return;
					}
					void handleMessage(ws, raw).catch(error => {
						send(ws, { t: "error", message: (error as Error).message });
					});
				},
				close(ws) {
					clearTimeout(ws.data.helloTimer);
					clients.delete(ws);
				},
			},
		});

	const ompVersion = options.ompVersion ?? "unknown";
	let server: Server<WsData> | null = null;
	let lastError: unknown = null;
	const requestedPort = options.port ?? DEFAULT_PORT;
	if (requestedPort === 0) {
		server = tryListen(0);
	} else {
		for (let attempt = 0; attempt < PORT_ATTEMPTS; attempt++) {
			try {
				server = tryListen(requestedPort + attempt);
				break;
			} catch (error) {
				lastError = error;
			}
		}
	}
	if (!server) {
		throw lastError instanceof Error
			? lastError
			: new Error(`could not bind any port in ${requestedPort}..${requestedPort + PORT_ATTEMPTS - 1}`);
	}

	const unwatch = scanner.watch(() => broadcast({ t: "sessions_changed" }));
	const boundPort = server.port ?? requestedPort;
	const origin = `http://127.0.0.1:${boundPort}`;
	return {
		port: boundPort,
		token,
		url: `${origin}/#token=${token}`,
		origin,
		ompVersion,
		pool,
		scanner,
		config,
		async close() {
			unwatch();
			scanner.close();
			for (const ws of [...clients]) {
				try {
					ws.close(1001, "bridge shutting down");
				} catch {
					// already closed
				}
			}
			server.stop(true);
			await pool.stopAll();
		},
	};
}

type WorkspaceDir = { ok: true; dir: string } | { ok: false; status: 400 | 404; error: string };

/** Canonical absolute directory for a git endpoint, or the HTTP error to return. */
export async function resolveWorkspaceDir(raw: string): Promise<WorkspaceDir> {
	if (!path.isAbsolute(raw)) return { ok: false, status: 400, error: "cwd must be an absolute path" };
	try {
		const dir = await fs.promises.realpath(raw);
		if (!(await fs.promises.stat(dir)).isDirectory()) return { ok: false, status: 400, error: "cwd is not a directory" };
		return { ok: true, dir };
	} catch {
		return { ok: false, status: 404, error: `no such directory: ${raw}` };
	}
}
