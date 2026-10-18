/**
 * Fake `omp --mode rpc-ui` for bridge tests. Run as `bun test/fake-omp.ts ...`.
 *
 * Emits `ready` (advertising v2), answers the init sequence and `get_state`,
 * and on `prompt` streams a short assistant reply with text deltas, one bash
 * tool call gated behind an approval select, then agent_end / prompt_result /
 * session_settled. Frames larger than FAKE_OMP_MAX_FRAME_BYTES are emitted as
 * `rpc_chunk` sequences after protocol v2 is negotiated.
 *
 * Env knobs: FAKE_OMP_SESSION_ID, FAKE_OMP_NO_V2, FAKE_OMP_MAX_FRAME_BYTES,
 * FAKE_OMP_MAX_REASSEMBLED, FAKE_OMP_CHUNK_BYTES.
 * Prompt text containing "BIGFRAME" yields a large reply (chunked under v2).
 * The `hang` command never responds (timeout tests).
 */
import * as fs from "node:fs";
import * as path from "node:path";

if (process.argv.includes("--version")) {
	console.log("omp/18.11.1");
	process.exit(0);
}

const env = process.env;
if (process.argv[2] === "models" && process.argv.includes("--json")) {
	const entry = (provider: string, id: string, name: string) => ({
		provider, kind: "chat", id, selector: `${provider}/${id}`, name, contextWindow: 200000, maxTokens: 8192,
		reasoning: true, thinking: ["low", "high"], input: ["text", "image"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	});
	console.log(JSON.stringify({ models: [entry("fake", "model", "Fake Model"), entry("fake", "model-mini", "Fake Mini"), { ...entry("fake", "embed", "Embedder"), kind: "embedding" }] }));
	process.exit(0);
}
const rich = env.FAKE_OMP_RICH === "1";
const argAfter = (flag: string): string | undefined => {
	const i = process.argv.indexOf(flag);
	return i >= 0 ? process.argv[i + 1] : undefined;
};

// E2E seam: record how the bridge launched us so tests can assert start args (model / thinking / approval mode).
if (env.FAKE_OMP_ARGV_LOG) {
	fs.appendFileSync(env.FAKE_OMP_ARGV_LOG, `${JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd() })}\n`);
}

// Rich mode: spec-shaped replies, a real session jsonl under $PI_CODING_AGENT_DIR (written on the
// first persisted message, like omp), `--resume <file>` and deny/ask flows. Default mode stays minimal.
let sessionId = env.FAKE_OMP_SESSION_ID ?? "fake-00000000-0000-4000-8000-000000000000";
let sessionFile = path.join(env.INIT_CWD ?? process.cwd(), "fake-session.jsonl");
const messages: Record<string, unknown>[] = [];
let lastEntryId: string | null = null;
let headerWritten = false;
let entrySeq = 0;
let currentModel = argAfter("--model") ?? "fake/model";
let currentThinking = argAfter("--thinking") ?? "high";
if (rich) {
	const resumeFile = argAfter("--resume") ?? argAfter("--restore");
	if (resumeFile && fs.existsSync(resumeFile)) {
		sessionFile = resumeFile;
		headerWritten = true;
		for (const line of fs.readFileSync(resumeFile, "utf8").split("\n")) {
			if (!line.trim()) continue;
			const entry = JSON.parse(line) as Record<string, unknown>;
			if (entry.type === "session" && typeof entry.id === "string") sessionId = entry.id;
			if (entry.type === "message" && typeof entry.id === "string") {
				messages.push(entry.message as Record<string, unknown>);
				lastEntryId = entry.id;
			}
		}
	} else {
		sessionId = crypto.randomUUID();
		const stamp = new Date().toISOString().replace(/[:.]/g, "-");
		const dir = path.join(env.PI_CODING_AGENT_DIR ?? process.cwd(), "sessions", `--${process.cwd().replace(/[^a-zA-Z0-9]+/g, "-")}--`);
		sessionFile = path.join(dir, `${stamp}_${sessionId}.jsonl`);
	}
}

const persist = (message: Record<string, unknown>): void => {
	messages.push(message);
	if (!rich) return;
	fs.mkdirSync(path.dirname(sessionFile), { recursive: true });
	const stamp = new Date().toISOString();
	if (!headerWritten) {
		const content = Array.isArray(message.content) ? (message.content as { text?: string }[]) : [];
		const title = (content[0]?.text ?? "").slice(0, 60);
		fs.appendFileSync(
			sessionFile,
			`${JSON.stringify({ type: "title", v: 1, title, updatedAt: stamp, pad: " ".repeat(120) })}\n${JSON.stringify({ type: "session", version: 3, id: sessionId, timestamp: stamp, cwd: process.cwd() })}\n`,
		);
		headerWritten = true;
	}
	const id = `e${++entrySeq}-${Math.random().toString(16).slice(2, 8)}`;
	fs.appendFileSync(sessionFile, `${JSON.stringify({ type: "message", id, parentId: lastEntryId, timestamp: stamp, message })}\n`);
	lastEntryId = id;
};
const maxFrameBytes = Number(env.FAKE_OMP_MAX_FRAME_BYTES ?? 1024 * 1024);
const maxReassembled = Number(env.FAKE_OMP_MAX_REASSEMBLED ?? 64 * 1024 * 1024);
const chunkPayloadBytes = Math.min(Number(env.FAKE_OMP_CHUNK_BYTES ?? 256 * 1024), Math.max(64, Math.floor(maxFrameBytes / 2)));

let v2 = false;
let chunkSeq = 0;
let messageSeq = 0;
let uiSeq = 0;
// A resumed transcript already used ids m-N / ui-N / call-N; real omp never reuses them, so continue past the history.
messageSeq = messages.length;
uiSeq = messages.length;
const pendingApprovals = new Map<string, (response: Record<string, unknown>) => void>();

/** Register a pending UI request and return the promise of the client's answer. */
const waitUi = (uiId: string): Promise<Record<string, unknown>> => {
	const { promise, resolve } = Promise.withResolvers<Record<string, unknown>>();
	pendingApprovals.set(uiId, resolve);
	return promise;
};

const writeLine = (line: string): void => {
	process.stdout.write(`${line}\n`);
};

const emit = (frame: Record<string, unknown>): void => {
	const json = JSON.stringify(frame);
	const byteLength = Buffer.byteLength(json, "utf8");
	if (v2 && byteLength > maxFrameBytes) {
		if (byteLength > maxReassembled) {
			writeLine(
				JSON.stringify({
					type: "rpc_frame_error",
					error: `frame of ${byteLength} bytes exceeds the reassembly limit`,
					originalType: frame.type,
				}),
			);
			return;
		}
		const bytes = Buffer.from(json, "utf8");
		const count = Math.ceil(byteLength / chunkPayloadBytes);
		const chunkId = `chunk-${++chunkSeq}`;
		for (let index = 0; index < count; index++) {
			writeLine(
				JSON.stringify({
					type: "rpc_chunk",
					chunkId,
					index,
					count,
					byteLength,
					data: bytes.subarray(index * chunkPayloadBytes, (index + 1) * chunkPayloadBytes).toString("base64"),
				}),
			);
		}
		return;
	}
	writeLine(json);
};

const respond = (id: unknown, command: string, data?: unknown): void => {
	if (data === undefined) emit({ type: "response", command, success: true, id });
	else emit({ type: "response", command, success: true, id, data });
};

const respondError = (id: unknown, command: string, error: string): void => {
	emit({ type: "response", command, success: false, id, error });
};

const assistantMessage = (text: string, toolCall?: Record<string, unknown>): Record<string, unknown> => ({
	role: "assistant",
	content: [
		{ type: "text", text },
		...(toolCall ? [{ type: "toolCall", ...toolCall }] : []),
	],
	api: "fake",
	provider: "fake",
	model: "fake/model",
	usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
	stopReason: toolCall ? "toolUse" : "stop",
	timestamp: Date.now(),
});

const backgroundSubagents = new Set<string>();

const runPrompt = async (commandId: unknown, message: string): Promise<void> => {
	const messageId = `m-${++messageSeq}`;
	const big = message.includes("BIGFRAME");
	const text = big ? "x".repeat(maxFrameBytes * 2 + 123) : `fake reply to: ${message}`;
	const toolCall = { id: "call-1", name: "bash", arguments: { command: "echo hi" } };

	emit({ type: "agent_start" });
	emit({ type: "turn_start" });
	const partial = { role: "assistant" };
	emit({ type: "message_start", messageId, message: assistantMessage("") });
	emit({ type: "message_update", messageId, message: partial, assistantMessageEvent: { type: "start", partial } });
	emit({ type: "message_update", messageId, message: partial, assistantMessageEvent: { type: "text_start", contentIndex: 0, partial } });
	for (const delta of [text.slice(0, 4), text.slice(4, 9), text.slice(9)]) {
		if (delta.length === 0) continue;
		emit({ type: "message_update", messageId, message: partial, assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta, partial } });
	}
	emit({ type: "message_update", messageId, message: partial, assistantMessageEvent: { type: "text_end", contentIndex: 0, content: text, partial } });
	emit({ type: "message_update", messageId, message: partial, assistantMessageEvent: { type: "toolcall_start", contentIndex: 1, partial } });
	emit({ type: "message_update", messageId, message: partial, assistantMessageEvent: { type: "toolcall_delta", contentIndex: 1, delta: JSON.stringify(toolCall.arguments), partial } });
	emit({ type: "message_update", messageId, message: partial, assistantMessageEvent: { type: "toolcall_end", contentIndex: 1, toolCall, partial } });
	emit({ type: "message_update", messageId, message: partial, assistantMessageEvent: { type: "done", reason: "toolUse", message: assistantMessage(text, toolCall) } });

	// Approval select for the bash call; the run waits for the answer.
	const uiId = `ui-${++uiSeq}`;
	const answered = waitUi(uiId);
	emit({
		type: "extension_ui_request",
		id: uiId,
		method: "select",
		title: "Allow tool: bash\nCommand: echo hi",
		options: ["Approve", "Deny"],
	});
	await answered;

	emit({ type: "tool_execution_start", toolCallId: "call-1", toolName: "bash", args: toolCall.arguments });
	emit({ type: "tool_execution_end", toolCallId: "call-1", toolName: "bash", result: { content: [{ type: "text", text: "hi" }] } });
	emit({ type: "message_end", messageId, message: assistantMessage(text, toolCall) });
	const toolResult = {
		role: "toolResult",
		toolCallId: "call-1",
		toolName: "bash",
		content: [{ type: "text", text: "hi" }],
		isError: false,
		timestamp: Date.now(),
	};
	emit({ type: "message_start", messageId: `${messageId}-r`, message: toolResult });
	emit({ type: "message_end", messageId: `${messageId}-r`, message: toolResult });
	emit({ type: "turn_end", message: assistantMessage(text, toolCall), toolResults: [toolResult] });
	// BGSUB: a detached background subagent (with a nested child) keeps running past the settle, like omp's
	// `async.enabled` task jobs; `cancel_subagent` ends it.
	if (message.includes("BGSUB")) {
		for (const [subId, index] of [["Bg", 0], ["Bg.Child", 0]] as const) {
			backgroundSubagents.add(subId);
			emit({
				type: "subagent_lifecycle",
				payload: { id: subId, agent: "task", agentSource: "bundled", status: "started", index, parentToolCallId: subId === "Bg" ? "call-1" : "call-bg-1", detached: true },
			});
		}
	}
	emit({ type: "agent_end", messages: [assistantMessage(text, toolCall), toolResult], yielded: true });
	emit({ type: "prompt_result", agentInvoked: true, status: "completed", sessionSettled: true, id: commandId });
	emit({ type: "session_settled" });
};

const MODELS = [
	{ id: "model", name: "Fake Model", api: "fake", provider: "fake", baseUrl: "http://fake", reasoning: true, input: ["text", "image"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200000, maxTokens: 8192 },
	{ id: "model-mini", name: "Fake Mini", api: "fake", provider: "fake", baseUrl: "http://fake", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 100000, maxTokens: 4096 },
];
const activeModel = () => MODELS.find(m => `${m.provider}/${m.id}` === currentModel) ?? MODELS[0]!;
const streamDelay = (): Promise<void> => {
	const { promise, resolve } = Promise.withResolvers<void>();
	setTimeout(resolve, Number(env.FAKE_OMP_DELAY_MS ?? 40));
	return promise;
};

const richAssistant = (content: Record<string, unknown>[], stopReason: string): Record<string, unknown> => ({
	role: "assistant",
	content,
	api: "fake",
	provider: "fake",
	model: "fake/model",
	usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
	stopReason,
	timestamp: Date.now(),
});

/**
 * Rich turn: user echo -> streamed text -> bash tool (approval-gated) -> result -> final reply.
 * `ASK` in the prompt yields an ask dialog instead; `LONG` streams ~60 paragraphs over ~3s with no tools
 * (scroll-follow tests).
 */
const runRichPrompt = async (commandId: unknown, message: string): Promise<void> => {
	const messageId = `m-${++messageSeq}`;
	const text = `fake reply to: ${message}`;
	const userMessage = { role: "user", content: [{ type: "text", text: message }], timestamp: Date.now() };
	emit({ type: "agent_start" });
	emit({ type: "turn_start" });
	emit({ type: "message_start", messageId: `${messageId}-u`, message: userMessage });
	emit({ type: "message_end", messageId: `${messageId}-u`, message: userMessage });
	persist(userMessage);

	const partial = { role: "assistant" };
	const update = (assistantMessageEvent: Record<string, unknown>) =>
		emit({ type: "message_update", messageId, message: partial, assistantMessageEvent });
	emit({ type: "message_start", messageId, message: partial });
	update({ type: "start", partial });
	update({ type: "text_start", contentIndex: 0, partial });
	for (const delta of [text.slice(0, 4), text.slice(4, 9), text.slice(9)]) {
		await streamDelay();
		update({ type: "text_delta", contentIndex: 0, delta, partial });
	}
	let body = text;
	if (message.includes("LONG")) {
		for (let i = 1; i <= 60; i++) {
			const delta = `\n\nparagraph ${i}: ${"lorem ipsum ".repeat(12)}`;
			body += delta;
			await streamDelay();
			update({ type: "text_delta", contentIndex: 0, delta, partial });
		}
	}
	update({ type: "text_end", contentIndex: 0, content: body, partial });

	if (message.includes("LONG")) {
		const final = richAssistant([{ type: "text", text: `${body}\n\nLONG DONE` }], "stop");
		update({ type: "done", reason: "stop", message: final });
		emit({ type: "message_end", messageId, message: final });
		persist(final);
	} else if (message.includes("ASK")) {
		const question = { id: "q1", question: "Pick a color?", options: [{ label: "Red" }, { label: "Blue" }], recommended: 0 };
		const toolCall = { id: `call-${messageSeq}`, name: "ask", arguments: { questions: [question] } };
		const final = richAssistant([{ type: "text", text }, { type: "toolCall", ...toolCall }], "toolUse");
		update({ type: "done", reason: "toolUse", message: final });
		emit({ type: "message_end", messageId, message: final });
		persist(final);
		emit({ type: "tool_execution_start", toolCallId: toolCall.id, toolName: "ask", args: toolCall.arguments });
		const uiId = `ui-${++uiSeq}`;
		const answered = waitUi(uiId);
		emit({
			type: "extension_ui_request",
			id: uiId,
			method: "ask",
			questions: [question],
		});
		const response = await answered;
		const answers = Array.isArray(response.answers) ? (response.answers as { selectedOptions?: string[] }[]) : [];
		const chosen = answers[0]?.selectedOptions?.join(",") ?? "(cancelled)";
		const resultText = `you chose: ${chosen}`;
		emit({
			type: "tool_execution_end",
			toolCallId: toolCall.id,
			toolName: "ask",
			result: { content: [{ type: "text", text: resultText }], details: { answers } },
		});
		const toolResult = {
			role: "toolResult",
			toolCallId: toolCall.id,
			toolName: "ask",
			content: [{ type: "text", text: resultText }],
			details: { answers },
			isError: false,
			timestamp: Date.now(),
		};
		emit({ type: "message_start", messageId: `${messageId}-r`, message: toolResult });
		emit({ type: "message_end", messageId: `${messageId}-r`, message: toolResult });
		persist(toolResult);
		const reply = richAssistant([{ type: "text", text: resultText }], "stop");
		emit({ type: "message_start", messageId: `${messageId}-2`, message: reply });
		emit({ type: "message_end", messageId: `${messageId}-2`, message: reply });
		persist(reply);
	} else {
		const toolCall = { id: `call-${messageSeq}`, name: "bash", arguments: { command: "echo hi" } };
		update({ type: "toolcall_start", contentIndex: 1, partial });
		update({ type: "toolcall_delta", contentIndex: 1, delta: JSON.stringify(toolCall.arguments), partial });
		update({ type: "toolcall_end", contentIndex: 1, toolCall, partial });
		const withTool = richAssistant([{ type: "text", text }, { type: "toolCall", ...toolCall }], "toolUse");
		update({ type: "done", reason: "toolUse", message: withTool });
		emit({ type: "message_end", messageId, message: withTool });
		persist(withTool);
		emit({ type: "tool_execution_start", toolCallId: toolCall.id, toolName: "bash", args: toolCall.arguments });

		const uiId = `ui-${++uiSeq}`;
		const answered = waitUi(uiId);
		emit({
			type: "extension_ui_request",
			id: uiId,
			method: "select",
			title: "Allow tool: bash\nCommand: echo hi",
			options: ["Approve", "Deny"],
		});
		const response = await answered;
		const approved = response.value === "Approve";
		const resultText = approved ? "hi" : "Tool use denied by user";
		emit({
			type: "tool_execution_end",
			toolCallId: toolCall.id,
			toolName: "bash",
			isError: !approved,
			result: { content: [{ type: "text", text: resultText }] },
		});
		const toolResult = {
			role: "toolResult",
			toolCallId: toolCall.id,
			toolName: "bash",
			content: [{ type: "text", text: resultText }],
			isError: !approved,
			timestamp: Date.now(),
		};
		emit({ type: "message_start", messageId: `${messageId}-r`, message: toolResult });
		emit({ type: "message_end", messageId: `${messageId}-r`, message: toolResult });
		persist(toolResult);
		emit({ type: "turn_end", message: withTool, toolResults: [toolResult] });
		const reply = richAssistant([{ type: "text", text: approved ? "Command finished: hi" : "Command was denied." }], "stop");
		emit({ type: "message_start", messageId: `${messageId}-2`, message: reply });
		emit({ type: "message_end", messageId: `${messageId}-2`, message: reply });
		persist(reply);
	}
	emit({ type: "turn_end", message: messages[messages.length - 1] });
	emit({ type: "agent_end", messages: [], yielded: true, messageCount: messages.length });
	emit({ type: "prompt_result", agentInvoked: true, status: "completed", sessionSettled: true, id: commandId });
	emit({ type: "session_settled" });
};

/** Spec-shaped answers for rich mode. Returns true when handled. */
const handleRich = (cmd: Record<string, unknown>): boolean => {
	const { id, type } = cmd;
	switch (type) {
		case "get_state":
			respond(id, type, {
				sessionId,
				sessionFile,
				model: activeModel(),
				thinkingLevel: currentThinking,
				isStreaming: false,
				isCompacting: false,
				isSettled: true,
				messageCount: messages.length,
				steeringMode: "one-at-a-time",
				followUpMode: "one-at-a-time",
				interruptMode: "immediate",
			});
			return true;
		case "get_available_models":
			respond(id, type, { models: MODELS });
			return true;
		case "get_available_thinking_levels":
			respond(id, type, { levels: ["off", "low", "medium", "high"] });
			return true;
		case "get_available_commands":
			respond(id, type, {
				commands: [
					{ name: "help", source: "builtin", description: "Show help" },
					{ name: "compact", source: "builtin", description: "Compact the context" },
					{ name: "model", source: "builtin", description: "Switch model" },
				],
			});
			return true;
		case "get_subagents":
			respond(id, type, { subagents: [] });
			return true;
		case "get_btw_history":
			respond(id, type, { records: [] });
			return true;
		case "get_session_stats":
			respond(id, type, {
				sessionId,
				userMessages: messages.filter(m => m.role === "user").length,
				assistantMessages: messages.filter(m => m.role === "assistant").length,
				toolCalls: 0,
				toolResults: 0,
				totalMessages: messages.length,
				tokens: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, total: 2 },
				premiumRequests: 0,
				cost: 0,
				contextUsage: { tokens: 2, contextWindow: 200000, percent: 0 },
			});
			return true;
		case "get_messages_page":
			respond(id, type, { messages, totalMessages: messages.length });
			return true;
		case "set_thinking_level":
			if (typeof cmd.level === "string") currentThinking = cmd.level;
			respond(id, type);
			return true;
		case "set_model": {
			const provider = typeof cmd.provider === "string" ? cmd.provider : "fake";
			const modelId = typeof cmd.modelId === "string" ? cmd.modelId : "";
			currentModel = `${provider}/${modelId}`;
			respond(id, type, activeModel());
			return true;
		}
		case "prompt":
			respond(id, type);
			void runRichPrompt(id, typeof cmd.message === "string" ? cmd.message : "");
			return true;
		default:
			return false;
	}
};

const handleCommand = (cmd: Record<string, unknown>): void => {
	const { id, type } = cmd;
	if (rich && handleRich(cmd)) return;
	switch (type) {
		case "negotiate_protocol":
			if (cmd.protocolVersion !== 2) {
				respondError(id, type, `Unsupported RPC protocol version: ${String(cmd.protocolVersion)}`);
				return;
			}
			respond(id, type, { protocolVersion: 2 });
			v2 = true;
			return;
		case "set_ask_dialog":
			respond(id, type, { enabled: cmd.enabled === true });
			return;
		case "set_subagent_subscription":
			respond(id, type, { level: cmd.level ?? "off" });
			return;
		case "set_event_filter":
			respond(id, type, { events: cmd.events ?? null, messageUpdates: cmd.messageUpdates ?? "full" });
			return;
		case "get_state":
			respond(id, type, { sessionId, sessionFile, isSettled: true });
			return;
		case "get_messages_page":
			respond(id, type, { messages: [], totalMessages: 0 });
			return;
		case "bash":
			respond(id, type, {
				output: "fake bash output",
				cancelled: false,
				truncated: false,
				totalLines: 1,
				totalBytes: 16,
				outputLines: 1,
				outputBytes: 16,
				exitCode: 0,
			});
			return;
		case "export_html": {
			const file = path.join(env.INIT_CWD ?? process.cwd(), `export-${Date.now()}.html`);
			fs.writeFileSync(file, "<html><body>fake export</body></html>");
			respond(id, type, { path: file });
			return;
		}
		case "hang":
			return; // never responds: timeout tests
		case "abort":
			respond(id, type);
			return;
		case "login": {
			const providerId = typeof cmd.providerId === "string" ? cmd.providerId : "anthropic";
			void (async () => {
				emit({
					type: "extension_ui_request",
					id: `url-${++uiSeq}`,
					method: "open_url",
					url: `https://example.com/oauth?provider=${providerId}`,
					launchUrl: "http://127.0.0.1:4317/launch",
					instructions: "Complete authentication in your browser.",
				});
				if (providerId === "oauth-auto-callback") {
					const uiId = `ui-${++uiSeq}`;
					emit({
						type: "extension_ui_request",
						id: uiId,
						method: "input",
						title: "Paste the authorization code (or full redirect URL):",
						timeout: 600_000,
					});
					await Bun.sleep(20);
					respond(id, type, { providerId });
					return;
				}
				try {
					// Mirror omp's OAuthCallbackFlow.#waitForCallback + rpc-mode `uiCtx.input(...) ?? ""`:
					// `{cancelled: true}` becomes `""`, which has no code and re-prompts in `while (true)`.
					while (true) {
						const uiId = `ui-${++uiSeq}`;
						const responsePromise = new Promise<Record<string, unknown>>(resolve => {
							pendingApprovals.set(uiId, resolve);
						});
						emit({
							type: "extension_ui_request",
							id: uiId,
							method: "input",
							title: "Paste the authorization code (or full redirect URL):",
							timeout: 600_000,
						});
						const res = await responsePromise;
						const raw = res.cancelled ? undefined : res.value;
						const input = (raw ?? "") as string;
						const trimmed = input.trim();
						if (trimmed.length > 0) {
							respond(id, type, { providerId });
							return;
						}
					}
				} catch (err) {
					respondError(id, type, err instanceof Error ? err.message : String(err));
				}
			})();
			return;
		}
		case "cancel_subagent": {
			const target = typeof cmd.subagentId === "string" ? cmd.subagentId : "";
			const ended = [...backgroundSubagents].filter(subId => subId === target || subId.startsWith(`${target}.`)).reverse();
			for (const subId of ended) {
				backgroundSubagents.delete(subId);
				emit({ type: "subagent_lifecycle", payload: { id: subId, agent: "task", agentSource: "bundled", status: "aborted", index: 0 } });
			}
			respond(id, type, { cancelled: ended.length > 0 });
			return;
		}
		case "prompt":
			// Real omp: an admitted prompt is acked with no `data` (only local slash commands carry agentInvoked).
			respond(id, type);
			void runPrompt(id, typeof cmd.message === "string" ? cmd.message : "");
			return;
		default:
			respond(id, String(type), {});
	}
};

emit({
	type: "ready",
	protocolVersion: 1,
	supportedProtocolVersions: env.FAKE_OMP_NO_V2 ? [1] : [1, 2],
	maxFrameBytes,
	maxReassembledFrameBytes: maxReassembled,
});

let buffer = "";
const decoder = new TextDecoder();
for await (const chunk of Bun.stdin.stream()) {
	buffer += decoder.decode(chunk, { stream: true });
	let index: number;
	while ((index = buffer.indexOf("\n")) !== -1) {
		const line = buffer.slice(0, index).trim();
		buffer = buffer.slice(index + 1);
		if (line.length === 0) continue;
		let frame: unknown;
		try {
			frame = JSON.parse(line);
		} catch {
			continue;
		}
		if (typeof frame !== "object" || frame === null) continue;
		const record = frame as Record<string, unknown>;
		if (record.type === "extension_ui_response") {
			const resolve = pendingApprovals.get(String(record.id));
			if (resolve) {
				pendingApprovals.delete(String(record.id));
				resolve(record);
			}
			continue;
		}
		handleCommand(record);
	}
}
