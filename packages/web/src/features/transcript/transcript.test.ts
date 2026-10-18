import { describe, expect, test } from "bun:test";
import type { ExtensionUiRequest, SessionEntries, ToolCall, ToolResultMessage } from "@omp-ui/protocol";
import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createSessionView, reduce, resolveUi, selectTurns, type ToolExec } from "../../store/session-reducer";
import {
	computeDiffFromOldNew,
	extractDiffSource,
	getToolRowSummary,
	parseUnifiedDiffText,
	renderToolDetail,
	TOOL_RENDERERS,
} from "../tools";
import { anchorApprovals } from "./approval-anchor";
import { anchorAsks } from "./ask-anchor";
import { matchBranchEntry, resolveActiveBranchUserEntries } from "./branch-match";
import { splitStreamTail } from "./streaming-tail";

describe("splitStreamTail (§4.3 streaming tail split)", () => {
	test("returns empty head and tail for empty string", () => {
		expect(splitStreamTail("")).toEqual({ head: "", tail: "" });
	});

	test("puts short single-line text into tail", () => {
		const res = splitStreamTail("正在解析帧数据", 24);
		expect(res.head).toBe("");
		expect(res.tail).toBe("正在解析帧数据");
	});

	test("splits last ~24 code points on long single-line text", () => {
		const input = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
		const res = splitStreamTail(input, 24);
		expect(res.head + res.tail).toBe(input);
		expect(Array.from(res.tail).length).toBe(24);
		expect(res.tail).toBe("CDEFGHIJKLMNOPQRSTUVWXYZ");
	});

	test("does not split surrogate pairs (emoji)", () => {
		const emojis = "🚀".repeat(30);
		const res = splitStreamTail(emojis, 24);
		expect(res.head + res.tail).toBe(emojis);
		expect(Array.from(res.tail).length).toBe(24);
		expect(res.tail).toBe("🚀".repeat(24));
	});

	test("keeps tail after last newline so markdown blocks in head stay intact", () => {
		const input = "# Heading\n- item 1\n- item 2";
		const res = splitStreamTail(input, 24);
		expect(res.head).toBe("# Heading\n- item 1\n");
		expect(res.tail).toBe("- item 2");
	});
});

describe("anchorApprovals (§7.3 approval anchoring)", () => {
	const bashApprovalReq: ExtensionUiRequest = {
		type: "extension_ui_request",
		id: "req-1",
		method: "select",
		title: "Allow tool: bash\nReason: Always ask\n$ rm -rf dist",
		options: ["Approve", "Deny"],
	};

	test("anchors approval to the most recent running tool call of the same name (exec.status === 'running')", () => {
		let view = createSessionView("s1");
		// First bash tool call completed
		view = reduce(
			view,
			{
				type: "tool_execution_start",
				toolCallId: "bash-1",
				toolName: "bash",
				args: { command: "ls" },
			},
			{ live: true },
		);
		view = reduce(
			view,
			{
				type: "tool_execution_end",
				toolCallId: "bash-1",
				toolName: "bash",
				result: { output: "ok" },
			},
			{ live: true },
		);
		// Second bash tool call started and is awaiting approval
		view = reduce(
			view,
			{
				type: "tool_execution_start",
				toolCallId: "bash-2",
				toolName: "bash",
				args: { command: "rm -rf dist" },
			},
			{ live: true },
		);
		view = reduce(
			view,
			{
				type: "message_end",
				messageId: "m1",
				message: {
					role: "assistant",
					content: [
						{ type: "toolCall", id: "bash-1", name: "bash", arguments: { command: "ls" } },
						{ type: "toolCall", id: "bash-2", name: "bash", arguments: { command: "rm -rf dist" } },
					],
					api: "anthropic",
					provider: "anthropic",
					model: "opus-5.5",
					usage: {
						input: 10,
						output: 10,
						cacheRead: 0,
						cacheWrite: 0,
						totalTokens: 20,
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
					},
					stopReason: "toolUse",
					timestamp: 1000,
				},
			},
			{ live: true },
		);
		view = reduce(view, bashApprovalReq, { live: true });

		const turns = selectTurns(view);
		const anchored = anchorApprovals(turns, view.pendingUi, view.toolExec);

		expect(anchored.unanchored.length).toBe(0);
		expect(anchored.byToolCallId.get("bash-1")).toBeUndefined();
		expect(anchored.byToolCallId.get("bash-2")?.length).toBe(1);
		expect(anchored.byToolCallId.get("bash-2")?.[0]?.requestId).toBe("req-1");
	});

	test("falls back to unanchored at end of transcript when all matching tool calls already finished", () => {
		let view = createSessionView("s2");
		view = reduce(
			view,
			{
				type: "tool_execution_start",
				toolCallId: "bash-done",
				toolName: "bash",
			},
			{ live: true },
		);
		view = reduce(
			view,
			{
				type: "tool_execution_end",
				toolCallId: "bash-done",
				toolName: "bash",
				result: { output: "done" },
			},
			{ live: true },
		);
		view = reduce(
			view,
			{
				type: "message_end",
				messageId: "m1",
				message: {
					role: "assistant",
					content: [{ type: "toolCall", id: "bash-done", name: "bash", arguments: { command: "echo hi" } }],
					api: "anthropic",
					provider: "anthropic",
					model: "opus",
					usage: {
						input: 1,
						output: 1,
						cacheRead: 0,
						cacheWrite: 0,
						totalTokens: 2,
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
					},
					stopReason: "toolUse",
					timestamp: 1000,
				},
			},
			{ live: true },
		);
		view = reduce(view, bashApprovalReq, { live: true });

		const turns = selectTurns(view);
		const anchored = anchorApprovals(turns, view.pendingUi, view.toolExec);
		expect(anchored.byToolCallId.size).toBe(0);
		expect(anchored.unanchored.length).toBe(1);
		expect(anchored.unanchored[0]?.toolName).toBe("bash");
	});

	test("does not anchor to a streaming draft tool call that has not reached toolcall_end yet", () => {
		let view = createSessionView("s3");
		view = reduce(
			view,
			{
				type: "message_update",
				messageId: "d1",
				message: {
					role: "assistant",
					content: [],
					api: "anthropic",
					provider: "anthropic",
					model: "opus",
					usage: {
						input: 0,
						output: 0,
						cacheRead: 0,
						cacheWrite: 0,
						totalTokens: 0,
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
					},
					stopReason: "stop",
					timestamp: 1000,
				},
				assistantMessageEvent: {
					type: "toolcall_start",
					contentIndex: 0,
					partial: {} as never,
				},
			},
			{ live: true },
		);
		view = reduce(
			view,
			{
				type: "message_update",
				messageId: "d1",
				message: {} as never,
				assistantMessageEvent: {
					type: "toolcall_delta",
					contentIndex: 0,
					delta: '{"command":"ls',
					partial: {} as never,
				},
			},
			{ live: true },
		);
		view = reduce(view, bashApprovalReq, { live: true });

		const turns = selectTurns(view);
		const anchored = anchorApprovals(turns, view.pendingUi, view.toolExec);
		expect(anchored.byToolCallId.size).toBe(0);
		expect(anchored.unanchored.length).toBe(1);
	});
});

describe("anchorAsks (§6.8 inline ask position)", () => {
	const askReq: ExtensionUiRequest = {
		type: "extension_ui_request",
		id: "ask-1",
		method: "ask",
		questions: [{ id: "q1", question: "Pick a color?", options: [{ label: "Red" }, { label: "Blue" }] }],
	};
	const askMessage = {
		role: "assistant" as const,
		content: [{ type: "toolCall" as const, id: "ask-call-1", name: "ask", arguments: {} }],
		api: "fake",
		provider: "fake",
		model: "fake/model",
		usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
		stopReason: "toolUse" as const,
		timestamp: 1000,
	};

	function askView() {
		let view = createSessionView("ask-session");
		view = reduce(view, { type: "message_end", messageId: "m-ask", message: askMessage }, { live: true });
		view = reduce(view, { type: "tool_execution_start", toolCallId: "ask-call-1", toolName: "ask", args: {} }, { live: true });
		return view;
	}

	test("anchors a pending ask under its running ask tool call", () => {
		const view = reduce(askView(), askReq, { live: true });
		const anchored = anchorAsks(selectTurns(view), view.pendingUi, view.answeredUi, view.toolExec);
		expect(anchored.unanchored).toHaveLength(0);
		expect(anchored.byToolCallId.get("ask-call-1")?.[0]?.request.id).toBe("ask-1");
	});

	test("keeps the answered receipt under the same tool call", () => {
		let view = reduce(askView(), askReq, { live: true });
		view = resolveUi(view, "ask-1", {
			response: { type: "extension_ui_response", id: "ask-1", answers: [{ id: "q1", selectedOptions: ["Blue"] }] },
		});
		view = reduce(view, { type: "tool_execution_end", toolCallId: "ask-call-1", toolName: "ask", result: { output: "ok" } }, { live: true });
		const anchored = anchorAsks(selectTurns(view), view.pendingUi, view.answeredUi, view.toolExec);
		expect(anchored.unanchored).toHaveLength(0);
		expect(anchored.byToolCallId.get("ask-call-1")?.[0]?.entry?.response).toMatchObject({
			answers: [{ id: "q1", selectedOptions: ["Blue"] }],
		});
	});

	test("falls back to the transcript tail when no ask tool row exists", () => {
		const view = reduce(createSessionView("ask-only"), askReq, { live: true });
		const anchored = anchorAsks(selectTurns(view), view.pendingUi, view.answeredUi, view.toolExec);
		expect(anchored.byToolCallId.size).toBe(0);
		expect(anchored.unanchored).toHaveLength(1);
	});
});

describe("branch entry matching (DESIGN §9.3, verified protocol rule #3)", () => {
	test("walks leafId -> parentId on get_entries, skipping abandoned branches and non-user messages", () => {
		// Tree:
		// e1 (user: "first") -> e2 (assistant) -> e3 (user: "abandoned branch")
		//                                      \-> e4 (user: "active second") -> e5 (assistant) -> e6 (user: "active third")
		const entriesResult: SessionEntries = {
			leafId: "e6",
			entries: [
				{ id: "e1", parentId: null, type: "message", message: { role: "user", content: "first" } },
				{ id: "e2", parentId: "e1", type: "message", message: { role: "assistant", content: [] } },
				{ id: "e3", parentId: "e2", type: "message", message: { role: "user", content: "abandoned branch" } },
				{ id: "e4", parentId: "e2", type: "message", message: { role: "user", content: "active second" } },
				{ id: "e5", parentId: "e4", type: "message", message: { role: "assistant", content: [] } },
				{ id: "e6", parentId: "e5", type: "message", message: { role: "user", content: "active third" } },
			],
		};

		const activeUsers = resolveActiveBranchUserEntries(entriesResult);
		expect(activeUsers.map(u => u.entryId)).toEqual(["e1", "e4", "e6"]);

		const transcriptUserMessages = [
			{ content: "first" },
			{ content: "active second" },
			{ content: "active third" },
		];

		expect(matchBranchEntry(transcriptUserMessages, 0, entriesResult)?.entryId).toBe("e1");
		expect(matchBranchEntry(transcriptUserMessages, 1, entriesResult)?.entryId).toBe("e4");
		expect(matchBranchEntry(transcriptUserMessages, 2, entriesResult)?.entryId).toBe("e6");
	});

	test("skips synthetic user messages when mapping ordinal index", () => {
		const entriesResult: SessionEntries = {
			leafId: "e3",
			entries: [
				{ id: "e1", parentId: null, type: "message", message: { role: "user", content: "real 1" } },
				{ id: "e2", parentId: "e1", type: "message", message: { role: "user", content: "synthetic", synthetic: true } },
				{ id: "e3", parentId: "e2", type: "message", message: { role: "user", content: "real 2" } },
			],
		};
		const transcriptUsers = [
			{ content: "real 1" },
			{ content: "synthetic", synthetic: true },
			{ content: "real 2" },
		];
		expect(matchBranchEntry(transcriptUsers, 0, entriesResult)?.entryId).toBe("e1");
		expect(matchBranchEntry(transcriptUsers, 2, entriesResult)?.entryId).toBe("e3");
	});
});

describe("tool renderer fallback on weird shapes & omp diff format (§8)", () => {
	const WEIRD_INPUTS: unknown[] = [
		null,
		undefined,
		42,
		"not-an-object",
		true,
		[],
		[1, "two", null],
		{ command: 12345, path: null, tasks: "not-an-array", phases: { bad: true } },
		{ results: [null, 123, { url: ":::invalid-url:::" }] },
	];

	const TOOL_NAMES = [
		"bash",
		"python",
		"read",
		"write",
		"edit",
		"notebook",
		"grep",
		"glob",
		"find",
		"web_search",
		"browser",
		"task",
		"todo",
		"mcp__github__get_issue",
		"unknown_custom_tool",
	];

	test("every tool renderer summary and body handles weird args/result shapes without throwing", () => {
		for (const toolName of TOOL_NAMES) {
			for (const weird of WEIRD_INPUTS) {
				const fakeCall: ToolCall = {
					type: "toolCall",
					id: "tc-weird",
					name: toolName,
					arguments: weird as Record<string, unknown>,
				};
				const fakeResult: ToolResultMessage = {
					role: "toolResult",
					toolCallId: "tc-weird",
					toolName,
					content: weird as never,
					isError: false,
					timestamp: 1000,
					details: weird,
				};
				const fakeExec: ToolExec = {
					toolCallId: "tc-weird",
					toolName,
					status: "done",
					args: weird,
					result: weird,
					streamLog: "",
					startedAt: 100,
					endedAt: 200,
				};

				expect(() => getToolRowSummary(fakeCall, fakeResult, fakeExec)).not.toThrow();
				const summary = getToolRowSummary(fakeCall, fakeResult, fakeExec);
				expect(typeof summary.verb).toBe("string");

				const element = renderToolDetail({
					callId: "tc-weird",
					toolName,
					args: weird,
					result: fakeResult,
					exec: fakeExec,
				});
				expect(() => renderToStaticMarkup(createElement(Fragment, null, element))).not.toThrow();
			}
		}
		expect(TOOL_RENDERERS.length).toBeGreaterThanOrEqual(8);
	});

	test("parses omp numbered diff format (+123|content, -123|content,  123|content, and legacy +123 content)", () => {
		const ompDiff = [
			" 18|  evict() {",
			"-19|    const victim = this.lru.oldest();",
			"+19|    const victim = this.lru.find(p => p.isSettled);",
			"+20|    if (!victim) return false;",
			" 21|    victim.stop();",
		].join("\n");

		const parsed = parseUnifiedDiffText(ompDiff);
		expect(parsed.additions).toBe(2);
		expect(parsed.deletions).toBe(1);
		expect(parsed.lines[0]?.kind).toBe("context");
		expect(parsed.lines[0]?.oldLineNumber).toBe(18);
		expect(parsed.lines[1]?.kind).toBe("del");
		expect(parsed.lines[1]?.oldLineNumber).toBe(19);
		expect(parsed.lines[1]?.content).toBe("    const victim = this.lru.oldest();");
		expect(parsed.lines[2]?.kind).toBe("add");
		expect(parsed.lines[2]?.newLineNumber).toBe(19);

		// Legacy space format
		const legacyDiff = "-10 old line\n+10 new line";
		const parsedLegacy = parseUnifiedDiffText(legacyDiff);
		expect(parsedLegacy.additions).toBe(1);
		expect(parsedLegacy.deletions).toBe(1);
		expect(parsedLegacy.lines[0]?.oldLineNumber).toBe(10);
		expect(parsedLegacy.lines[1]?.newLineNumber).toBe(10);
	});

	test("extractDiffSource prefers details.oldText/newText, supports perFileResults, and renders write from args.content", () => {
		const editSrc = extractDiffSource(
			{ path: "a.ts" },
			{
				path: "a.ts",
				diff: "-1|old\n+1|new",
				oldText: "line1\nold\nline3\n",
				newText: "line1\nnew\nline3\n",
			},
		);
		expect(editSrc.oldText).toBe("line1\nold\nline3\n");
		expect(editSrc.newText).toBe("line1\nnew\nline3\n");
		const hunks = computeDiffFromOldNew(editSrc.oldText!, editSrc.newText!);
		expect(hunks.additions).toBe(1);
		expect(hunks.deletions).toBe(1);

		// Multi-file perFileResults
		const multiSrc = extractDiffSource(
			{},
			{
				perFileResults: [
					{ path: "one.ts", diff: "+1|const a = 1;" },
					{ path: "two.ts", diff: "-2|old\n+2|new" },
				],
			},
		);
		expect(multiSrc.perFileResults?.length).toBe(2);
		expect(multiSrc.filePath).toBe("one.ts");

		// Write tool: details have no diff, falls back to args.content as new file
		const writeSrc = extractDiffSource(
			{ path: "new-file.ts", content: "export const x = 1;\nexport const y = 2;\n" },
			{ resolvedPath: "/abs/new-file.ts", diagnostics: [] },
		);
		expect(writeSrc.filePath).toBe("/abs/new-file.ts");
		expect(writeSrc.oldText).toBe("");
		expect(writeSrc.newText).toBe("export const x = 1;\nexport const y = 2;\n");
	});
});
