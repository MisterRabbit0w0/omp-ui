/**
 * WebSocket client for the bridge (DESIGN §5, §11). One connection carries
 * every attached session; RPC commands are correlated by client-side reqId.
 * Reconnects with exponential backoff and re-attaches sessions with
 * `sinceSeq: lastSeq` so the bridge replays missed frames.
 */
import {
	WS_PATH,
	type ApprovalMode,
	type B2C,
	type C2B,
	type RpcCommand,
	type RpcCommandName,
	type RpcResultOf,
} from "@omp-ui/protocol";

export type ConnectionState = "connected" | "reconnecting" | "closed";

export class BridgeRpcError extends Error {
	readonly code?: string;
	readonly command?: string;
	constructor(message: string, code?: string, command?: string) {
		super(message);
		this.name = "BridgeRpcError";
		this.code = code;
		this.command = command;
	}
}

/** Minimal WebSocket surface, so tests can inject a mock. */
export interface WebSocketLike {
	readonly readyState: number;
	send(data: string): void;
	close(): void;
	onopen: (() => void) | null;
	onmessage: ((ev: { data: unknown }) => void) | null;
	onclose: (() => void) | null;
	onerror: (() => void) | null;
}

export interface StartOptions {
	cwd: string;
	resume?: string;
	restore?: boolean;
	model?: string;
	thinking?: string;
	approvalMode?: ApprovalMode;
}

export interface StartResult {
	sessionId: string;
	sessionFile?: string;
}

export interface BridgeClientOptions {
	/** Default: ws(s)://<page host><WS_PATH>. */
	url?: string;
	/** Default: resolveBridgeToken(). */
	token?: string | null;
	WebSocketImpl?: new (url: string) => WebSocketLike;
	onMessage?: (msg: B2C) => void;
	onConnection?: (state: ConnectionState) => void;
	backoff?: { initialMs?: number; maxMs?: number };
	/** Start connecting immediately (default true). */
	autoConnect?: boolean;
}

const TOKEN_STORAGE_KEY = "omp-ui:token";

/**
 * Token bootstrap (DESIGN §3.7): read `#token=` from the URL hash, stash it in
 * sessionStorage, scrub the hash so it never reaches logs or history.
 */
export function resolveBridgeToken(): string | null {
	if (typeof location !== "undefined") {
		const match = /[#&]token=([^&]+)/.exec(location.hash);
		if (match?.[1]) {
			const token = match[1];
			try {
				sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
				history.replaceState(null, "", location.pathname + location.search);
			} catch {
				/* storage unavailable; keep in memory only */
			}
			return token;
		}
	}
	try {
		return sessionStorage.getItem(TOKEN_STORAGE_KEY);
	} catch {
		return null;
	}
}

interface PendingRpc {
	resolve: (value: unknown) => void;
	reject: (err: unknown) => void;
	command: string;
}

export class BridgeClient {
	private ws: WebSocketLike | null = null;
	private state: ConnectionState = "closed";
	private reqCounter = 0;
	private readonly pending = new Map<string, PendingRpc>();
	private readonly startPending = new Map<string, { resolve: (r: StartResult) => void; reject: (err: unknown) => void }>();
	/** Attached sessions and the last frame seq seen for each. */
	private readonly attached = new Map<string, number>();
	/** Session this tab shows; re-sent after every reconnect so the bridge keeps its process pinned. */
	private focused: string | null = null;
	/** bridge-internal command id (`b-<seq>`) -> our reqId, for prompt_result correlation. */
	private readonly serverCommandIds = new Map<string, string>();
	private readonly outbox: C2B[] = [];
	private attempts = 0;
	private cancelReconnect: (() => void) | null = null;
	private closedByUser = false;
	private readonly url: string;
	private readonly token: string | null;
	private readonly initialMs: number;
	private readonly maxMs: number;
	private readonly WSImpl: new (url: string) => WebSocketLike;

	constructor(private readonly opts: BridgeClientOptions) {
		this.url =
			opts.url ??
			(typeof location !== "undefined" ? `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${WS_PATH}` : WS_PATH);
		this.token = opts.token !== undefined ? opts.token : resolveBridgeToken();
		this.initialMs = opts.backoff?.initialMs ?? 500;
		this.maxMs = opts.backoff?.maxMs ?? 8000;
		this.WSImpl = opts.WebSocketImpl ?? (globalThis.WebSocket as unknown as new (url: string) => WebSocketLike);
		if (opts.autoConnect !== false) this.connect();
	}

	get connectionState(): ConnectionState {
		return this.state;
	}

	connect(): void {
		if (this.closedByUser) return;
		this.closedByUser = false;
		this.openSocket();
	}

	close(): void {
		this.closedByUser = true;
		this.cancelReconnect?.();
		this.cancelReconnect = null;
		this.failAll(new BridgeRpcError("connection closed"));
		this.ws?.close();
		this.ws = null;
		this.setState("closed");
	}

	send(msg: C2B): void {
		if (this.state === "connected" && this.ws) this.ws.send(JSON.stringify(msg));
		else this.outbox.push(msg);
	}

	attach(sessionId: string): void {
		if (!this.attached.has(sessionId)) this.attached.set(sessionId, 0);
		this.sendAttach(sessionId);
	}

	/** Tell the bridge which session this tab shows (pins it in the process pool; §3.1). */
	focus(sessionId: string | null): void {
		if (this.focused === sessionId) return;
		this.focused = sessionId;
		if (this.state === "connected") this.send({ t: "focus", sessionId });
	}

	detach(sessionId: string): void {
		this.attached.delete(sessionId);
		if (this.state === "connected") this.send({ t: "detach", sessionId });
	}

	start(opts: StartOptions): Promise<StartResult> {
		const reqId = this.nextReqId();
		const { promise, resolve, reject } = Promise.withResolvers<StartResult>();
		this.startPending.set(reqId, { resolve, reject });
		this.send({ t: "start", reqId, ...opts });
		return promise;
	}

	rpc<K extends RpcCommandName>(sessionId: string, cmd: RpcCommand & { type: K }, reqId?: string): Promise<RpcResultOf<K>> {
		const id = reqId ?? this.nextReqId();
		const { promise, resolve, reject } = Promise.withResolvers<RpcResultOf<K>>();
		// PendingRpc stores unknown-typed resolvers across heterogeneous commands.
		this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, command: cmd.type });
		this.send({ t: "rpc", reqId: id, sessionId, cmd });
		return promise;
	}

	/** Map a bridge-internal command id (e.g. from `prompt_result.id`) back to our reqId. */
	resolveReqId(serverCommandId: string): string | undefined {
		return this.serverCommandIds.get(serverCommandId);
	}

	private nextReqId(): string {
		this.reqCounter += 1;
		return `c-${this.reqCounter}`;
	}

	private setState(state: ConnectionState): void {
		if (this.state === state) return;
		this.state = state;
		this.opts.onConnection?.(state);
	}

	private openSocket(): void {
		const ws = new this.WSImpl(this.url);
		this.ws = ws;
		ws.onopen = () => {
			const hello: C2B = { t: "hello", token: this.token ?? "" };
			ws.send(JSON.stringify(hello));
		};
		ws.onmessage = ev => this.handleData(ev.data);
		ws.onclose = () => this.handleClose();
		ws.onerror = () => {
			/* onclose follows */
		};
	}

	private handleData(data: unknown): void {
		if (typeof data !== "string") return;
		let msg: B2C;
		try {
			msg = JSON.parse(data) as B2C;
		} catch {
			return;
		}
		switch (msg.t) {
			case "welcome": {
				this.attempts = 0;
				this.setState("connected");
				// Re-attach every session, replaying from the last seen seq (§11).
				for (const [sessionId] of this.attached) this.sendAttach(sessionId);
				if (this.focused !== null) this.send({ t: "focus", sessionId: this.focused });
				const queued = this.outbox.splice(0);
				for (const m of queued) this.send(m);
				this.opts.onMessage?.(msg);
				return;
			}
			case "started": {
				const p = this.startPending.get(msg.reqId);
				if (p) {
					this.startPending.delete(msg.reqId);
					p.resolve({ sessionId: msg.sessionId, sessionFile: msg.sessionFile });
				}
				return;
			}
			case "rpc_result": {
				if (msg.response.id) this.serverCommandIds.set(msg.response.id, msg.reqId);
				const p = this.pending.get(msg.reqId);
				if (p) {
					this.pending.delete(msg.reqId);
					if (msg.response.success) p.resolve(msg.response.data);
					else p.reject(new BridgeRpcError(msg.response.error ?? "command failed", msg.response.code, msg.response.command));
				}
				return;
			}
			case "frame": {
				const prev = this.attached.get(msg.sessionId);
				if (prev === undefined || msg.seq > prev) this.attached.set(msg.sessionId, msg.seq);
				this.opts.onMessage?.(msg);
				return;
			}
			case "error": {
				if (msg.reqId) {
					const p = this.pending.get(msg.reqId) ?? this.startPending.get(msg.reqId);
					if (p) {
						this.pending.delete(msg.reqId);
						this.startPending.delete(msg.reqId);
						p.reject(new BridgeRpcError(msg.message));
						return;
					}
				}
				this.opts.onMessage?.(msg);
				return;
			}
			default:
				this.opts.onMessage?.(msg);
		}
	}

	private sendAttach(sessionId: string): void {
		const lastSeq = this.attached.get(sessionId) ?? 0;
		const msg: C2B = lastSeq > 0 ? { t: "attach", sessionId, sinceSeq: lastSeq } : { t: "attach", sessionId };
		if (this.state === "connected" && this.ws) this.ws.send(JSON.stringify(msg));
		// While connecting, welcome re-sends attaches for the whole map; nothing to queue.
	}

	private handleClose(): void {
		this.ws = null;
		if (this.closedByUser) {
			this.setState("closed");
			return;
		}
		this.setState("reconnecting");
		const delay = Math.min(this.maxMs, this.initialMs * 2 ** this.attempts);
		this.attempts += 1;
		const timer = setTimeout(() => {
			this.cancelReconnect = null;
			this.openSocket();
		}, delay);
		this.cancelReconnect = () => clearTimeout(timer);
	}

	private failAll(err: unknown): void {
		for (const p of this.pending.values()) p.reject(err);
		this.pending.clear();
		for (const p of this.startPending.values()) p.reject(err);
		this.startPending.clear();
	}
}
