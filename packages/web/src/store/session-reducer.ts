/**
 * Pure per-session view reducer (DESIGN §6.1–§6.3). Every pushed RPC frame is
 * folded into an immutable SessionView; side effects (toasts, refetches, URL
 * opens) are collected into `effects` for the store to drain, never performed
 * here.
 */
import type {
	ApprovalMode,
	AgentMessage,
	AgentSource,
	AssistantContent,
	AssistantMessage,
	AvailableSlashCommand,
	BtwHistoryRecord,
	ExtensionUiRequest,
	ExtensionUiResponse,
	ImageContent,
	MessageContent,
	ModelInfo,
	NotifyType,
	OpenUrlUiRequest,
	ProcState,
	RpcServerFrame,
	SessionState,
	SessionStats,
	SubagentStatus,
	SubagentSnapshot,
	ThinkingLevel,
	TodoPhase,
	ToolCall,
	ToolResultMessage,
	WidgetPlacement,
} from "@omp-ui/protocol";
import { DENY, isApprovalRequest, parseApproval } from "@omp-ui/protocol";
import { parsePartialJson } from "../lib/partial-json";

export type ViewMessage = AgentMessage & { animateOnMount?: boolean };

export interface Draft {
	messageId: string;
	role: string;
	content: AssistantContent[];
	/** Raw streamed tool-call argument text per contentIndex (delta mode has no snapshots). */
	toolArgsText: Map<number, string>;
	done: boolean;
	error: boolean;
}

export interface ToolExec {
	toolCallId: string;
	toolName: string;
	status: "running" | "done" | "error";
	args?: unknown;
	intent?: string;
	partialResult?: unknown;
	result?: unknown;
	streamLog: string;
	startedAt: number;
	endedAt?: number;
}

export type RunStatus =
	| { kind: "idle" }
	| { kind: "running" }
	| { kind: "settling" }
	| { kind: "compacting" }
	| { kind: "retrying"; attempt: number; maxAttempts: number; delayMs: number }
	| { kind: "dead"; crashed: boolean; code?: number; stderrTail?: string };

export type Banner =
	| { kind: "retry"; attempt: number; maxAttempts: number; delayMs: number; errorMessage: string; startedAt: number }
	| { kind: "retry-failed"; attempt: number; finalError?: string }
	| { kind: "compacting" }
	| { kind: "compaction-error"; message: string }
	| { kind: "prompt-error"; message: string; provider?: string; model?: string; httpStatus?: number; retryable: boolean; reqId?: string }
	| { kind: "proc-exit"; crashed: boolean; code?: number; stderrTail?: string };

export type SessionEffect =
	| { kind: "toast"; level: NotifyType; message: string }
	| { kind: "retry_fallback"; from: string; to: string }
	| { kind: "open_url"; url: string; launchUrl?: string; instructions?: string }
	| { kind: "set_editor_text"; text: string }
	| { kind: "refetch_state" }
	| { kind: "refetch_stats" }
	| { kind: "refetch_messages" }
	| { kind: "settled" }
	| { kind: "todo_reminder" };

export interface SubagentView {
	id: string;
	index: number;
	agent: string;
	agentSource: AgentSource;
	description?: string;
	task?: string;
	assignment?: string;
	status: SubagentStatus;
	sessionFile?: string;
	parentToolCallId?: string;
	detached?: boolean;
	progress?: Record<string, unknown>;
	lastUpdate: number;
}

/** A resolved approval `select` or `ask`, kept for receipts / answer summaries (FRONTEND §6.7, §6.8). */
export interface AnsweredUi {
	request: ExtensionUiRequest;
	/** The answer, when this client gave it; absent if another tab/auto-approve/replay resolved it. */
	response?: ExtensionUiResponse;
	/** Resolved by the bridge's session-scoped auto-approve. */
	auto?: boolean;
	/** "总是允许" was ticked when this client approved. */
	always?: boolean;
	/** Tool row the approval was anchored to (the running call of the same tool name at resolve time). */
	toolCallId?: string;
}

const MAX_ANSWERED_UI = 50;

/** Same tool, allowing MCP-prefixed names (`server__tool`, `server:tool`). */
export function toolNamesMatch(callName: string, approvalToolName: string): boolean {
	if (callName === approvalToolName) return true;
	const a = callName.trim().toLowerCase();
	const b = approvalToolName.trim().toLowerCase();
	if (a === b) return true;
	return a.endsWith(`__${b}`) || a.endsWith(`:${b}`) || b.endsWith(`__${a}`) || b.endsWith(`:${a}`);
}

function isTrackedUiRequest(req: ExtensionUiRequest): boolean {
	return req.method === "ask" || isApprovalRequest(req);
}

/**
 * Move a pending request into `answeredUi`. Idempotent: unknown / already-answered ids are ignored,
 * so the live response, the bridge's `ui_resolved` broadcast and replay can all report the same id.
 */
export function resolveUi(
	view: SessionView,
	id: string,
	info: { response?: ExtensionUiResponse; auto?: boolean; always?: boolean } = {},
): SessionView {
	const request = view.pendingUi.find(r => r.id === id);
	if (!request) return view;
	const pendingUi = view.pendingUi.filter(r => r.id !== id && (request.method !== "input" || r.method !== "open_url"));
	const cleared = request.method === "input" && view.lastOpenUrl !== undefined ? { ...view, pendingUi, lastOpenUrl: undefined } : { ...view, pendingUi };
	if (!isTrackedUiRequest(request)) return cleared;
	let toolCallId: string | undefined;
	const approval = isApprovalRequest(request) ? parseApproval(request) : null;
	const toolName = approval?.toolName ?? (request.method === "ask" ? "ask" : undefined);
	if (toolName) {
		for (const exec of view.toolExec.values()) {
			if (exec.status === "running" && toolNamesMatch(exec.toolName, toolName)) toolCallId = exec.toolCallId;
		}
	}
	const entry: AnsweredUi = { request, ...info, ...(toolCallId !== undefined ? { toolCallId } : {}) };
	return { ...cleared, answeredUi: [...view.answeredUi, entry].slice(-MAX_ANSWERED_UI) };
}

export type ApprovalReceiptKind = "approved" | "always" | "denied" | "timed_out";

/** Receipt for an answered approval; the tool result is the durable fallback when no response is known. */
export function approvalReceiptKind(entry: AnsweredUi, result?: ToolResultMessage): ApprovalReceiptKind {
	if (entry.auto || entry.always) return "always";
	const r = entry.response;
	if (r && "cancelled" in r) return r.timedOut ? "timed_out" : "denied";
	if (r && "value" in r) return r.value === DENY ? "denied" : "approved";
	return result?.isError ? "denied" : "approved";
}

/**
 * Latest answered *approval* for a tool call. Ask answers share `toolCallId` with their tool but must
 * render as an ask summary, never as an approval receipt.
 */
export function answeredApprovalFor(answered: ReadonlyArray<AnsweredUi> | undefined, toolCallId: string): AnsweredUi | undefined {
	return answered?.findLast(a => a.toolCallId === toolCallId && isApprovalRequest(a.request));
}

/** One-line summaries `[question, answer]` for an answered ask. */
export function askSummaryLines(entry: AnsweredUi): Array<[string, string]> {
	const req = entry.request;
	if (req.method !== "ask") return [];
	const r = entry.response;
	return req.questions.map((q): [string, string] => {
		if (r && "answers" in r) {
			const a = r.answers.find(x => x.id === q.id);
			const parts = [...(a?.selectedOptions ?? [])];
			if (a?.customInput) parts.push(a.customInput);
			return [q.question, parts.length > 0 ? parts.join("、") : "未作答"];
		}
		if (r && "cancelled" in r) return [q.question, r.timedOut ? "已按推荐答案继续" : "已取消"];
		return [q.question, "已回答"];
	});
}

export interface SessionView {
	sessionId: string;
	proc: "none" | ProcState;
	/** Read-only transcript preview; the process spawns lazily on first send. */
	readonly: boolean;
	lastSeq: number;
	state: SessionState | null;
	title?: string;
	messages: ViewMessage[];
	drafts: Map<string, Draft>;
	toolExec: Map<string, ToolExec>;
	run: RunStatus;
	/** Wall-clock start of the current agent loop (`agent_start`); drives the RunIndicator clock across remounts. */
	runStartedAt?: number;
	queue: { steering: string[]; followUp: string[]; liveSteered: number };
	pendingUi: ExtensionUiRequest[];
	/** Most recent `open_url` request from an active OAuth flow, paired with its follow-up `input` request (DESIGN §7.1). */
	lastOpenUrl?: OpenUrlUiRequest;
	/** Approval/ask requests that were answered (here, in another tab, auto-approved, or found resolved on replay). */
	answeredUi: AnsweredUi[];
	statusChips: Map<string, string>;
	widgets: Map<string, { lines: string[]; placement: WidgetPlacement }>;
	subagents: Map<string, SubagentView>;
	btw: Map<string, BtwHistoryRecord>;
	/** Streamed answer text per btw record id, merged into the record on `btw_record`. */
	btwDeltas: Map<string, string>;
	commands: AvailableSlashCommand[];
	models: ModelInfo[];
	thinkingLevels: ThinkingLevel[];
	stats: SessionStats | null;
	banners: Banner[];
	/** reqId -> original prompt, kept so a failed prompt can be resent (DESIGN §11). */
	pendingPrompts: Map<string, { text: string; images?: ImageContent[] }>;
	/** Cost/token stats changed; the store refetches and clears this flag. */
	statsStale: boolean;
	/** Approval mode this session's process was started with (omp has no RPC to read it back); undefined = unknown, use the config default. */
	approvalMode?: ApprovalMode;
	/** Mode picked while a run was active; applied (process restart) right before the next prompt is sent. */
	pendingApprovalMode?: ApprovalMode;
	effects: SessionEffect[];
}

export function createSessionView(sessionId: string, init?: Partial<Pick<SessionView, "proc" | "readonly" | "title" | "approvalMode" | "pendingApprovalMode">>): SessionView {
	return {
		sessionId,
		proc: init?.proc ?? "none",
		readonly: init?.readonly ?? false,
		lastSeq: 0,
		state: null,
		title: init?.title,
		approvalMode: init?.approvalMode,
		pendingApprovalMode: init?.pendingApprovalMode,
		messages: [],
		drafts: new Map(),
		toolExec: new Map(),
		run: { kind: "idle" },
		queue: { steering: [], followUp: [], liveSteered: 0 },
		pendingUi: [],
		answeredUi: [],
		statusChips: new Map(),
		widgets: new Map(),
		subagents: new Map(),
		btw: new Map(),
		btwDeltas: new Map(),
		commands: [],
		models: [],
		thinkingLevels: [],
		stats: null,
		banners: [],
		pendingPrompts: new Map(),
		statsStale: false,
		effects: [],
	};
}

/** Stable key for frames about one message; `messageId` is optional on the wire. */
function messageKey(frame: { messageId?: string; message: AgentMessage }): string {
	// Every AgentMessage variant carries `timestamp`.
	return frame.messageId ?? `anon-${frame.message.role}-${frame.message.timestamp}`;
}

function draftFromMessage(message: AgentMessage, messageId: string): Draft {
	let content: AssistantContent[] = [];
	if (message.role === "assistant") {
		// In delta mode `message_start.message` is only `{role}`; content arrives via updates.
		content = Array.isArray(message.content) ? [...message.content] : [];
	} else if (message.role === "user" || message.role === "developer" || message.role === "custom" || message.role === "hookMessage") {
		const c: MessageContent = message.content;
		content = typeof c === "string" ? (c.length > 0 ? [{ type: "text", text: c }] : []) : [...c];
	}
	return { messageId, role: message.role, content, toolArgsText: new Map(), done: false, error: false };
}

/** `todo` tool result → `details.phases` (the complete list after the op), when well-formed. */
function todoPhasesFromResult(result: unknown): TodoPhase[] | undefined {
	if (result === null || typeof result !== "object" || !("details" in result)) return undefined;
	const details = result.details;
	if (details === null || typeof details !== "object" || !("phases" in details) || !Array.isArray(details.phases)) return undefined;
	const phases: TodoPhase[] = [];
	for (const p of details.phases) {
		if (p === null || typeof p !== "object" || typeof p.name !== "string" || !Array.isArray(p.tasks)) return undefined;
		phases.push(p as TodoPhase);
	}
	return phases;
}

function upsertBanner(banners: Banner[], banner: Banner): Banner[] {
	// One banner per kind family: a new retry/compaction banner replaces its predecessor.
	const family = (b: Banner): string =>
		b.kind === "retry" || b.kind === "retry-failed" ? "retry" : b.kind === "compacting" || b.kind === "compaction-error" ? "compaction" : b.kind;
	return [...banners.filter(b => family(b) !== family(banner)), banner];
}

/**
 * Prompt ack: `agentInvoked: false` means the prompt completed locally (some
 * slash commands) and no `prompt_result` follows (DESIGN §6.3).
 */
export function reducePromptAck(view: SessionView, agentInvoked: boolean | undefined): SessionView {
	if (view.run.kind === "dead") return view;
	if (agentInvoked === false) return { ...view, run: { kind: "idle" } };
	return { ...view, run: { kind: "running" } };
}

/** Process lifecycle from the bridge (B2C `proc`); not an RPC frame. */
export function reduceProc(view: SessionView, proc: ProcState, info?: { code?: number; stderrTail?: string }): SessionView {
	if (proc === "exited" || proc === "crashed") {
		const crashed = proc === "crashed";
		return {
			...view,
			proc,
			run: { kind: "dead", crashed, code: info?.code, stderrTail: info?.stderrTail },
			banners: upsertBanner(view.banners, { kind: "proc-exit", crashed, code: info?.code, stderrTail: info?.stderrTail }),
		};
	}
	const run: RunStatus = view.run.kind === "dead" ? { kind: "idle" } : view.run;
	return { ...view, proc, run, banners: view.banners.filter(b => b.kind !== "proc-exit") };
}

/**
 * The bridge released an idle process to free resources (§3.1): not an error. The transcript stays, no exit
 * banner; the next interaction (opening it, sending, picking a model) starts a fresh process.
 */
export function releaseProc(view: SessionView): SessionView {
	return {
		...view,
		proc: "none",
		run: view.run.kind === "dead" ? view.run : { kind: "idle" },
		pendingUi: [],
		banners: view.banners.filter(b => b.kind !== "proc-exit"),
	};
}

/** Discard everything server-owned; the store follows with a cold start (§3.4 resync). */
export function resetForResync(view: SessionView): SessionView {
	return createSessionView(view.sessionId, { proc: view.proc === "none" ? "none" : view.proc, title: view.title, approvalMode: view.approvalMode, pendingApprovalMode: view.pendingApprovalMode });
}

export function reduce(view: SessionView, frame: RpcServerFrame, ctx: { live: boolean }): SessionView {
	switch (frame.type) {
		case "message_start": {
			const id = messageKey(frame);
			const drafts = new Map(view.drafts);
			drafts.set(id, draftFromMessage(frame.message, id));
			return { ...view, drafts };
		}

		case "message_update": {
			const id = messageKey(frame);
			const ev = frame.assistantMessageEvent;
			const prev = view.drafts.get(id);
			const draft: Draft = prev
				? { ...prev, content: [...prev.content], toolArgsText: new Map(prev.toolArgsText) }
				: draftFromMessage(frame.message, id);
			const idx = "contentIndex" in ev ? ev.contentIndex : -1;
			switch (ev.type) {
				case "start":
					// Draft already created from the partial above.
					break;
				case "text_start":
					draft.content[idx] = { type: "text", text: "" };
					break;
				case "text_delta": {
					const block = draft.content[idx];
					draft.content[idx] = block && block.type === "text" ? { ...block, text: block.text + ev.delta } : { type: "text", text: ev.delta };
					break;
				}
				case "text_end":
					draft.content[idx] = { type: "text", text: ev.content };
					break;
				case "thinking_start":
					draft.content[idx] = { type: "thinking", thinking: "" };
					break;
				case "thinking_delta": {
					const block = draft.content[idx];
					draft.content[idx] =
						block && block.type === "thinking" ? { ...block, thinking: block.thinking + ev.delta } : { type: "thinking", thinking: ev.delta };
					break;
				}
				case "thinking_end":
					draft.content[idx] = { type: "thinking", thinking: ev.content };
					break;
				case "image_end":
					draft.content[idx] = ev.content;
					break;
				case "toolcall_start":
					draft.content[idx] = { type: "toolCall", id: "", name: "", arguments: {} };
					draft.toolArgsText.set(idx, "");
					break;
				case "toolcall_delta": {
					const text = (draft.toolArgsText.get(idx) ?? "") + ev.delta;
					draft.toolArgsText.set(idx, text);
					const existing = draft.content[idx];
					const parsed = parsePartialJson(text);
					// Only plain objects are valid tool args; parsed JSON narrowed to object is a string-keyed record.
					const preview: Record<string, unknown> =
						parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
					draft.content[idx] = {
						type: "toolCall",
						id: existing && existing.type === "toolCall" ? existing.id : "",
						name: existing && existing.type === "toolCall" ? existing.name : "",
						arguments: preview,
					};
					break;
				}
				case "toolcall_end":
					// Server is authoritative; overwrites the accumulated preview (§6.2).
					draft.content[idx] = ev.toolCall;
					draft.toolArgsText.delete(idx);
					break;
				case "done":
					draft.done = true;
					break;
				case "error":
					draft.done = true;
					draft.error = true;
					break;
			}
			const drafts = new Map(view.drafts);
			drafts.set(id, draft);
			return { ...view, drafts };
		}

		case "message_end": {
			const id = messageKey(frame);
			const drafts = new Map(view.drafts);
			drafts.delete(id);
			// The complete message always overwrites the accumulated draft (§6.2).
			return { ...view, drafts, messages: [...view.messages, { ...frame.message, animateOnMount: ctx.live } as ViewMessage] };
		}

		case "agent_start":
			if (view.run.kind === "dead") return view;
			// A loop restarting mid-run (follow-up turn) keeps its original start time.
			return { ...view, run: { kind: "running" }, runStartedAt: view.run.kind === "idle" || view.runStartedAt === undefined ? Date.now() : view.runStartedAt };

		case "agent_end": {
			let next: SessionView = { ...view, drafts: new Map() };
			if (view.run.kind === "running" && frame.yielded === true && frame.awaitingAsyncWork !== true) {
				next = { ...next, run: { kind: "settling" } };
			}
			if (frame.messageCount !== undefined && frame.messageCount > view.messages.length) {
				next = { ...next, effects: [...next.effects, { kind: "refetch_messages" }] };
			}
			return next;
		}

		case "session_settled":
			return { ...view, run: { kind: "idle" }, effects: [...view.effects, { kind: "settled" }] };

		case "prompt_result": {
			let next: SessionView = { ...view, statsStale: true };
			if (frame.status === "error") {
				const e = frame.error;
				next = {
					...next,
					run: { kind: "idle" },
					banners: upsertBanner(next.banners, {
						kind: "prompt-error",
						message: e?.message ?? "Unknown error",
						provider: e?.provider,
						model: e?.model,
						httpStatus: e?.httpStatus,
						retryable: e?.retryable ?? false,
						reqId: frame.id,
					}),
				};
			}
			if (frame.id && next.pendingPrompts.has(frame.id) && frame.status !== "error") {
				const pendingPrompts = new Map(next.pendingPrompts);
				pendingPrompts.delete(frame.id);
				next = { ...next, pendingPrompts };
			}
			return next;
		}

		case "turn_start":
			return view;

		case "turn_end":
			return { ...view, statsStale: true, effects: [...view.effects, { kind: "refetch_stats" }] };

		case "tool_execution_start": {
			const toolExec = new Map(view.toolExec);
			toolExec.set(frame.toolCallId, {
				toolCallId: frame.toolCallId,
				toolName: frame.toolName,
				status: "running",
				args: frame.args,
				intent: frame.intent,
				streamLog: "",
				startedAt: Date.now(),
			});
			return { ...view, toolExec };
		}

		case "tool_execution_update": {
			const prev = view.toolExec.get(frame.toolCallId);
			if (!prev) return view;
			const toolExec = new Map(view.toolExec);
			toolExec.set(frame.toolCallId, { ...prev, args: frame.args ?? prev.args, partialResult: frame.partialResult });
			return { ...view, toolExec };
		}

		case "tool_stream_update": {
			const prev = view.toolExec.get(frame.toolCallId);
			if (!prev) return view;
			const chunk = typeof frame.update === "string" ? frame.update : frame.update === undefined ? "" : `${JSON.stringify(frame.update)}\n`;
			if (!chunk) return view;
			const toolExec = new Map(view.toolExec);
			toolExec.set(frame.toolCallId, { ...prev, streamLog: prev.streamLog + chunk });
			return { ...view, toolExec };
		}

		case "tool_execution_end": {
			const prev = view.toolExec.get(frame.toolCallId);
			const toolExec = new Map(view.toolExec);
			toolExec.set(frame.toolCallId, {
				toolCallId: frame.toolCallId,
				toolName: frame.toolName,
				status: frame.isError ? "error" : "done",
				args: prev?.args,
				intent: prev?.intent,
				partialResult: prev?.partialResult,
				result: frame.result,
				streamLog: prev?.streamLog ?? "",
				startedAt: prev?.startedAt ?? Date.now(),
				endedAt: Date.now(),
			});
			// The todo tool's result carries the full list (`details.phases`); apply it now instead of
			// waiting for an unrelated `get_state` refetch, so the 待办 tab tracks the agent live.
			const phases = frame.toolName === "todo" && !frame.isError ? todoPhasesFromResult(frame.result) : undefined;
			if (phases) {
				return {
					...view,
					toolExec,
					statsStale: true,
					state: view.state ? { ...view.state, todoPhases: phases } : { sessionId: view.sessionId, todoPhases: phases },
				};
			}
			return { ...view, toolExec, statsStale: true };
		}

		case "queue_update":
			return { ...view, queue: { steering: frame.steering, followUp: frame.followUp, liveSteered: frame.liveSteered ?? 0 } };

		case "auto_compaction_start":
			return {
				...view,
				run: view.run.kind === "dead" ? view.run : { kind: "compacting" },
				banners: upsertBanner(view.banners, { kind: "compacting" }),
			};

		case "auto_compaction_end": {
			let banners: Banner[] = view.banners.filter(b => b.kind !== "compacting" && b.kind !== "compaction-error");
			if (frame.errorMessage && !frame.skipped && !frame.aborted) {
				banners = upsertBanner(banners, { kind: "compaction-error", message: frame.errorMessage });
			}
			return { ...view, run: view.run.kind === "compacting" ? { kind: "running" } : view.run, banners, statsStale: true };
		}

		case "auto_retry_start":
			return {
				...view,
				run: view.run.kind === "dead" ? view.run : { kind: "retrying", attempt: frame.attempt, maxAttempts: frame.maxAttempts, delayMs: frame.delayMs },
				banners: upsertBanner(view.banners, {
					kind: "retry",
					attempt: frame.attempt,
					maxAttempts: frame.maxAttempts,
					delayMs: frame.delayMs,
					errorMessage: frame.errorMessage,
					startedAt: Date.now(),
				}),
			};

		case "auto_retry_end": {
			let banners: Banner[] = view.banners.filter(b => b.kind !== "retry" && b.kind !== "retry-failed");
			if (!frame.success) {
				banners = upsertBanner(banners, { kind: "retry-failed", attempt: frame.attempt, finalError: frame.finalError });
			}
			return { ...view, run: view.run.kind === "retrying" ? { kind: "running" } : view.run, banners };
		}

		case "extension_ui_request": {
			switch (frame.method) {
				case "select":
				case "confirm":
				case "input":
				case "editor":
				case "ask": {
					const pendingUi = [...view.pendingUi.filter(r => r.id !== frame.id), frame];
					return { ...view, pendingUi };
				}
				case "cancel":
					return resolveUi(view, frame.targetId, { response: { type: "extension_ui_response", id: frame.targetId, cancelled: true } });
				case "notify":
					return { ...view, effects: [...view.effects, { kind: "toast", level: frame.notifyType ?? "info", message: frame.message }] };
				case "setStatus": {
					const statusChips = new Map(view.statusChips);
					if (frame.statusText) statusChips.set(frame.statusKey, frame.statusText);
					else statusChips.delete(frame.statusKey);
					return { ...view, statusChips };
				}
				case "setWidget": {
					const widgets = new Map(view.widgets);
					if (frame.widgetLines && frame.widgetLines.length > 0) {
						widgets.set(frame.widgetKey, { lines: frame.widgetLines, placement: frame.widgetPlacement ?? "belowEditor" });
					} else {
						widgets.delete(frame.widgetKey);
					}
					return { ...view, widgets };
				}
				case "setTitle":
					return { ...view, title: frame.title };
				case "set_editor_text":
					return { ...view, effects: [...view.effects, { kind: "set_editor_text", text: frame.text }] };
				case "open_url":
					return {
						...view,
						lastOpenUrl: frame,
						effects: [...view.effects, { kind: "open_url", url: frame.url, launchUrl: frame.launchUrl, instructions: frame.instructions }],
					};
			}
			return view;
		}

		case "available_commands_update":
			return { ...view, commands: frame.commands };

		case "session_info_update":
			return frame.title === undefined ? view : { ...view, title: frame.title };

		case "model_changed":
		case "thinking_level_changed":
		case "config_update":
		case "goal_updated":
		case "todo_auto_clear":
			return { ...view, effects: [...view.effects, { kind: "refetch_state" }] };

		case "todo_reminder":
			return { ...view, effects: [...view.effects, { kind: "todo_reminder" }, { kind: "refetch_state" }] };

		case "notice":
			return { ...view, effects: [...view.effects, { kind: "toast", level: frame.level, message: frame.message }] };

		case "irc_message":
			return { ...view, messages: [...view.messages, { ...frame.message, animateOnMount: ctx.live } as ViewMessage] };

		case "command_output":
			return {
				...view,
				messages: [
					...view.messages,
					{ role: "custom", customType: "command_output", content: frame.text, display: true, timestamp: Date.now(), animateOnMount: ctx.live },
				],
			};

		case "ttsr_triggered":
			return {
				...view,
				messages: [
					...view.messages,
					{ role: "custom", customType: "ttsr_triggered", content: "", display: true, timestamp: Date.now(), animateOnMount: ctx.live },
				],
			};

		case "subagent_lifecycle": {
			const p = frame.payload;
			const subagents = new Map(view.subagents);
			const prev = subagents.get(p.id);
			subagents.set(p.id, {
				id: p.id,
				index: p.index,
				agent: p.agent,
				agentSource: p.agentSource,
				description: p.description ?? prev?.description,
				task: prev?.task,
				assignment: prev?.assignment,
				status: p.status === "started" ? "running" : p.status,
				sessionFile: p.sessionFile ?? prev?.sessionFile,
				parentToolCallId: p.parentToolCallId ?? prev?.parentToolCallId,
				detached: p.detached ?? prev?.detached,
				progress: prev?.progress,
				lastUpdate: Date.now(),
			});
			return { ...view, subagents };
		}

		case "subagent_progress": {
			const p = frame.payload;
			const subagents = new Map(view.subagents);
			let key = `idx-${p.index}`;
			for (const [id, s] of subagents) {
				if (s.index === p.index) {
					key = id;
					break;
				}
			}
			const prev = subagents.get(key);
			subagents.set(key, {
				id: prev?.id ?? key,
				index: p.index,
				agent: p.agent,
				agentSource: p.agentSource,
				description: prev?.description,
				task: p.task,
				assignment: p.assignment ?? prev?.assignment,
				status: prev?.status ?? "running",
				sessionFile: p.sessionFile ?? prev?.sessionFile,
				parentToolCallId: p.parentToolCallId ?? prev?.parentToolCallId,
				detached: p.detached ?? prev?.detached,
				progress: p.progress,
				lastUpdate: Date.now(),
			});
			return { ...view, subagents };
		}

		case "btw_delta": {
			const btwDeltas = new Map(view.btwDeltas);
			btwDeltas.set(frame.recordId, (btwDeltas.get(frame.recordId) ?? "") + frame.delta);
			return { ...view, btwDeltas };
		}

		case "btw_record": {
			const btw = new Map(view.btw);
			btw.set(frame.record.id, frame.record);
			const btwDeltas = new Map(view.btwDeltas);
			btwDeltas.delete(frame.record.id);
			return { ...view, btw, btwDeltas };
		}

		case "retry_fallback_applied":
			return { ...view, effects: [...view.effects, { kind: "retry_fallback", from: frame.from, to: frame.to }] };

		case "retry_fallback_succeeded":
			return { ...view, effects: [...view.effects, { kind: "toast", level: "info", message: `已回退到 ${frame.model}` }] };

		case "extension_error":
			return { ...view, effects: [...view.effects, { kind: "toast", level: "error", message: `${frame.extensionPath}: ${frame.error}` }] };

		case "rpc_frame_error":
			return { ...view, effects: [...view.effects, { kind: "refetch_messages" }] };

		// Diagnostics-only or unrelated: ready, cache_warming_*, live_*,
		// subagent_event (drawer stream), advisor_*, config_warnings_changed,
		// response (correlated in the client), host_* requests.
		default:
			return view;
	}
}

// ── selectors ───────────────────────────────────────────────────────

export const READ_ONLY_TOOLS: Record<string, true> = { read: true, grep: true, glob: true, find: true, lsp: true };

export interface TurnTool {
	call: ToolCall;
	result?: ToolResultMessage;
	exec?: ToolExec;
}

export interface ToolGroup {
	tools: TurnTool[];
	/** ≥3 consecutive read-only calls merged into one collapsible row (FRONTEND §6.5). */
	readOnlyCollapsed: boolean;
}

export interface AssistantTurn {
	messages: AssistantMessage[];
	tools: TurnTool[];
	groups: ToolGroup[];
}

export type TranscriptItem =
	| { kind: "message"; message: ViewMessage }
	| { kind: "turn"; turn: AssistantTurn }
	| { kind: "draft"; draft: Draft };

function buildTurn(messages: AssistantMessage[], results: ToolResultMessage[], toolExec: Map<string, ToolExec>): AssistantTurn {
	const resultsByCallId = new Map<string, ToolResultMessage>();
	for (const r of results) resultsByCallId.set(r.toolCallId, r);
	const tools: TurnTool[] = [];
	for (const m of messages) {
		for (const block of m.content) {
			if (block.type === "toolCall") {
				tools.push({ call: block, result: resultsByCallId.get(block.id), exec: toolExec.get(block.id) });
			}
		}
	}
	const groups: ToolGroup[] = [];
	let i = 0;
	while (i < tools.length) {
		const t = tools[i]!;
		if (READ_ONLY_TOOLS[t.call.name] === true) {
			let j = i;
			while (j < tools.length && READ_ONLY_TOOLS[tools[j]!.call.name] === true) j++;
			if (j - i >= 3) {
				groups.push({ tools: tools.slice(i, j), readOnlyCollapsed: true });
			} else {
				for (let k = i; k < j; k++) groups.push({ tools: [tools[k]!], readOnlyCollapsed: false });
			}
			i = j;
		} else {
			groups.push({ tools: [t], readOnlyCollapsed: false });
			i++;
		}
	}
	return { messages, tools, groups };
}

/**
 * Group committed messages into standalone messages and assistant turns
 * (FRONTEND §6.5): an assistant message plus its tool results (merged into
 * the tool calls by toolCallId) plus following assistant messages, until the
 * next visible non-assistant message. Hidden messages (developer reminders,
 * non-display custom/hook messages) are dropped and never split a turn.
 * Streaming drafts trail the list.
 */
export function selectTurns(view: SessionView): TranscriptItem[] {
	const items: TranscriptItem[] = [];
	let turnMessages: AssistantMessage[] = [];
	let turnResults: ToolResultMessage[] = [];
	let turnOpen = false;
	const closeTurn = (): void => {
		if (!turnOpen) return;
		items.push({ kind: "turn", turn: buildTurn(turnMessages, turnResults, view.toolExec) });
		turnMessages = [];
		turnResults = [];
		turnOpen = false;
	};
	for (const m of view.messages) {
		if (m.role === "developer" || ((m.role === "custom" || m.role === "hookMessage") && !m.display)) continue;
		if (m.role === "assistant") {
			turnOpen = true;
			turnMessages.push(m);
		} else if (m.role === "toolResult" && turnOpen) {
			turnResults.push(m);
		} else {
			closeTurn();
			items.push({ kind: "message", message: m });
		}
	}
	closeTurn();
	for (const draft of view.drafts.values()) items.push({ kind: "draft", draft });
	return items;
}

export interface ChangedFile {
	path: string;
	tool: string;
	toolCallId: string;
	additions?: number;
	deletions?: number;
}

const CHANGE_TOOLS: Record<string, true> = { edit: true, write: true, notebook: true };

function numberField(rec: Record<string, unknown>, keys: readonly string[]): number | undefined {
	for (const k of keys) {
		const v = rec[k];
		if (typeof v === "number") return v;
	}
	return undefined;
}

function changedFileEntry(rec: Record<string, unknown>, tool: string, toolCallId: string, fallbackPath?: string): ChangedFile | null {
	const p = rec.resolvedPath ?? rec.path ?? rec.file ?? rec.filePath ?? fallbackPath;
	if (typeof p !== "string" || p.length === 0) return null;
	return {
		path: p,
		tool,
		toolCallId,
		additions: numberField(rec, ["additions", "addedLines", "added"]),
		deletions: numberField(rec, ["deletions", "removedLines", "removed"]),
	};
}

/**
 * Successful edit/write/notebook calls, one entry per touched file, for the 变更 panel (DESIGN §9.7).
 * omp's hashline `edit` carries no path argument: the file comes from `details.path` or
 * `details.perFileResults[].path` (multi-file), `write` reports `details.resolvedPath`.
 */
export function selectChangedFiles(view: SessionView): ChangedFile[] {
	const resultsByCallId = new Map<string, ToolResultMessage>();
	for (const m of view.messages) {
		if (m.role === "toolResult") resultsByCallId.set(m.toolCallId, m);
	}
	const out: ChangedFile[] = [];
	for (const m of view.messages) {
		if (m.role !== "assistant") continue;
		for (const block of m.content) {
			if (block.type !== "toolCall" || CHANGE_TOOLS[block.name] !== true) continue;
			const result = resultsByCallId.get(block.id);
			const exec = view.toolExec.get(block.id);
			const success = result ? !result.isError : exec?.status === "done";
			if (!success) continue;
			const args = block.arguments;
			const argPath = args.path ?? args.file ?? args.filePath ?? args.notebookPath;
			const details: unknown = result?.details;
			const det: Record<string, unknown> = details !== null && typeof details === "object" ? (details as Record<string, unknown>) : {};
			if (Array.isArray(det.perFileResults) && det.perFileResults.length > 0) {
				for (const item of det.perFileResults) {
					if (item === null || typeof item !== "object") continue;
					const entry = changedFileEntry(item as Record<string, unknown>, block.name, block.id);
					if (entry) out.push(entry);
				}
				continue;
			}
			const entry = changedFileEntry(det, block.name, block.id, typeof argPath === "string" ? argPath : undefined);
			if (entry) out.push(entry);
		}
	}
	return out;
}

/** Cold-start subagent snapshots (get_subagents) into the view map. */
export function subagentsFromSnapshots(snapshots: SubagentSnapshot[]): Map<string, SubagentView> {
	const map = new Map<string, SubagentView>();
	for (const s of snapshots) {
		map.set(s.id, {
			id: s.id,
			index: s.index,
			agent: s.agent,
			agentSource: s.agentSource,
			description: s.description,
			task: s.task,
			assignment: s.assignment,
			status: s.status,
			sessionFile: s.sessionFile,
			parentToolCallId: s.parentToolCallId,
			progress: s.progress,
			lastUpdate: s.lastUpdate,
		});
	}
	return map;
}
