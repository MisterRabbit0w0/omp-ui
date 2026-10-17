import { describe, expect, test } from "bun:test";
import type {
	AgentMessage,
	AssistantMessage,
	ExtensionUiRequest,
	RpcServerFrame,
	ToolCall,
	TodoPhase,
	ToolResultMessage,
	UserMessage,
} from "@omp-ui/protocol";
import {
	createSessionView,
	reduce,
	reducePromptAck,
	resolveUi,
	selectChangedFiles,
	selectTurns,
	type SessionView,
	type TranscriptItem,
	type ViewMessage,
} from "./session-reducer";

const LIVE = { live: true } as const;

function userMessage(text: string, timestamp = 1): UserMessage {
	return { role: "user", content: text, timestamp };
}

function assistantMessage(content: AssistantMessage["content"], timestamp = 2): AssistantMessage {
	return {
		role: "assistant",
		content,
		api: "anthropic",
		provider: "anthropic",
		model: "claude-test",
		usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
		stopReason: "stop",
		timestamp,
	};
}

function toolCall(id: string, name: string, args: Record<string, unknown> = {}): ToolCall {
	return { type: "toolCall", id, name, arguments: args };
}

function toolResult(toolCallId: string, toolName: string, isError = false, timestamp = 3): ToolResultMessage {
	return { role: "toolResult", toolCallId, toolName, content: [{ type: "text", text: "ok" }], isError, timestamp };
}

function reduceAll(view: SessionView, frames: RpcServerFrame[]): SessionView {
	let v = view;
	for (const f of frames) v = reduce(v, f, LIVE);
	return v;
}

describe("streaming drafts", () => {
	test("deltas accumulate per contentIndex; message_end overwrites with the final message", () => {
		const final = assistantMessage([
			{ type: "text", text: "Hello world" },
			toolCall("tc-1", "bash", { command: "ls -la" }),
		]);
		const view = reduceAll(createSessionView("s1"), [
			{ type: "message_start", message: { role: "assistant" } as unknown as AgentMessage, messageId: "m1" },
			{ type: "message_update", message: { role: "assistant" } as unknown as AgentMessage, messageId: "m1", assistantMessageEvent: { type: "text_start", contentIndex: 0, partial: {} as AssistantMessage } },
			{ type: "message_update", message: { role: "assistant" } as unknown as AgentMessage, messageId: "m1", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "Hello ", partial: {} as AssistantMessage } },
			{ type: "message_update", message: { role: "assistant" } as unknown as AgentMessage, messageId: "m1", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "world", partial: {} as AssistantMessage } },
			{ type: "message_update", message: { role: "assistant" } as unknown as AgentMessage, messageId: "m1", assistantMessageEvent: { type: "toolcall_start", contentIndex: 1, partial: {} as AssistantMessage } },
			{ type: "message_update", message: { role: "assistant" } as unknown as AgentMessage, messageId: "m1", assistantMessageEvent: { type: "toolcall_delta", contentIndex: 1, delta: '{"command":"ls -la"}', partial: {} as AssistantMessage } },
			{ type: "message_update", message: { role: "assistant" } as unknown as AgentMessage, messageId: "m1", assistantMessageEvent: { type: "toolcall_end", contentIndex: 1, toolCall: toolCall("tc-1", "bash", { command: "ls -la" }), partial: {} as AssistantMessage } },
			{ type: "message_update", message: { role: "assistant" } as unknown as AgentMessage, messageId: "m1", assistantMessageEvent: { type: "done", reason: "toolUse", message: final } },
			{ type: "message_end", message: final, messageId: "m1" },
		]);
		expect(view.drafts.size).toBe(0);
		expect(view.messages).toHaveLength(1);
		expect(view.messages[0]).toEqual({ ...final, animateOnMount: true });
	});

	test("text_end / thinking_end overwrite the accumulated block", () => {
		let view = createSessionView("s1");
		const stub = { role: "assistant" } as unknown as AgentMessage;
		view = reduce(view, { type: "message_start", message: stub, messageId: "m1" }, LIVE);
		view = reduce(view, { type: "message_update", message: stub, messageId: "m1", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "dropped-frames", partial: {} as AssistantMessage } }, LIVE);
		view = reduce(view, { type: "message_update", message: stub, messageId: "m1", assistantMessageEvent: { type: "text_end", contentIndex: 0, content: "server truth", partial: {} as AssistantMessage } }, LIVE);
		const draft = view.drafts.get("m1")!;
		expect(draft.content[0]).toEqual({ type: "text", text: "server truth" });
	});

	test("thinking + text + toolcall interleaved by contentIndex", () => {
		const stub = { role: "assistant" } as unknown as AgentMessage;
		const view = reduceAll(createSessionView("s1"), [
			{ type: "message_start", message: stub, messageId: "m1" },
			{ type: "message_update", message: stub, messageId: "m1", assistantMessageEvent: { type: "thinking_start", contentIndex: 0, partial: {} as AssistantMessage } },
			{ type: "message_update", message: stub, messageId: "m1", assistantMessageEvent: { type: "text_start", contentIndex: 1, partial: {} as AssistantMessage } },
			{ type: "message_update", message: stub, messageId: "m1", assistantMessageEvent: { type: "toolcall_start", contentIndex: 2, partial: {} as AssistantMessage } },
			{ type: "message_update", message: stub, messageId: "m1", assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "ponder ", partial: {} as AssistantMessage } },
			{ type: "message_update", message: stub, messageId: "m1", assistantMessageEvent: { type: "text_delta", contentIndex: 1, delta: "answer ", partial: {} as AssistantMessage } },
			{ type: "message_update", message: stub, messageId: "m1", assistantMessageEvent: { type: "toolcall_delta", contentIndex: 2, delta: '{"a":1}', partial: {} as AssistantMessage } },
			{ type: "message_update", message: stub, messageId: "m1", assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "more", partial: {} as AssistantMessage } },
			{ type: "message_update", message: stub, messageId: "m1", assistantMessageEvent: { type: "text_delta", contentIndex: 1, delta: "text", partial: {} as AssistantMessage } },
		]);
		const draft = view.drafts.get("m1")!;
		expect(draft.content[0]).toEqual({ type: "thinking", thinking: "ponder more" });
		expect(draft.content[1]).toEqual({ type: "text", text: "answer text" });
		const tc = draft.content[2];
		expect(tc?.type).toBe("toolCall");
		if (tc?.type === "toolCall") expect(tc.arguments).toEqual({ a: 1 });
	});

	test("toolcall_delta builds a tolerant partial-JSON argument preview", () => {
		const stub = { role: "assistant" } as unknown as AgentMessage;
		let view = reduceAll(createSessionView("s1"), [
			{ type: "message_start", message: stub, messageId: "m1" },
			{ type: "message_update", message: stub, messageId: "m1", assistantMessageEvent: { type: "toolcall_start", contentIndex: 0, partial: {} as AssistantMessage } },
		]);
		const delta = (d: string): void => {
			view = reduce(view, { type: "message_update", message: stub, messageId: "m1", assistantMessageEvent: { type: "toolcall_delta", contentIndex: 0, delta: d, partial: {} as AssistantMessage } }, LIVE);
		};
		const argsAt = (): Record<string, unknown> => {
			const block = view.drafts.get("m1")!.content[0];
			if (block?.type !== "toolCall") throw new Error("expected toolCall block");
			return block.arguments;
		};
		delta('{"command":"ls -l');
		expect(argsAt()).toEqual({ command: "ls -l" });
		delta('a","timeout":');
		expect(argsAt()).toEqual({ command: "ls -la" });
		delta("30}");
		expect(argsAt()).toEqual({ command: "ls -la", timeout: 30 });
	});

	test("agent_end clears leftover drafts", () => {
		const stub = { role: "assistant" } as unknown as AgentMessage;
		let view = reduceAll(createSessionView("s1"), [
			{ type: "message_start", message: stub, messageId: "m1" },
			{ type: "message_update", message: stub, messageId: "m1", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "partial", partial: {} as AssistantMessage } },
		]);
		expect(view.drafts.size).toBe(1);
		view = reduce(view, { type: "agent_end", messages: [] }, LIVE);
		expect(view.drafts.size).toBe(0);
	});

	test("agent_end with messageCount above local count requests a refetch", () => {
		let view = createSessionView("s1");
		view = { ...view, messages: [userMessage("hi")] };
		view = reduce(view, { type: "agent_end", messages: [], messageCount: 5 }, LIVE);
		expect(view.effects.some(e => e.kind === "refetch_messages")).toBe(true);
	});

	test("messages loaded cold are not animated", () => {
		const view = reduce(createSessionView("s1"), { type: "message_end", message: userMessage("hi"), messageId: "u1" }, { live: false });
		expect(view.messages[0]?.animateOnMount).toBe(false);
	});
});

describe("todo tool results", () => {
	test("tool_execution_end of `todo` applies details.phases to state; errors and other tools don't", () => {
		const phases: TodoPhase[] = [{ name: "Fix", tasks: [{ content: "a", status: "in_progress" }] }];
		let view = reduce(createSessionView("s1"), { type: "tool_execution_end", toolCallId: "t1", toolName: "todo", result: { content: [], details: { op: "init", phases } } }, LIVE);
		expect(view.state?.todoPhases).toEqual(phases);
		const before = view.state;
		view = reduce(view, { type: "tool_execution_end", toolCallId: "t2", toolName: "todo", isError: true, result: { details: { phases: [] } } }, LIVE);
		view = reduce(view, { type: "tool_execution_end", toolCallId: "t3", toolName: "bash", result: { details: { phases: [] } } }, LIVE);
		expect(view.state).toBe(before);
	});
});

describe("run status state machine (§6.3)", () => {
	test("prompt ack with agentInvoked:false stays idle; otherwise running", () => {
		let view = createSessionView("s1");
		view = reducePromptAck(view, false);
		expect(view.run.kind).toBe("idle");
		view = reducePromptAck(view, true);
		expect(view.run.kind).toBe("running");
		view = reducePromptAck(view, undefined);
		expect(view.run.kind).toBe("running");
	});

	test("agent_end yielded settles; session_settled idles", () => {
		let view = reduce(createSessionView("s1"), { type: "agent_start" }, LIVE);
		expect(view.run.kind).toBe("running");
		view = reduce(view, { type: "agent_end", messages: [], yielded: true }, LIVE);
		expect(view.run.kind).toBe("settling");
		view = reduce(view, { type: "session_settled" }, LIVE);
		expect(view.run.kind).toBe("idle");
	});

	test("agent_end awaiting async work keeps running", () => {
		let view = reduce(createSessionView("s1"), { type: "agent_start" }, LIVE);
		view = reduce(view, { type: "agent_end", messages: [], yielded: true, awaitingAsyncWork: true }, LIVE);
		expect(view.run.kind).toBe("running");
	});

	test("auto_compaction and auto_retry transitions", () => {
		let view = reduce(createSessionView("s1"), { type: "agent_start" }, LIVE);
		view = reduce(view, { type: "auto_compaction_start", reason: "threshold", action: "remote" }, LIVE);
		expect(view.run.kind).toBe("compacting");
		view = reduce(view, { type: "auto_compaction_end", action: "remote", aborted: false, willRetry: false }, LIVE);
		expect(view.run.kind).toBe("running");
		view = reduce(view, { type: "auto_retry_start", attempt: 2, maxAttempts: 5, delayMs: 4000, errorMessage: "boom" }, LIVE);
		expect(view.run).toEqual({ kind: "retrying", attempt: 2, maxAttempts: 5, delayMs: 4000 });
		view = reduce(view, { type: "auto_retry_end", success: true, attempt: 2 }, LIVE);
		expect(view.run.kind).toBe("running");
	});

	test("prompt_result error idles and raises an error banner", () => {
		let view = reduce(createSessionView("s1"), { type: "agent_start" }, LIVE);
		view = reduce(
			view,
			{ type: "prompt_result", agentInvoked: true, status: "error", sessionSettled: true, error: { message: "overloaded", retryable: true, provider: "anthropic", httpStatus: 529 } },
			LIVE,
		);
		expect(view.run.kind).toBe("idle");
		const banner = view.banners.find(b => b.kind === "prompt-error");
		expect(banner).toMatchObject({ message: "overloaded", retryable: true, httpStatus: 529 });
	});
});

describe("pendingUi lifecycle", () => {
	const approval: ExtensionUiRequest = {
		type: "extension_ui_request",
		id: "req-1",
		method: "select",
		title: "Allow tool: bash\n$ rm -rf /tmp/x",
		options: ["Approve", "Deny"],
	};

	test("dialog requests are added; cancel removes them by targetId", () => {
		let view = reduce(createSessionView("s1"), approval, LIVE);
		expect(view.pendingUi).toHaveLength(1);
		expect(view.pendingUi[0]?.id).toBe("req-1");
		view = reduce(view, { type: "extension_ui_request", id: "cancel-1", method: "cancel", targetId: "req-1" }, LIVE);
		expect(view.pendingUi).toHaveLength(0);
	});

	test("notify/setStatus/setWidget/setTitle/set_editor_text/open_url route to their own fields", () => {
		let view = createSessionView("s1");
		view = reduce(view, { type: "extension_ui_request", id: "n1", method: "notify", message: "hi", notifyType: "warning" }, LIVE);
		expect(view.effects).toEqual([{ kind: "toast", level: "warning", message: "hi" }]);
		view = reduce(view, { type: "extension_ui_request", id: "s1", method: "setStatus", statusKey: "bg", statusText: "syncing" }, LIVE);
		expect(view.statusChips.get("bg")).toBe("syncing");
		view = reduce(view, { type: "extension_ui_request", id: "s2", method: "setStatus", statusKey: "bg" }, LIVE);
		expect(view.statusChips.has("bg")).toBe(false);
		view = reduce(view, { type: "extension_ui_request", id: "w1", method: "setWidget", widgetKey: "k", widgetLines: ["a", "b"], widgetPlacement: "aboveEditor" }, LIVE);
		expect(view.widgets.get("k")).toEqual({ lines: ["a", "b"], placement: "aboveEditor" });
		view = reduce(view, { type: "extension_ui_request", id: "w2", method: "setWidget", widgetKey: "k" }, LIVE);
		expect(view.widgets.has("k")).toBe(false);
		view = reduce(view, { type: "extension_ui_request", id: "t1", method: "setTitle", title: "Renamed" }, LIVE);
		expect(view.title).toBe("Renamed");
		view = reduce(view, { type: "extension_ui_request", id: "e1", method: "set_editor_text", text: "draft" }, LIVE);
		view = reduce(view, { type: "extension_ui_request", id: "o1", method: "open_url", url: "https://x.test", launchUrl: "http://127.0.0.1" }, LIVE);
		expect(view.effects).toContainEqual({ kind: "set_editor_text", text: "draft" });
		expect(view.effects).toContainEqual({ kind: "open_url", url: "https://x.test", launchUrl: "http://127.0.0.1", instructions: undefined });
		expect(view.lastOpenUrl?.url).toBe("https://x.test");
		view = reduce(view, { type: "extension_ui_request", id: "in1", method: "input", title: "Paste the authorization code (or full redirect URL):" }, LIVE);
		view = resolveUi(view, "in1", { response: { type: "extension_ui_response", id: "in1", cancelled: true } });
		expect(view.lastOpenUrl).toBeUndefined();
	});
});

describe("queue / banners / misc", () => {
	test("queue_update snapshot", () => {
		const view = reduce(createSessionView("s1"), { type: "queue_update", steering: ["a", "b"], followUp: ["c"], liveSteered: 1 }, LIVE);
		expect(view.queue).toEqual({ steering: ["a", "b"], followUp: ["c"], liveSteered: 1 });
	});

	test("retry banner: start adds, failed end swaps to retry-failed", () => {
		let view = createSessionView("s1");
		view = reduce(view, { type: "agent_start" }, LIVE);
		view = reduce(view, { type: "auto_retry_start", attempt: 1, maxAttempts: 3, delayMs: 2000, errorMessage: "rate limited" }, LIVE);
		expect(view.banners.some(b => b.kind === "retry")).toBe(true);
		view = reduce(view, { type: "auto_retry_end", success: false, attempt: 3, finalError: "still broken" }, LIVE);
		expect(view.banners.some(b => b.kind === "retry")).toBe(false);
		expect(view.banners.find(b => b.kind === "retry-failed")).toMatchObject({ attempt: 3, finalError: "still broken" });
	});

	test("tool execution map with stream log", () => {
		let view = createSessionView("s1");
		view = reduce(view, { type: "tool_execution_start", toolCallId: "t1", toolName: "bash", args: { command: "make" }, intent: "build" }, LIVE);
		view = reduce(view, { type: "tool_stream_update", toolCallId: "t1", toolName: "bash", update: "compiling\n" }, LIVE);
		view = reduce(view, { type: "tool_stream_update", toolCallId: "t1", toolName: "bash", update: "done\n" }, LIVE);
		view = reduce(view, { type: "tool_execution_end", toolCallId: "t1", toolName: "bash", result: { output: "done\n" } }, LIVE);
		const exec = view.toolExec.get("t1")!;
		expect(exec.status).toBe("done");
		expect(exec.streamLog).toBe("compiling\ndone\n");
		expect(exec.intent).toBe("build");
	});

	test("tool_execution_end error marks error status", () => {
		let view = createSessionView("s1");
		view = reduce(view, { type: "tool_execution_start", toolCallId: "t1", toolName: "bash" }, LIVE);
		view = reduce(view, { type: "tool_execution_end", toolCallId: "t1", toolName: "bash", isError: true }, LIVE);
		expect(view.toolExec.get("t1")?.status).toBe("error");
	});
});

describe("selectTurns", () => {
	test("groups messages into user messages and assistant turns with merged tool results", () => {
		const view = createSessionView("s1");
		const a1 = assistantMessage([{ type: "text", text: "let me look" }, toolCall("t1", "read", { path: "a.ts" })], 2);
		const a2 = assistantMessage([{ type: "text", text: "done" }], 5);
		view.messages = [
			userMessage("hi", 1),
			a1,
			toolResult("t1", "read", false, 3),
			a2,
			userMessage("thanks", 6),
		];
		const items = selectTurns(view);
		expect(items.map(i => i.kind)).toEqual(["message", "turn", "message"]);
		const turnItem = items[1];
		if (!turnItem || turnItem.kind !== "turn") throw new Error("expected turn");
		const { turn } = turnItem;
		expect(turn.messages).toHaveLength(2);
		expect(turn.tools).toHaveLength(1);
		expect(turn.tools[0]?.result?.toolCallId).toBe("t1");
		// toolResult is merged into the call, not rendered standalone
		const standalone = items.filter((i): i is Extract<TranscriptItem, { kind: "message" }> => i.kind === "message");
		expect(standalone.every(i => i.message.role === "user")).toBe(true);
	});

	test("orphan toolResult stays standalone", () => {
		const view = createSessionView("s1");
		view.messages = [toolResult("t9", "read", false, 1)];
		const items = selectTurns(view);
		expect(items).toHaveLength(1);
		expect(items[0]?.kind).toBe("message");
	});

	test("≥3 consecutive read-only tools collapse into one group", () => {
		const view = createSessionView("s1");
		const a = assistantMessage([
			toolCall("t1", "read", { path: "a" }),
			toolCall("t2", "grep", { pattern: "x" }),
			toolCall("t3", "glob", { pattern: "*.ts" }),
			toolCall("t4", "bash", { command: "ls" }),
			toolCall("t5", "read", { path: "b" }),
			toolCall("t6", "read", { path: "c" }),
		]);
		view.messages = [a];
		const items = selectTurns(view);
		const turnItem = items[0];
		if (!turnItem || turnItem.kind !== "turn") throw new Error("expected turn");
		const { turn } = turnItem;
		expect(turn.tools).toHaveLength(6);
		expect(turn.groups).toHaveLength(4);
		expect(turn.groups[0]).toMatchObject({ readOnlyCollapsed: true });
		expect(turn.groups[0]?.tools.map(t => t.call.id)).toEqual(["t1", "t2", "t3"]);
		expect(turn.groups[1]?.tools[0]?.call.id).toBe("t4");
		// only 2 consecutive read-only at the tail: not collapsed
		expect(turn.groups[2]?.readOnlyCollapsed).toBe(false);
		expect(turn.groups[3]?.readOnlyCollapsed).toBe(false);
	});

	test("streaming drafts trail the transcript", () => {
		const stub = { role: "assistant" } as unknown as AgentMessage;
		let view = createSessionView("s1");
		view.messages = [userMessage("hi", 1)];
		view = reduce(view, { type: "message_start", message: stub, messageId: "m1" }, LIVE);
		const items = selectTurns(view);
		expect(items.map(i => i.kind)).toEqual(["message", "draft"]);
	});

	test("hidden developer / non-display messages do not split an agent loop into two turns", () => {
		const view = createSessionView("s1");
		const reminder = { role: "developer", content: [{ type: "text", text: "rule" }], timestamp: 4 } as unknown as ViewMessage;
		const hiddenCustom = { role: "custom", customType: "x", content: "", display: false, timestamp: 4 } as unknown as ViewMessage;
		view.messages = [
			userMessage("hi", 1),
			assistantMessage([toolCall("t1", "edit", { input: "x" })], 2),
			toolResult("t1", "edit", false, 3),
			reminder,
			hiddenCustom,
			assistantMessage([{ type: "text", text: "done" }], 5),
		];
		expect(selectTurns(view).map(i => i.kind)).toEqual(["message", "turn"]);
	});
});

describe("selectChangedFiles", () => {
	test("successful edit/write/notebook calls only", () => {
		const view = createSessionView("s1");
		const a = assistantMessage([
			toolCall("t1", "edit", { path: "src/a.ts" }),
			toolCall("t2", "write", { path: "src/b.ts" }),
			toolCall("t3", "read", { path: "src/c.ts" }),
			toolCall("t4", "edit", { path: "src/d.ts" }),
		]);
		const ok = toolResult("t1", "edit", false, 3);
		const okWrite: ToolResultMessage = { ...toolResult("t2", "write", false, 4), details: { additions: 10, deletions: 2 } };
		view.messages = [a, ok, okWrite, toolResult("t3", "read", false, 5), toolResult("t4", "edit", true, 6)];
		const files = selectChangedFiles(view);
		expect(files.map(f => f.path)).toEqual(["src/a.ts", "src/b.ts"]);
		expect(files[1]).toMatchObject({ additions: 10, deletions: 2 });
	});

	test("omp shapes: hashline edit (path only in details), multi-file perFileResults, write resolvedPath", () => {
		const view = createSessionView("s1");
		const a = assistantMessage([
			toolCall("e1", "edit", { input: "[C:\\w\\a.ts#AB12]\nPUT 1.=1:\n+x" }),
			toolCall("e2", "edit", { input: "..." }),
			toolCall("w1", "write", { path: "rel/c.ts", content: "x" }),
		]);
		view.messages = [
			a,
			{ ...toolResult("e1", "edit", false, 3), details: { path: "C:\\w\\a.ts", diff: "-1|a\n+1|b" } },
			{ ...toolResult("e2", "edit", false, 4), details: { perFileResults: [{ path: "C:\\w\\x.ts" }, { path: "C:\\w\\y.ts", additions: 2 }] } },
			{ ...toolResult("w1", "write", false, 5), details: { resolvedPath: "C:\\w\\rel\\c.ts" } },
		];
		const files = selectChangedFiles(view);
		expect(files.map(f => f.path)).toEqual(["C:\\w\\a.ts", "C:\\w\\x.ts", "C:\\w\\y.ts", "C:\\w\\rel\\c.ts"]);
		expect(files[2]).toMatchObject({ toolCallId: "e2", additions: 2 });
	});
});
