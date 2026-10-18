/**
 * OmpProcess: one `omp --mode rpc-ui` child per open session (docs/DESIGN.md §3.1–3.4).
 *
 * Responsibilities: spawn, NDJSON frame parsing, v1->v2 negotiation, rpc_chunk
 * reassembly, command id correlation with per-command timeouts, serialized
 * stdin writes, the §3.3 init sequence, the per-session frame ring buffer,
 * the pendingUi set, session-scoped auto-approve, and graceful shutdown.
 */
import type { Subprocess } from "bun";
import type {
	ApprovalMode,
	ExtensionUiRequest,
	ExtensionUiResponse,
	RpcCommand,
	RpcResponse,
	RpcServerFrame,
} from "@omp-ui/protocol";
import { APPROVE, isApprovalRequest, parseApproval } from "@omp-ui/protocol";
import { ChunkReassembler, isRpcChunkFrame } from "./chunks";

export const DEFAULT_COMMAND_TIMEOUT_MS = 30_000;
export const LOGIN_COMMAND_TIMEOUT_MS = 600_000;
export const PREDICT_WORD_TIMEOUT_MS = 155_000;
export const READY_TIMEOUT_MS = 60_000;
export const STOP_GRACE_MS = 5_000;
export const STDERR_RING_BYTES = 200 * 1024;
export const RING_MAX_FRAMES = 5000;
export const RING_MAX_BYTES = 8 * 1024 * 1024;
const MAX_PARSE_ERRORS_KEPT = 50;
/** omp only chunks frames larger than its 1MB transport frame; default reassembly ceiling. */
const DEFAULT_MAX_REASSEMBLED_BYTES = 64 * 1024 * 1024;

export const MIN_OMP_VERSION: readonly [number, number, number] = [18, 11, 0];

export interface OmpSpawnOptions {
	cwd: string;
	/** Session file for `--resume`. */
	resume?: string;
	/** With `resume`: use `--restore` (crash recovery) instead. */
	restore?: boolean;
	model?: string;
	thinking?: string;
	approvalMode?: ApprovalMode;
	/** Extra CLI args appended verbatim (e.g. ["--no-session"] for control processes). */
	extraArgs?: string[];
	/** Full command argv override; defaults to resolveOmpCommand(). */
	command?: string[];
	/** Test seam: override the 5000-frame ring cap. */
	ringMaxFrames?: number;
}

export interface BufferedFrame {
	seq: number;
	frame: RpcServerFrame;
}

export interface PendingUiEntry {
	seq: number;
	frame: ExtensionUiRequest;
}

export interface ParseErrorRecord {
	at: string;
	line: string;
	error: string;
}

export type OmpProcState = "starting" | "ready" | "exited" | "crashed";

export interface OmpProcessEvents {
	/** Every pushed frame (after reassembly), with its per-session seq. */
	onFrame(seq: number, frame: RpcServerFrame): void;
	/** A pendingUi request was answered — by a client or by auto-approve. */
	onUiResolved(id: string, auto: boolean): void;
	onStateChange(state: OmpProcState, code?: number, stderrTail?: string): void;
}

export interface ReplayResult {
	kind: "replay" | "resync";
	frames: BufferedFrame[];
}

interface PendingCommand {
	command: string;
	resolve: (response: RpcResponse) => void;
	timer: ReturnType<typeof setTimeout>;
}

/** Split a command line like `bun test/fake-omp.ts` into argv (handles quotes). */
export function splitCommandLine(line: string): string[] {
	const argv: string[] = [];
	let current = "";
	let quote: string | null = null;
	let hasToken = false;
	for (const ch of line) {
		if (quote) {
			if (ch === quote) quote = null;
			else current += ch;
			continue;
		}
		if (ch === '"' || ch === "'") {
			quote = ch;
			hasToken = true;
			continue;
		}
		if (/\s/.test(ch)) {
			if (current.length > 0 || hasToken) argv.push(current);
			current = "";
			hasToken = false;
			continue;
		}
		current += ch;
		hasToken = true;
	}
	if (current.length > 0 || hasToken) argv.push(current);
	return argv;
}

/** `OMP_UI_OMP_BIN` (may be a whole command line) > `omp` on PATH. */
export function resolveOmpCommand(env: NodeJS.ProcessEnv = process.env): string[] {
	const fromEnv = env.OMP_UI_OMP_BIN?.trim();
	if (fromEnv) return splitCommandLine(fromEnv);
	const onPath = Bun.which("omp");
	if (onPath) return [onPath];
	throw new Error("omp binary not found: set OMP_UI_OMP_BIN or install omp on PATH");
}

/** Run `<command> --version` and require >= MIN_OMP_VERSION. Returns the version string. */
export async function checkOmpVersion(command: string[]): Promise<string> {
	const proc = Bun.spawn([...command, "--version"], { stdout: "pipe", stderr: "pipe" });
	const stdout = await new Response(proc.stdout).text();
	const code = await proc.exited;
	if (code !== 0) throw new Error(`omp --version exited with code ${code}`);
	const match = /(\d+)\.(\d+)\.(\d+)/.exec(stdout);
	if (!match) throw new Error(`could not parse omp version from: ${stdout.trim()}`);
	const [major, minor, patch] = [Number(match[1]), Number(match[2]), Number(match[3])] as [number, number, number];
	const [minMajor, minMinor, minPatch] = MIN_OMP_VERSION;
	if (
		major < minMajor ||
		(major === minMajor && minor < minMinor) ||
		(major === minMajor && minor === minMinor && patch < minPatch)
	) {
		throw new Error(
			`omp ${match[0]} is too old; omp-ui requires >= ${MIN_OMP_VERSION.join(".")}`,
		);
	}
	return match[0];
}

function commandTimeoutMs(command: string, override?: number): number {
	if (override !== undefined) return override;
	if (command === "login") return LOGIN_COMMAND_TIMEOUT_MS;
	if (command === "predict_word") return PREDICT_WORD_TIMEOUT_MS;
	return DEFAULT_COMMAND_TIMEOUT_MS;
}

function isOAuthCodeInputTitle(title: string): boolean {
	return title.includes("authorization code") || title.includes("redirect URL");
}

export class OmpProcess {
	readonly options: OmpSpawnOptions;
	readonly events: OmpProcessEvents;

	state: OmpProcState = "starting";
	protocolVersion: 1 | 2 = 1;
	sessionId: string | null = null;
	sessionFile: string | null = null;
	/** Session-scoped "always allow" tool names (C2B `auto_approve`). */
	readonly autoApprove = new Set<string>();
	readonly pendingUi = new Map<string, PendingUiEntry>();
	/** Ids of requests answered by session-scoped auto-approve; replay reports them as `auto`. */
	readonly autoResolved = new Set<string>();
	readonly parseErrors: ParseErrorRecord[] = [];
	frameCount = 0;
	droppedFrames = 0;

	#proc: Subprocess<"pipe", "pipe", "pipe"> | null = null;
	#commandSeq = 0;
	#pending = new Map<string, PendingCommand>();
	#loginUiIds = new Set<string>();
	#cancelledLoginIds = new Set<string>();
	#writeChain: Promise<unknown> = Promise.resolve();
	#stderrTail = "";
	#ring: BufferedFrame[] = [];
	#ringBytes = 0;
	#seq = 0;
	#reassembler: ChunkReassembler | null = null;
	#streaming = false;
	#settled = true;
	/** Subagents started and not yet ended (lifecycle frames), including detached background jobs and nested ones. */
	readonly #runningSubagents = new Set<string>();
	#stopRequested = false;
	#lineBuffer = "";

	constructor(options: OmpSpawnOptions, events: OmpProcessEvents) {
		this.options = options;
		this.events = events;
	}

	/** True while the agent is streaming; such processes are never pool-evicted. */
	get streaming(): boolean {
		return this.#streaming;
	}

	/** `session_settled` seen (or no run started yet); pool eviction requires this. */
	get settled(): boolean {
		return this.#settled;
	}

	/**
	 * Subagents still running inside this process. They run in-process, so stopping the process kills them; with
	 * `async.enabled` they keep working after the parent's `session_settled`, which alone would look idle.
	 */
	get runningSubagents(): ReadonlySet<string> {
		return this.#runningSubagents;
	}

	/** Anything in flight: a run, an open dialog, or a subagent. Idle processes are the only ones safe to stop. */
	get busy(): boolean {
		return !this.#settled || this.#streaming || this.pendingUi.size > 0 || this.#runningSubagents.size > 0;
	}

	get latestSeq(): number {
		return this.#seq;
	}

	get stderrTail(): string {
		return this.#stderrTail;
	}

	buildArgv(): string[] {
		const argv = [...(this.options.command ?? resolveOmpCommand()), "--mode", "rpc-ui"];
		if (this.options.resume) {
			argv.push(this.options.restore ? "--restore" : "--resume", this.options.resume);
		}
		if (this.options.model) argv.push("--model", this.options.model);
		if (this.options.thinking) argv.push("--thinking", this.options.thinking);
		if (this.options.approvalMode) argv.push("--approval-mode", this.options.approvalMode);
		if (this.options.extraArgs) argv.push(...this.options.extraArgs);
		return argv;
	}

	/** Spawn, negotiate, run the §3.3 init sequence, learn sessionId via get_state. */
	async start(): Promise<void> {
		const argv = this.buildArgv();
		const proc = Bun.spawn(argv, {
			cwd: this.options.cwd,
			stdin: "pipe",
			stdout: "pipe",
			stderr: "pipe",
			env: process.env,
		});
		this.#proc = proc;
		proc.exited.then(code => this.#onExit(code)).catch(() => undefined);
		void this.#drainStderr(proc.stderr);

		const ready = await this.#waitForReady(proc.stdout);
		this.protocolVersion = ready.protocolVersion;
		this.#reassembler = new ChunkReassembler({
			maxReassembledFrameBytes: ready.maxReassembledFrameBytes ?? DEFAULT_MAX_REASSEMBLED_BYTES,
			onDrop: (reason, chunkId) => {
				this.droppedFrames++;
				this.#recordParseError(`rpc_chunk ${chunkId}: ${reason}`);
			},
		});
		void this.#readLoop();

		try {
			if (ready.supportedProtocolVersions?.includes(2)) {
				const negotiated = await this.send({ type: "negotiate_protocol", protocolVersion: 2 });
				if (negotiated.success) this.protocolVersion = 2;
			}

			// §3.3 init sequence.
			this.#expectOk(await this.send({ type: "set_ask_dialog", enabled: true }));
			this.#expectOk(await this.send({ type: "set_subagent_subscription", level: "progress" }));
			this.#expectOk(await this.send({ type: "set_event_filter", events: null, messageUpdates: "delta" }));
		} catch (error) {
			await this.stop();
			throw error;
		}

		try {
			const stateResponse = await this.send({ type: "get_state" });
			const data: unknown = stateResponse.data;
			if (typeof data === "object" && data !== null) {
				if ("sessionId" in data && typeof data.sessionId === "string") this.sessionId = data.sessionId;
				if ("sessionFile" in data && typeof data.sessionFile === "string") this.sessionFile = data.sessionFile;
			}
		} catch {
			// Some modes (control processes) have no session id; the caller assigns a key.
		}
		if (this.state !== "exited" && this.state !== "crashed") {
			this.state = "ready";
			this.events.onStateChange("ready");
		}
	}

	/**
	 * Send a command; resolves with the correlated `response` frame.
	 * The bridge assigns ids (`b-<n>`); per-command timeouts per §3.2.4.
	 */
	send(cmd: RpcCommand, options?: { timeoutMs?: number }): Promise<RpcResponse> {
		if (this.state === "exited" || this.state === "crashed" || !this.#proc) {
			return Promise.resolve({
				type: "response",
				command: cmd.type,
				success: false,
				error: `process is ${this.state}`,
			});
		}
		const id = `b-${++this.#commandSeq}`;
		const timeoutMs = commandTimeoutMs(cmd.type, options?.timeoutMs);
		return new Promise<RpcResponse>(resolve => {
			const timer = setTimeout(() => {
				this.#pending.delete(id);
				this.#cancelledLoginIds.delete(id);
				resolve({
					type: "response",
					command: cmd.type,
					success: false,
					id,
					error: `command ${cmd.type} timed out after ${timeoutMs}ms`,
					code: "bridge_timeout",
				});
			}, timeoutMs);
			timer.unref?.();
			this.#pending.set(id, { command: cmd.type, resolve, timer });
			this.#write({ ...(cmd as Record<string, unknown>), id });
		});
	}

	/**
	 * Forward a client answer to an open UI request. Returns false when the id
	 * is unknown or already resolved (first-response-wins: caller then notifies).
	 */
	respondUi(frame: ExtensionUiResponse): boolean {
		const entry = this.pendingUi.get(frame.id);
		if (!entry) return false;
		this.pendingUi.delete(frame.id);
		const wasTrackedLoginUi = this.#loginUiIds.delete(frame.id);
		const isLoginInput =
			wasTrackedLoginUi ||
			(entry.frame.method === "input" &&
				(this.#hasPendingLogin() || isOAuthCodeInputTitle(entry.frame.title)));
		const isOAuthCodeInput =
			entry.frame.method === "input" && isOAuthCodeInputTitle(entry.frame.title);
		const isCancelled = "cancelled" in frame && frame.cancelled;
		const isEmptyOAuthCode =
			isOAuthCodeInput && "value" in frame && typeof frame.value === "string" && frame.value.trim().length === 0;
		if (isLoginInput && (isCancelled || isEmptyOAuthCode)) {
			for (const [cmdId, pending] of this.#pending) {
				if (pending.command === "login") this.#cancelledLoginIds.add(cmdId);
			}
			// omp's rpc-mode `login` handler turns `{cancelled: true}` (`undefined`) into `""`
			// via `(await uiCtx.input(...)) ?? ""`, causing `OAuthCallbackFlow.#waitForCallback`
			// to loop `while (true)` and immediately re-emit `input` forever. Sending a non-string
			// `value: false` makes `onPrompt` resolve to `false`, so `.trim()` throws inside
			// `oauth.login`, aborting the flow and stopping the callback server immediately.
			this.#write({ type: "extension_ui_response", id: frame.id, value: false });
			return true;
		}
		this.#write(frame as unknown as Record<string, unknown>);
		return true;
	}

	/** Replay buffered frames after `sinceSeq`, or signal a resync (§3.4). */
	replay(sinceSeq: number): ReplayResult {
		const oldest = this.#ring.length > 0 ? this.#ring[0]!.seq : this.#seq + 1;
		if (sinceSeq < 0 || (this.#ring.length > 0 && sinceSeq < oldest - 1)) {
			return { kind: "resync", frames: [] };
		}
		if (this.#ring.length === 0 && sinceSeq > 0 && sinceSeq < this.#seq) {
			return { kind: "resync", frames: [] };
		}
		return { kind: "replay", frames: this.#ring.filter(entry => entry.seq > sinceSeq) };
	}

	/** SIGTERM, SIGKILL after 5s (§3.1). */
	async stop(): Promise<void> {
		this.#stopRequested = true;
		const proc = this.#proc;
		if (!proc || this.state === "exited" || this.state === "crashed") return;
		try {
			proc.stdin.end();
		} catch {
			// already closed
		}
		try {
			proc.kill("SIGTERM");
		} catch {
			// already gone
		}
		const winner = await Promise.race([
			proc.exited.then(() => "exited" as const),
			Bun.sleep(STOP_GRACE_MS).then(() => "timeout" as const),
		]);
		if (winner === "timeout") {
			try {
				proc.kill("SIGKILL");
			} catch {
				try {
					proc.kill();
				} catch {
					// already gone
				}
			}
		}
	}

	async #waitForReady(stdout: ReadableStream<Uint8Array>): Promise<{
		protocolVersion: 1 | 2;
		supportedProtocolVersions?: number[];
		maxReassembledFrameBytes?: number;
	}> {
		const reader = stdout.getReader();
		const deadline = Date.now() + READY_TIMEOUT_MS;
		while (Date.now() < deadline) {
			const remaining = Math.max(1, deadline - Date.now());
			const result = await Promise.race([
				reader.read(),
				Bun.sleep(remaining).then(() => null),
			]);
			if (result === null) break;
			if (result.done) break;
			const lines = this.#feedBytes(result.value);
			for (const line of lines) {
				const frame = this.#parseLine(line);
				if (!frame) continue;
				if (frame.type !== "ready") {
					this.#recordParseError(`frame before ready: ${String(frame.type)}`);
					continue;
				}
				// Hand the partially-consumed stream back to the read loop.
				this.#stdoutReader = reader;
				const supported = Array.isArray(frame.supportedProtocolVersions)
					? frame.supportedProtocolVersions.filter((v): v is number => typeof v === "number")
					: undefined;
				return {
					protocolVersion: frame.protocolVersion === 2 ? 2 : 1,
					...(supported ? { supportedProtocolVersions: supported } : {}),
					...(typeof frame.maxReassembledFrameBytes === "number"
						? { maxReassembledFrameBytes: frame.maxReassembledFrameBytes }
						: {}),
				};
			}
		}
		reader.releaseLock();
		await this.stop();
		throw new Error("omp did not emit a ready frame in time");
	}

	#stdoutReader: { read(): Promise<{ done: boolean; value?: Uint8Array }>; releaseLock(): void } | null = null;

	async #readLoop(): Promise<void> {
		const reader = this.#stdoutReader;
		this.#stdoutReader = null;
		if (!reader) return;
		try {
			for (;;) {
				const { done, value } = await reader.read();
				if (done || !value) break;
				for (const line of this.#feedBytes(value)) this.#handleLine(line);
			}
		} catch (error) {
			this.#recordParseError(`stdout read error: ${(error as Error).message}`);
		} finally {
			reader.releaseLock();
		}
	}

	#feedBytes(bytes: Uint8Array): string[] {
		this.#lineBuffer += new TextDecoder().decode(bytes);
		const lines: string[] = [];
		let index: number;
		while ((index = this.#lineBuffer.indexOf("\n")) !== -1) {
			const line = this.#lineBuffer.slice(0, index);
			this.#lineBuffer = this.#lineBuffer.slice(index + 1);
			if (line.trim().length > 0) lines.push(line);
		}
		return lines;
	}

	#parseLine(line: string): Record<string, unknown> | null {
		try {
			const frame: unknown = JSON.parse(line);
			if (typeof frame !== "object" || frame === null) throw new Error("frame is not an object");
			return frame as Record<string, unknown>;
		} catch (error) {
			this.#recordParseError((error as Error).message, line);
			return null;
		}
	}

	#handleLine(line: string): void {
		const frame = this.#parseLine(line);
		if (!frame) return;
		if (isRpcChunkFrame(frame)) {
			if (!this.#reassembler) return;
			const reassembled = this.#reassembler.push(frame);
			if (reassembled === null) return;
			this.#dispatch(reassembled as Record<string, unknown>);
			return;
		}
		this.#dispatch(frame);
	}

	#dispatch(frame: Record<string, unknown>): void {
		if (frame.type === "response") {
			let response = frame as unknown as RpcResponse;
			const pending = response.id !== undefined ? this.#pending.get(response.id) : undefined;
			if (pending) {
				this.#pending.delete(response.id!);
				clearTimeout(pending.timer);
				if (pending.command === "login") {
					const wasCancelled = response.id !== undefined && this.#cancelledLoginIds.delete(response.id);
					if (wasCancelled && !response.success) {
						response = {
							...response,
							error: "已取消登录",
							code: "cancelled",
						};
					}
					if (!this.#hasPendingLogin()) {
						this.#cancelledLoginIds.clear();
						for (const uiId of this.#loginUiIds) {
							this.#loginUiIds.delete(uiId);
							if (this.pendingUi.delete(uiId)) {
								this.#write({ type: "extension_ui_response", id: uiId, cancelled: true });
								this.events.onUiResolved(uiId, false);
							}
						}
					}
				}
				pending.resolve(response);
			}
			return;
		}
		const serverFrame = frame as unknown as RpcServerFrame;
		this.#trackRunState(serverFrame);
		const seq = ++this.#seq;
		this.#ringPush({ seq, frame: serverFrame });
		this.frameCount++;

		if (serverFrame.type === "extension_ui_request") {
			const request = serverFrame as ExtensionUiRequest;
			if (request.method === "cancel") {
				this.pendingUi.delete(request.targetId);
				this.#loginUiIds.delete(request.targetId);
			} else if (
				request.method === "select" ||
				request.method === "confirm" ||
				request.method === "input" ||
				request.method === "editor" ||
				request.method === "ask"
			) {
				const isLoginInput =
					request.method === "input" &&
					(this.#hasPendingLogin() || isOAuthCodeInputTitle(request.title));
				if (isLoginInput && this.#cancelledLoginIds.size > 0) {
					this.#write({ type: "extension_ui_response", id: request.id, value: false });
					return;
				}
				this.pendingUi.set(request.id, { seq, frame: request });
				if (isLoginInput) {
					this.#loginUiIds.add(request.id);
				}
			}
		}

		this.events.onFrame(seq, serverFrame);

		// Session-scoped auto-approve (§7.3): answer matching approval selects
		// ourselves, after the frame went out so clients can annotate it.
		if (serverFrame.type === "extension_ui_request" && this.autoApprove.size > 0) {
			const request = serverFrame as ExtensionUiRequest;
			if (isApprovalRequest(request)) {
				const approval = parseApproval(request);
				if (approval && this.autoApprove.has(approval.toolName) && this.pendingUi.has(request.id)) {
					this.respondUi({ type: "extension_ui_response", id: request.id, value: APPROVE });
					this.autoResolved.add(request.id);
					this.events.onUiResolved(request.id, true);
				}
			}
		}
	}

	#trackRunState(frame: RpcServerFrame): void {
		if (frame.type === "agent_start") {
			this.#streaming = true;
			this.#settled = false;
		} else if (frame.type === "session_settled") {
			this.#streaming = false;
			this.#settled = true;
		} else if (frame.type === "agent_end") {
			this.#streaming = false;
		} else if (frame.type === "subagent_lifecycle") {
			if (frame.payload.status === "started") this.#runningSubagents.add(frame.payload.id);
			else this.#runningSubagents.delete(frame.payload.id);
		} else if (frame.type === "subagent_progress") {
			// Progress can report the end before the terminal lifecycle frame does.
			const { id, status } = frame.payload.progress as { id?: unknown; status?: unknown };
			if (typeof id === "string" && (status === "completed" || status === "failed" || status === "aborted")) {
				this.#runningSubagents.delete(id);
			}
		}
	}

	#hasPendingLogin(): boolean {
		for (const pending of this.#pending.values()) {
			if (pending.command === "login") return true;
		}
		return false;
	}

	#ringPush(entry: BufferedFrame): void {
		const bytes = Buffer.byteLength(JSON.stringify(entry.frame), "utf8");
		this.#ring.push(entry);
		this.#ringBytes += bytes;
		const maxFrames = this.options.ringMaxFrames ?? RING_MAX_FRAMES;
		while (this.#ring.length > maxFrames || this.#ringBytes > RING_MAX_BYTES) {
			const dropped = this.#ring.shift();
			if (!dropped) break;
			this.#ringBytes -= Buffer.byteLength(JSON.stringify(dropped.frame), "utf8");
			this.droppedFrames++;
		}
	}

	#write(value: Record<string, unknown>): void {
		const proc = this.#proc;
		if (!proc) return;
		const line = `${JSON.stringify(value)}\n`;
		this.#writeChain = this.#writeChain.then(async () => {
			try {
				await proc.stdin.write(line);
			} catch (error) {
				this.#recordParseError(`stdin write failed: ${(error as Error).message}`);
			}
		});
	}

	async #drainStderr(stderr: ReadableStream<Uint8Array>): Promise<void> {
		const decoder = new TextDecoder();
		const reader = stderr.getReader();
		try {
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				this.#stderrTail = (this.#stderrTail + decoder.decode(value, { stream: true })).slice(
					-STDERR_RING_BYTES,
				);
			}
		} catch {
			// process gone
		} finally {
			reader.releaseLock();
		}
	}

	#onExit(code: number): void {
		if (this.state === "exited" || this.state === "crashed") return;
		this.#reassembler?.reset();
		for (const [id, pending] of this.#pending) {
			clearTimeout(pending.timer);
			pending.resolve({
				type: "response",
				command: pending.command,
				success: false,
				id,
				error: `process exited with code ${code}`,
			});
		}
		this.#pending.clear();
		this.#streaming = false;
		this.#runningSubagents.clear();
		this.state = this.#stopRequested || code === 0 ? "exited" : "crashed";
		this.events.onStateChange(this.state, code, this.#stderrTail);
	}

	#expectOk(response: RpcResponse): void {
		if (!response.success) {
			throw new Error(`init command ${response.command} failed: ${response.error ?? "unknown error"}`);
		}
	}

	#recordParseError(error: string, line?: string): void {
		this.parseErrors.push({ at: new Date().toISOString(), line: (line ?? "").slice(0, 500), error });
		if (this.parseErrors.length > MAX_PARSE_ERRORS_KEPT) this.parseErrors.shift();
	}
}
