/**
 * Application store (zustand): session list, per-session SessionView, bridge
 * dispatch, cold-start loader (DESIGN §6.1) and composer send routing
 * (FRONTEND §6.12, DESIGN §9.4). Frame folding itself lives in the pure
 * session-reducer; this store performs the collected effects.
 */
import { create } from "zustand";
import type {
	AgentMessage,
	ApprovalMode,
	B2C,
	CatalogModel,
	ExtensionUiResponse,
	ImageContent,
	NotifyType,
	ProjectItem,
	PromptAck,
	RpcServerFrame,
	SessionListItem,
	UiConfig,
} from "@omp-ui/protocol";
import { APPROVE, isApprovalRequest, parseApproval } from "@omp-ui/protocol";
import { BridgeClient, BridgeRpcError, resolveBridgeToken, type ConnectionState, type StartOptions } from "../lib/ws";
import { BridgeHttp } from "../lib/http";
import {
	loadPendingConfig,
	resolveSessionConfig,
	savePendingConfig,
	thinkingStartArg,
	type PendingSessionConfig,
} from "../features/composer/new-session-config";
import {
	createSessionView,
	reduce,
	reduceProc,
	reducePromptAck,
	resolveUi,
	resetForResync,
	subagentsFromSnapshots,
	type SessionEffect,
	type SessionView,
	type ViewMessage,
} from "./session-reducer";

export interface Toast {
	id: number;
	level: NotifyType;
	message: string;
}

/** How the composer dispatches text while a run is active (FRONTEND §6.12). */
export type SendMode = "auto" | "steer" | "followUp" | "interrupt";

export interface NewSessionOptions {
	model?: string;
	thinking?: string;
	approvalMode?: ApprovalMode;
}

export interface SendOptions {
	images?: ImageContent[];
	mode?: SendMode;
}

export interface AppState {
	connection: ConnectionState;
	ompVersion: string | null;
	protocolVersion: 1 | 2 | null;
	sessions: SessionListItem[];
	projects: ProjectItem[];
	/** Chat models from `omp models --json`; loaded lazily for the welcome composer (no live session yet). */
	modelCatalog: CatalogModel[] | null;
	modelCatalogLoading: boolean;
	config: UiConfig | null;
	currentSessionId: string | null;
	views: Record<string, SessionView>;
	/** Data-only toast queue; the UI renders and expires these (FRONTEND §6.17). */
	toasts: Toast[];
	/** Last `set_editor_text` request; the composer consumes it. */
	composerInsert: { sessionId: string; text: string; at: number } | null;
	/** sessionId -> timestamp of the last todo_reminder (panel flash). */
	todoFlash: Record<string, number>;
	/** sessionId -> timestamp of the last session_settled (attention/notification). */
	attention: Record<string, number>;
	/** Pending "go to the welcome page" request (sidebar 新对话 / Ctrl+N / group "+"); the welcome composer consumes it. */
	welcomeRequest: { cwd?: string; at: number } | null;
	/** Welcome page's pending new-session config (cwd/model/thinking/approvalMode), persisted to localStorage. */
	pendingSession: PendingSessionConfig;

	init(): void;
	dispatch(msg: B2C): void;
	loadSessions(): Promise<void>;
	loadProjects(): Promise<void>;
	loadModelCatalog(): Promise<void>;
	openSession(item: SessionListItem): Promise<void>;
	newSession(cwd: string, opts?: NewSessionOptions): Promise<string>;
	/** Leave the current session for the welcome page (currentSessionId = null), optionally preselecting a project. */
	startWelcome(cwd?: string): void;
	/** Patch and persist the pending new-session config. */
	updatePendingSession(patch: Partial<PendingSessionConfig>): void;
	/** Create a session from the pending config (project + model + thinking + approval mode). Null when no project is chosen. */
	newSessionFromPending(): Promise<string | null>;
	/** Apply a new approval mode to a settled live session: stop + start(resume) with `--approval-mode`. Returns the (possibly new) session id. */
	restartWithApprovalMode(sessionId: string, mode: ApprovalMode): Promise<string>;
	startSession(sessionId: string): Promise<void>;
	coldStart(sessionId: string): Promise<void>;
	sendPrompt(sessionId: string, text: string, opts?: SendOptions): Promise<void>;
	retryPrompt(sessionId: string, reqId?: string): Promise<void>;
	abort(sessionId: string): Promise<void>;
	answerUi(sessionId: string, response: ExtensionUiResponse, meta?: { always?: boolean }): void;
	approve(sessionId: string, requestId: string, always: boolean): void;
	pushToast(level: NotifyType, message: string): void;
	dismissToast(id: number): void;
}

let toastCounter = 0;

/** Injectable seams for tests; real client/http are created lazily in the browser. */
export interface AppDeps {
	client: BridgeClient;
	http: BridgeHttp;
}

const MESSAGE_PAGE_LIMIT = 200;
const COLD_START_RETRIES = 3;

function sleep(ms: number): Promise<void> {
	const { promise, resolve } = Promise.withResolvers<void>();
	setTimeout(resolve, ms);
	return promise;
}

export function createAppStore(deps?: Partial<AppDeps>) {
	let client: BridgeClient | null = deps?.client ?? null;
	let http: BridgeHttp | null = deps?.http ?? null;
	let promptCounter = 0;
	/** The welcome composer can ask for the catalog before `init()` has created `http` (child effects run first). */
	let catalogWanted = false;
	/** Sessions whose process is being replaced; the old process's exit must not mark the view dead. */
	const restarting = new Set<string>();
	/** In-flight lazy starts (background warm-up for previews, or send-time start) keyed by session id. */
	const startingSessions = new Map<string, Promise<void>>();

	const store = create<AppState>()((set, get) => {
		/**
		 * Live frames are coalesced into one store update per animation frame (~4/s while the tab is
		 * hidden): a running loop emits hundreds of frames per second, and applying each with its own
		 * `set` re-renders the transcript per frame — in a background tab they pile up and replay as a
		 * long stall when the tab becomes active again.
		 */
		let frameQueue: Array<{ sessionId: string; seq: number; frame: RpcServerFrame }> = [];
		let flushScheduled = false;

		const flushFrames = (): void => {
			flushScheduled = false;
			if (frameQueue.length === 0) return;
			const batch = frameQueue;
			frameQueue = [];
			const effects: Array<{ sessionId: string; effects: SessionEffect[] }> = [];
			set(s => {
				const views = { ...s.views };
				for (const { sessionId, seq, frame } of batch) {
					const view = views[sessionId];
					if (!view) continue;
					const next = reduce(view, frame, { live: true });
					if (next.effects.length > 0) effects.push({ sessionId, effects: next.effects });
					views[sessionId] = { ...next, lastSeq: Math.max(seq, view.lastSeq), effects: [] };
				}
				return { views };
			});
			for (const e of effects) runEffects(e.sessionId, e.effects);
		};

		const scheduleFlush = (): void => {
			if (flushScheduled) return;
			flushScheduled = true;
			if (typeof document !== "undefined" && document.hidden) setTimeout(flushFrames, 250);
			else requestAnimationFrame(flushFrames);
		};

		if (typeof document !== "undefined") {
			document.addEventListener("visibilitychange", () => {
				if (!document.hidden) flushFrames();
			});
		}

		const updateView = (sessionId: string, fn: (view: SessionView) => SessionView): void => {
			// Keep arrival order: frames received before this update land first.
			flushFrames();
			set(s => {
				const view = s.views[sessionId];
				if (!view) return s;
				return { views: { ...s.views, [sessionId]: fn(view) } };
			});
		};

		const runEffects = (sessionId: string, effects: SessionEffect[]): void => {
			for (const e of effects) {
				switch (e.kind) {
					case "toast":
						get().pushToast(e.level, e.message);
						break;
					case "retry_fallback":
						get().pushToast("info", `已回退到 ${e.to}`);
						break;
					case "open_url":
						if (typeof window !== "undefined") window.open(e.launchUrl ?? e.url, "_blank", "noopener");
						break;
					case "set_editor_text":
						set({ composerInsert: { sessionId, text: e.text, at: Date.now() } });
						break;
					case "refetch_state":
						void refetchState(sessionId);
						break;
					case "refetch_stats":
						void refetchStats(sessionId);
						break;
					case "refetch_messages":
						void refetchMessages(sessionId);
						break;
					case "settled":
						set(s => ({ attention: { ...s.attention, [sessionId]: Date.now() } }));
						break;
					case "todo_reminder":
						set(s => ({ todoFlash: { ...s.todoFlash, [sessionId]: Date.now() } }));
						break;
				}
			}
		};

		const applyFrame = (sessionId: string, seq: number, frame: RpcServerFrame): void => {
			// The bridge forwards prompt_result.id as its internal command id;
			// translate it back to our reqId so pendingPrompts line up.
			if (frame.type === "prompt_result" && frame.id && client) {
				const reqId = client.resolveReqId(frame.id);
				if (reqId) frame = { ...frame, id: reqId };
			}
			frameQueue.push({ sessionId, seq, frame });
			if (typeof requestAnimationFrame === "undefined") flushFrames();
			else scheduleFlush();
		};

		const requireClient = (): BridgeClient => {
			if (!client) throw new Error("app store not initialized");
			return client;
		};

		const refetchState = async (sessionId: string): Promise<void> => {
			if (!client) return;
			try {
				const state = await client.rpc(sessionId, { type: "get_state" });
				updateView(sessionId, v => ({ ...v, state }));
			} catch {
				/* session may be gone */
			}
		};

		const refetchStats = async (sessionId: string): Promise<void> => {
			if (!client) return;
			try {
				const stats = await client.rpc(sessionId, { type: "get_session_stats" });
				updateView(sessionId, v => ({ ...v, stats, statsStale: false }));
			} catch {
				/* session may be gone */
			}
		};

		/** Full history pull: get_messages_page from the start, §6.1 retry rules. */
		const fetchAllMessages = async (sessionId: string): Promise<AgentMessage[] | null> => {
			const c = requireClient();
			for (let attempt = 0; attempt < COLD_START_RETRIES; attempt++) {
				try {
					const all: AgentMessage[] = [];
					let cursor: string | undefined;
					do {
						const page = await client!.rpc(sessionId, {
							type: "get_messages_page",
							...(cursor !== undefined ? { cursor } : {}),
							limit: MESSAGE_PAGE_LIMIT,
						});
						all.push(...(page.messages ?? []));
						cursor = page.nextCursor;
					} while (cursor !== undefined);
					return all;
				} catch (err) {
					if (err instanceof BridgeRpcError && (err.code === "stale_cursor" || err.code === "session_busy")) {
						await sleep(500);
						continue;
					}
					throw err;
				}
			}
			return null;
		};

		const refetchMessages = async (sessionId: string): Promise<void> => {
			try {
				const messages = await fetchAllMessages(sessionId);
				if (!messages) return;
				updateView(sessionId, v => ({ ...v, messages: messages.map((m): ViewMessage => ({ ...m, animateOnMount: false })) }));
			} catch {
				/* session may be gone */
			}
		};

		const attachAndStart = async (sessionId: string, opts: StartOptions): Promise<void> => {
			const c = requireClient();
			updateView(sessionId, v => ({ ...v, proc: "starting" }));
			// The bridge only accepts `attach` for a live process, so start first; attach replays the ring from seq 0.
			await c.start(opts);
			c.attach(sessionId);
			await store.getState().coldStart(sessionId);
		};

		return {
			connection: "closed",
			ompVersion: null,
			protocolVersion: null,
			sessions: [],
			projects: [],
			modelCatalog: null,
			modelCatalogLoading: false,
			config: null,
			currentSessionId: null,
			views: {},
			toasts: [],
			composerInsert: null,
			todoFlash: {},
			attention: {},
			welcomeRequest: null,
			pendingSession: loadPendingConfig(),

			init(): void {
				if (!client) {
					client = new BridgeClient({
						token: resolveBridgeToken(),
						onConnection: connection => set({ connection }),
						onMessage: msg => get().dispatch(msg),
					});
				}
				if (!http) {
					const token = resolveBridgeToken();
					http = new BridgeHttp({ token: token ?? undefined });
				}
				void get().loadSessions();
				void get().loadProjects();
				if (catalogWanted) void get().loadModelCatalog();
				void http
					.getConfig()
					.then(config => set({ config }))
					.catch(() => undefined);
			},

			dispatch(msg: B2C): void {
				switch (msg.t) {
					case "welcome":
						set({ ompVersion: msg.ompVersion, protocolVersion: msg.protocolVersion });
						break;
					case "frame":
						applyFrame(msg.sessionId, msg.seq, msg.frame);
						break;
					case "resync": {
						const view = get().views[msg.sessionId];
						if (!view) break;
						updateView(msg.sessionId, v => resetForResync(v));
						void get().coldStart(msg.sessionId);
						break;
					}
					case "ui_resolved":
						updateView(msg.sessionId, v => resolveUi(v, msg.id, msg.auto ? { auto: true } : {}));
						break;
					case "proc":
						if (restarting.has(msg.sessionId) && (msg.state === "exited" || msg.state === "crashed")) break;
						updateView(msg.sessionId, v => reduceProc(v, msg.state, { code: msg.code, stderrTail: msg.stderrTail }));
						break;
					case "sessions_changed":
						void get().loadSessions();
						break;
					case "error":
						get().pushToast("error", msg.message);
						break;
					default:
						break; // rpc_result / started resolve inside BridgeClient
				}
			},

			async loadSessions(): Promise<void> {
				if (!http) return;
				try {
					const listed = await http.listSessions();
					set(s => {
						// A fresh omp session has no file until its first message; keep the local live
						// placeholder until the server list reports the id (or its process is gone).
						const known = new Set(listed.map(item => item.id));
						const placeholders = s.sessions.filter(item => {
							if (known.has(item.id) || !item.live) return false;
							const proc = s.views[item.id]?.proc;
							return proc !== undefined && proc !== "exited" && proc !== "crashed" && proc !== "none";
						});
						return { sessions: [...placeholders, ...listed] };
					});
				} catch {
					/* bridge unreachable; connection state already reflects it */
				}
			},

			async loadProjects(): Promise<void> {
				if (!http) return;
				try {
					const projects = await http.listProjects();
					set({ projects });
				} catch {
					/* ignore */
				}
			},

			async loadModelCatalog(): Promise<void> {
				catalogWanted = true;
				if (!http || get().modelCatalog || get().modelCatalogLoading) return;
				set({ modelCatalogLoading: true });
				try {
					set({ modelCatalog: await http.listModels() });
				} catch {
					/* catalog is a convenience; the welcome menu just stays empty */
				} finally {
					set({ modelCatalogLoading: false });
				}
			},

			async openSession(item: SessionListItem): Promise<void> {
				set({ currentSessionId: item.id });
				const existing = get().views[item.id];
				if (existing && !existing.readonly) return;
				if (item.live) {
					if (!existing) {
						set(s => ({ views: { ...s.views, [item.id]: createSessionView(item.id, { proc: "starting", title: item.title }) } }));
					}
					requireClient().attach(item.id);
					await get().coldStart(item.id);
					return;
				}
				// Read-only preview: parse the transcript without spawning (§3.1).
				if (!http) return;
				try {
					const transcript = await http.getTranscript(item.id);
					const messages = transcript.map((m): ViewMessage => ({ ...m, animateOnMount: false }));
					set(s => ({
						views: {
							...s.views,
							[item.id]: { ...createSessionView(item.id, { readonly: true, title: item.title }), messages },
						},
					}));
					// Spawn in the background right away so the model/thinking selectors work before
					// the first prompt (they need a live omp process; send-time lazy start was too late).
					void get()
						.startSession(item.id)
						.catch(err => {
							get().pushToast("error", err instanceof Error ? err.message : "会话启动失败");
						});
				} catch (err) {
					get().pushToast("error", err instanceof Error ? err.message : "无法加载会话");
				}
			},

			async newSession(cwd: string, opts: NewSessionOptions = {}): Promise<string> {
				const c = requireClient();
				const { sessionId, sessionFile } = await c.start({ cwd, model: opts.model, thinking: opts.thinking, approvalMode: opts.approvalMode });
				const now = new Date().toISOString();
				const placeholder: SessionListItem = {
					id: sessionId,
					file: sessionFile ?? "",
					cwd,
					title: "",
					createdAt: now,
					updatedAt: now,
					sizeBytes: 0,
					live: true,
					running: false,
					archived: false,
				};
				set(s => ({
					currentSessionId: sessionId,
					sessions: s.sessions.some(item => item.id === sessionId) ? s.sessions : [placeholder, ...s.sessions],
					views: { ...s.views, [sessionId]: createSessionView(sessionId, { proc: "starting", approvalMode: opts.approvalMode }) },
				}));
				c.attach(sessionId);
				await get().coldStart(sessionId);
				return sessionId;
			},

			/** Lazy start for a read-only preview / exited process (§3.1). Concurrent callers share one start. */
			async startSession(sessionId: string): Promise<void> {
				const inflight = startingSessions.get(sessionId);
				if (inflight) return inflight;
				const view = get().views[sessionId];
				if (!view || (view.proc !== "none" && view.proc !== "exited" && view.proc !== "crashed")) return;
				const item = get().sessions.find(s => s.id === sessionId);
				if (!item) throw new Error(`unknown session ${sessionId}`);
				const task = (async () => {
					await attachAndStart(sessionId, {
						cwd: item.cwd,
						resume: item.file,
						restore: view.proc === "crashed",
						model: get().config?.defaultModel,
						thinking: get().config?.defaultThinking,
						approvalMode: view.approvalMode ?? get().config?.defaultApprovalMode,
					});
					updateView(sessionId, v => ({ ...v, readonly: false, approvalMode: v.approvalMode ?? get().config?.defaultApprovalMode }));
				})();
				startingSessions.set(sessionId, task);
				try {
					await task;
				} finally {
					startingSessions.delete(sessionId);
				}
			},

			startWelcome(cwd?: string): void {
				set({ currentSessionId: null, welcomeRequest: { ...(cwd !== undefined ? { cwd } : {}), at: Date.now() } });
			},

			updatePendingSession(patch: Partial<PendingSessionConfig>): void {
				const next = { ...get().pendingSession, ...patch };
				set({ pendingSession: next });
				savePendingConfig(next);
			},

			async newSessionFromPending(): Promise<string | null> {
				let { pendingSession, config, projects } = get();
				let resolved = resolveSessionConfig(pendingSession, config, projects);
				if (!resolved.cwd) {
					// Sending right after page load can beat /api/projects and /api/config: refresh before giving up.
					const refreshConfig = async (): Promise<void> => {
						try {
							if (http) set({ config: await http.getConfig() });
						} catch {
							/* bridge unreachable or stubbed: keep what we have */
						}
					};
					await Promise.all([get().loadProjects(), refreshConfig()]);
					({ pendingSession, config, projects } = get());
					resolved = resolveSessionConfig(pendingSession, config, projects);
				}
				if (!resolved.cwd) {
					get().pushToast("warning", "请先选择一个项目");
					return null;
				}
				const cwd = resolved.cwd;
				const id = await get().newSession(cwd, {
					model: resolved.model,
					thinking: thinkingStartArg(resolved.thinking),
					approvalMode: resolved.approvalMode,
				});
				// Remember the last used project for the next welcome page.
				get().updatePendingSession({ cwd });
				return id;
			},

			async restartWithApprovalMode(sessionId: string, mode: ApprovalMode): Promise<string> {
				const view = get().views[sessionId];
				if (!view || restarting.has(sessionId)) return sessionId;
				// No live process (preview / exited): remember the mode, the lazy start applies it.
				if (view.readonly || view.proc === "none" || view.proc === "exited" || view.proc === "crashed") {
					updateView(sessionId, v => ({ ...v, approvalMode: mode }));
					return sessionId;
				}
				// Only a settled, ready process may be replaced; the UI disables the chip otherwise.
				if (view.proc !== "ready" || view.run.kind !== "idle") return sessionId;
				const c = requireClient();
				const item = get().sessions.find(s => s.id === sessionId);
				const cwd = item?.cwd;
				if (!cwd) {
					get().pushToast("error", "找不到会话的工作目录，无法重启");
					return sessionId;
				}
				// A session without messages has no file on disk yet; it restarts as a fresh process.
				const sessionFile = view.state?.sessionFile || item?.file || undefined;
				const resume = view.messages.length > 0 ? sessionFile : undefined;
				const model = view.state?.model ? `${view.state.model.provider}/${view.state.model.id}` : get().config?.defaultModel;
				const level = view.state?.thinkingLevel;
				const thinking = level && level !== "inherit" ? level : undefined;

				restarting.add(sessionId);
				updateView(sessionId, v => ({ ...v, proc: "starting", approvalMode: mode }));
				let currentId = sessionId;
				try {
					c.send({ t: "stop", sessionId });
					// Drop the old attach so the new process's ring replays from seq 0 instead of a stale sinceSeq.
					c.detach(sessionId);
					const started = await c.start({ cwd, resume, model, thinking, approvalMode: mode });
					currentId = started.sessionId;
					if (currentId !== sessionId) {
						set(s => {
							const { [sessionId]: previous, ...rest } = s.views;
							return {
								currentSessionId: s.currentSessionId === sessionId ? currentId : s.currentSessionId,
								views: { ...rest, [currentId]: { ...(previous ?? view), sessionId: currentId } },
								sessions: s.sessions.map(it =>
									it.id === sessionId ? { ...it, id: currentId, file: started.sessionFile ?? it.file } : it,
								),
							};
						});
					}
					c.attach(currentId);
					await get().coldStart(currentId);
				} catch (err) {
					get().pushToast("error", err instanceof Error ? err.message : "重启会话进程失败");
					updateView(currentId, v => reduceProc(v, "exited"));
				} finally {
					restarting.delete(sessionId);
				}
				return currentId;
			},

			async coldStart(sessionId: string): Promise<void> {
				const c = requireClient();
				const [state, models, thinkingLevels, commands, subagents, btw, stats] = await Promise.allSettled([
					c.rpc(sessionId, { type: "get_state" }),
					c.rpc(sessionId, { type: "get_available_models" }),
					c.rpc(sessionId, { type: "get_available_thinking_levels" }),
					c.rpc(sessionId, { type: "get_available_commands" }),
					c.rpc(sessionId, { type: "get_subagents" }),
					c.rpc(sessionId, { type: "get_btw_history" }),
					c.rpc(sessionId, { type: "get_session_stats" }),
				]);
				updateView(sessionId, v => {
					let next = v;
					if (state.status === "fulfilled") next = { ...next, state: state.value };
					// RPC results are a trust boundary: tolerate absent collections instead of throwing mid-start.
					if (models.status === "fulfilled") next = { ...next, models: models.value.models ?? [] };
					if (thinkingLevels.status === "fulfilled") next = { ...next, thinkingLevels: thinkingLevels.value.levels ?? [] };
					if (commands.status === "fulfilled") next = { ...next, commands: commands.value.commands ?? [] };
					if (subagents.status === "fulfilled") next = { ...next, subagents: subagentsFromSnapshots(subagents.value.subagents ?? []) };
					if (btw.status === "fulfilled") next = { ...next, btw: new Map((btw.value.records ?? []).map(r => [r.id, r])) };
					if (stats.status === "fulfilled") next = { ...next, stats: stats.value, statsStale: false };
					return next;
				});
				await refetchMessages(sessionId);
			},

			async sendPrompt(sessionId: string, text: string, opts: SendOptions = {}): Promise<void> {
				const view = get().views[sessionId];
				if (!view) return;
				const inflightStart = startingSessions.get(sessionId);
				if (inflightStart) await inflightStart;
				else if (view.readonly || view.proc === "none" || view.proc === "exited" || view.proc === "crashed") {
					await get().startSession(sessionId);
				}
				const c = requireClient();
				const run = get().views[sessionId]?.run.kind ?? "idle";
				const busy = run === "running" || run === "settling" || run === "compacting" || run === "retrying";
				const mode: "prompt" | "steer" | "followUp" | "interrupt" = busy
					? opts.mode === "followUp" || opts.mode === "interrupt"
						? opts.mode
						: "steer"
					: "prompt";
				promptCounter += 1;
				const reqId = `p-${promptCounter}`;
				const promptRecord = { text, images: opts.images };
				updateView(sessionId, v => {
					const pendingPrompts = new Map(v.pendingPrompts);
					if (mode === "prompt" || mode === "interrupt") pendingPrompts.set(reqId, promptRecord);
					return { ...v, pendingPrompts };
				});
				try {
					if (mode === "prompt") {
						// omp omits `data` on a plain admitted prompt (only local slash commands send `agentInvoked`).
						const ack: PromptAck | undefined = await c.rpc(sessionId, { type: "prompt", message: text, images: opts.images }, reqId);
						updateView(sessionId, v => reducePromptAck(v, ack?.agentInvoked));
					} else if (mode === "steer") {
						await c.rpc(sessionId, { type: "steer", message: text, images: opts.images }, reqId);
					} else if (mode === "followUp") {
						await c.rpc(sessionId, { type: "follow_up", message: text, images: opts.images }, reqId);
					} else {
						await c.rpc(sessionId, { type: "abort_and_prompt", message: text, images: opts.images }, reqId);
						updateView(sessionId, v => (v.run.kind === "dead" ? v : { ...v, run: { kind: "running" } }));
					}
				} catch (err) {
					updateView(sessionId, v => {
						const pendingPrompts = new Map(v.pendingPrompts);
						pendingPrompts.delete(reqId);
						return { ...v, pendingPrompts };
					});
					get().pushToast("error", err instanceof Error ? err.message : "发送失败");
				}
			},

			async retryPrompt(sessionId: string, reqId?: string): Promise<void> {
				const view = get().views[sessionId];
				if (!view) return;
				let entry: { text: string; images?: ImageContent[] } | undefined;
				if (reqId) {
					entry = view.pendingPrompts.get(reqId);
				} else {
					for (const e of view.pendingPrompts.values()) entry = e; // most recent
				}
				if (!entry) return;
				updateView(sessionId, v => ({ ...v, banners: v.banners.filter(b => b.kind !== "prompt-error") }));
				await get().sendPrompt(sessionId, entry.text, { images: entry.images });
			},

			async abort(sessionId: string): Promise<void> {
				try {
					await requireClient().rpc(sessionId, { type: "abort" });
				} catch (err) {
					get().pushToast("error", err instanceof Error ? err.message : "停止失败");
				}
			},

			answerUi(sessionId: string, response: ExtensionUiResponse, meta?: { always?: boolean }): void {
				// No client = gallery / offline preview: still resolve locally instead of throwing "not initialized".
				client?.send({ t: "ui_response", sessionId, frame: response });
				updateView(sessionId, v => resolveUi(v, response.id, { response, ...(meta?.always ? { always: true } : {}) }));
			},

			approve(sessionId: string, requestId: string, always: boolean): void {
				const view = get().views[sessionId];
				const req = view?.pendingUi.find(r => r.id === requestId);
				if (always && req && isApprovalRequest(req)) {
					const approval = parseApproval(req);
					if (approval) {
						client?.send({ t: "auto_approve", sessionId, toolName: approval.toolName });
					}
				}
				get().answerUi(sessionId, { type: "extension_ui_response", id: requestId, value: APPROVE }, { always });
			},

			pushToast(level: NotifyType, message: string): void {
				toastCounter += 1;
				const toast: Toast = { id: toastCounter, level, message };
				set(s => ({ toasts: [...s.toasts, toast] }));
			},

			dismissToast(id: number): void {
				set(s => ({ toasts: s.toasts.filter(t => t.id !== id) }));
			},
		};
	});

	return store;
}

export const useAppStore = createAppStore();
