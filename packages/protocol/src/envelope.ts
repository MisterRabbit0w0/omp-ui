/**
 * Bridge <-> Browser envelope (docs/DESIGN.md §5). Shared contract: the bridge
 * and the web client both import from here; neither redefines these shapes.
 */
import type { ExtensionUiResponse, RpcResponse, RpcServerFrame, RpcWireCommands } from "./rpc-wire";

export type ApprovalMode = "always-ask" | "write" | "yolo";
export type ProcState = "starting" | "ready" | "exited" | "crashed";

/** Command name -> `{ type, ...params }` without `id` (the bridge assigns ids). */
export type RpcCommandName = keyof RpcWireCommands;
export type RpcCommand = {
	[K in RpcCommandName]: RpcWireCommands[K]["params"] extends undefined
		? { type: K }
		: { type: K } & RpcWireCommands[K]["params"];
}[RpcCommandName];
export type RpcResultOf<K extends RpcCommandName> = RpcWireCommands[K]["result"];

// ── browser -> bridge ───────────────────────────────────────────────
export type C2B =
	| { t: "hello"; token: string }
	| { t: "attach"; sessionId: string; sinceSeq?: number }
	| { t: "detach"; sessionId: string }
	/** The session this tab shows (null = none). Pins its process in the pool; others may be released when idle. */
	| { t: "focus"; sessionId: string | null }
	| {
			t: "start";
			reqId: string;
			cwd: string;
			/** Session file to resume (`--resume`). */
			resume?: string;
			/** With `resume`: use `--restore` (crash recovery) instead. */
			restore?: boolean;
			/** `provider/id`. */
			model?: string;
			thinking?: string;
			approvalMode?: ApprovalMode;
	  }
	| { t: "stop"; sessionId: string }
	| { t: "rpc"; reqId: string; sessionId: string; cmd: RpcCommand }
	| { t: "ui_response"; sessionId: string; frame: ExtensionUiResponse }
	/** Session-scoped "always allow this tool" (DESIGN §7.3). Lives in the bridge until the process exits. */
	| { t: "auto_approve"; sessionId: string; toolName: string };

// ── bridge -> browser ───────────────────────────────────────────────
export type B2C =
	| { t: "welcome"; ompVersion: string; protocolVersion: 1 | 2 }
	| { t: "started"; reqId: string; sessionId: string; sessionFile?: string }
	| { t: "rpc_result"; reqId: string; response: RpcResponse }
	/** Every pushed frame (notifications, UI requests, events), after v2 reassembly. `seq` is per session, monotonic. */
	| { t: "frame"; sessionId: string; seq: number; frame: RpcServerFrame }
	| { t: "resync"; sessionId: string }
	| { t: "ui_resolved"; sessionId: string; id: string; auto?: boolean }
	/** `reason: "released"`: the pool stopped an idle process to free resources (not an error; restart on demand). */
	| { t: "proc"; sessionId: string; state: ProcState; reason?: "released"; code?: number; stderrTail?: string }
	| { t: "sessions_changed" }
	| { t: "error"; reqId?: string; message: string };

// ── HTTP DTOs (DESIGN §5 table) ─────────────────────────────────────
export interface SessionListItem {
	id: string;
	file: string;
	cwd: string;
	title: string;
	createdAt: string;
	updatedAt: string;
	sizeBytes: number;
	live: boolean;
	/** The live process is between `agent_start` and `session_settled`. */
	running: boolean;
	archived: boolean;
}
export interface ProjectItem {
	cwd: string;
	name: string;
	lastUsedAt: string;
	sessionCount: number;
}
/** One selectable chat model from the `omp models --json` catalog (GET /api/models). */
export interface CatalogModel {
	provider: string;
	id: string;
	/** `provider/id`, the form `--model` and `UiConfig.defaultModel` use. */
	selector: string;
	name: string;
	contextWindow: number | null;
	maxTokens: number | null;
	reasoning: boolean;
	input: string[];
}
export interface FileHit {
	path: string;
	dir: string;
	name: string;
}
export interface UiConfig {
	defaultModel?: string;
	defaultThinking?: string;
	defaultApprovalMode?: ApprovalMode;
	theme?: "system" | "light" | "dark";
	archived: string[];
	recentProjects: string[];
	notifications?: boolean;
	ghostText?: boolean;
}
export interface Diagnostics {
	sessionId: string;
	stderrTail: string;
	parseErrors: { at: string; line: string; error: string }[];
	frameCount: number;
	droppedFrames: number;
}

export const WS_PATH = "/ws";
export const DEFAULT_PORT = 4317;
