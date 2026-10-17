import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { BtwHistoryRecord, SubagentMessages, TodoPhase } from "@omp-ui/protocol";
import { BtwDrawer, buildBtwTurns } from "@/features/btw";
import {
	addTodoTask,
	computeGoalBudgetMeter,
	computeTabDots,
	computeTabSignatures,
	createEmptySeenSignatures,
	editTodoTaskContent,
	formatGoalDuration,
	formatGoalUsageSummary,
	groupChangedFiles,
	markTabSeen,
	normalizePanelTabId,
	parseUnifiedDiffLines,
	removeTodoTask,
	SidePanel,
	splitFilePath,
	toggleTodoTask,
} from "@/features/panel";
import {
	applySubagentMessagesPage,
	createSubagentCursorState,
	extractSubagentDetailRows,
	extractSubagentMeta,
	formatCompactTokens,
	SubagentDrawer,
	SubagentRow,
} from "@/features/subagents";
import {
	buildPanelFixtureView,
	PANEL_FIXTURE_SESSION_ID,
	PANEL_FIXTURE_SUBAGENT_MESSAGES,
} from "@/fixtures/panel";
import PanelGallerySection from "@/gallery/sections/Panel";
import { useAppStore } from "@/store/app-store";
import { createSessionView, reduce } from "@/store/session-reducer";
describe("Todo edit/toggle/add producing set_todos phases", () => {
	const initialPhases: TodoPhase[] = [
		{
			name: "M1 骨架",
			tasks: [
				{ content: "帧解析与 v2 分片重组", status: "completed" },
				{ content: "进程池与 LRU 回收", status: "in_progress", details: "最大 6 个进程" },
				{ content: "夹具录制", status: "blocked", blocker: "等待真实 provider 凭据" },
			],
		},
		{
			name: "M2 核心对话",
			tasks: [
				{ content: "流式 reducer", status: "pending" },
				{ content: "逐词入场动画", status: "abandoned" },
			],
		},
	];

	test("toggleTodoTask toggles completed -> pending and non-completed -> completed immutably", () => {
		// completed -> pending
		const p1 = toggleTodoTask(initialPhases, 0, 0);
		expect(p1[0]!.tasks[0]!.status).toBe("pending");
		expect(initialPhases[0]!.tasks[0]!.status).toBe("completed");
		expect(p1[1]).toBe(initialPhases[1]);

		// in_progress -> completed (preserving details)
		const p2 = toggleTodoTask(initialPhases, 0, 1);
		expect(p2[0]!.tasks[1]!.status).toBe("completed");
		expect(p2[0]!.tasks[1]!.details).toBe("最大 6 个进程");

		// pending -> completed
		const p3 = toggleTodoTask(initialPhases, 1, 0);
		expect(p3[1]!.tasks[0]!.status).toBe("completed");
	});

	test("editTodoTaskContent updates content trimmed and ignores blank edits", () => {
		const updated = editTodoTaskContent(initialPhases, 0, 1, "  进程池与空闲回收  ");
		expect(updated[0]!.tasks[1]!.content).toBe("进程池与空闲回收");
		expect(updated[0]!.tasks[1]!.status).toBe("in_progress");
		expect(initialPhases[0]!.tasks[1]!.content).toBe("进程池与 LRU 回收");

		const blankEdit = editTodoTaskContent(initialPhases, 0, 1, "   ");
		expect(blankEdit[0]!.tasks[1]!.content).toBe("进程池与 LRU 回收");
	});

	test("addTodoTask appends pending task to target phase or creates phase when empty", () => {
		const added = addTodoTask(initialPhases, 1, "  实现 SidePanel  ");
		expect(added[1]!.tasks).toHaveLength(3);
		expect(added[1]!.tasks[2]).toEqual({
			content: "实现 SidePanel",
			status: "pending",
		});

		const fromEmpty = addTodoTask([], 0, "首个任务", "默认阶段");
		expect(fromEmpty).toEqual([
			{
				name: "默认阶段",
				tasks: [{ content: "首个任务", status: "pending" }],
			},
		]);

		const blankAdd = addTodoTask(initialPhases, 0, "  ");
		expect(blankAdd).toEqual(initialPhases);
	});

	test("removeTodoTask removes task and drops empty non-sole phase", () => {
		const afterOne = removeTodoTask(initialPhases, 1, 0);
		expect(afterOne[1]!.tasks).toHaveLength(1);
		const afterTwo = removeTodoTask(afterOne, 1, 0);
		expect(afterTwo).toHaveLength(1);
		expect(afterTwo[0]!.name).toBe("M1 骨架");
	});
});

describe("Tab new-content dot tracking logic", () => {
	test("unseen non-active tabs with content show dot; active tab never shows dot; visiting clears dot", () => {
		const view = buildPanelFixtureView("s-dot-test");
		const sigs = computeTabSignatures(view);
		expect(sigs.todo).not.toBe("");
		expect(sigs.subagents).not.toBe("");
		expect(sigs.changes).not.toBe("");
		expect(sigs.goal).not.toBe("");
		expect(sigs.info).toBe("");

		let seen = createEmptySeenSignatures();
		// Active tab is "todo": "todo" is marked seen and never shows a dot, while
		// "subagents", "changes", "goal" have unseen content and show dots.
		const dotsOnTodo = computeTabDots(seen, sigs, "todo");
		expect(dotsOnTodo.todo).toBe(false);
		expect(dotsOnTodo.subagents).toBe(true);
		expect(dotsOnTodo.changes).toBe(true);
		expect(dotsOnTodo.goal).toBe(true);
		expect(dotsOnTodo.info).toBe(false);

		// Mark "todo" seen, then user switches to "subagents"
		seen = markTabSeen(seen, sigs, "todo");
		seen = markTabSeen(seen, sigs, "subagents");
		const dotsOnSubagents = computeTabDots(seen, sigs, "subagents");
		expect(dotsOnSubagents.subagents).toBe(false);
		expect(dotsOnSubagents.todo).toBe(false);
		expect(dotsOnSubagents.changes).toBe(true);

		// User switches back to "todo": "subagents" remains seen (dot stays false)
		const dotsBackOnTodo = computeTabDots(seen, sigs, "todo");
		expect(dotsBackOnTodo.subagents).toBe(false);

		// Now a new subagent frame arrives while user is on "todo": "subagents" dot lights up again!
		const updatedView = reduce(
			view,
			{
				type: "subagent_lifecycle",
				payload: {
					id: "sub-new",
					index: 4,
					agent: "task",
					agentSource: "bundled",
					description: "新启动的子代理",
					status: "started",
				},
			},
			{ live: true },
		);
		const nextSigs = computeTabSignatures(updatedView);
		const dotsAfterUpdate = computeTabDots(seen, nextSigs, "todo");
		expect(dotsAfterUpdate.subagents).toBe(true);
		expect(dotsAfterUpdate.todo).toBe(false);
	});

	test("todo_reminder flash timestamp triggers todo tab dot when viewing another tab", () => {
		const view = buildPanelFixtureView("s-flash");
		const sigs1 = computeTabSignatures(view, 0);
		let seen = markTabSeen(createEmptySeenSignatures(), sigs1, "todo");
		seen = markTabSeen(seen, sigs1, "subagents");

		// Viewing "subagents", todo_reminder fires with timestamp 1000
		const sigs2 = computeTabSignatures(view, 1000);
		const dots = computeTabDots(seen, sigs2, "subagents");
		expect(dots.todo).toBe(true);
		expect(dots.subagents).toBe(false);
	});

	test("empty session shows no dots on any tab", () => {
		const emptyView = createSessionView("s-empty");
		const sigs = computeTabSignatures(emptyView);
		const dots = computeTabDots(createEmptySeenSignatures(), sigs, "todo");
		expect(dots).toEqual({
			todo: false,
			subagents: false,
			changes: false,
			goal: false,
			info: false,
		});
	});

	test("normalizePanelTabId maps aliases accurately", () => {
		expect(normalizePanelTabId("todos")).toBe("todo");
		expect(normalizePanelTabId("todo")).toBe("todo");
		expect(normalizePanelTabId("changes")).toBe("changes");
		expect(normalizePanelTabId("subagents")).toBe("subagents");
		expect(normalizePanelTabId("goal")).toBe("goal");
		expect(normalizePanelTabId("info")).toBe("info");
		expect(normalizePanelTabId("unknown")).toBeNull();
	});
});

describe("Subagent polling cursor handling including reset", () => {
	const msg1 = {
		role: "user" as const,
		content: "任务 1",
		timestamp: 1000,
	};
	const msg2 = {
		role: "assistant" as const,
		content: [{ type: "text" as const, text: "回复 1" }],
		api: "anthropic-messages",
		provider: "cpa",
		model: "claude-sonnet-5",
		usage: {
			input: 10,
			output: 20,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 30,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop" as const,
		timestamp: 2000,
	};
	const msg3 = {
		role: "user" as const,
		content: "追问 2",
		timestamp: 3000,
	};

	test("initial load (fromByte 0) sets messages and advances fromByte to nextByte", () => {
		const state0 = createSubagentCursorState();
		const page1: SubagentMessages = {
			sessionFile: "/tmp/sub-1.jsonl",
			fromByte: 0,
			nextByte: 512,
			reset: false,
			entries: [{ id: "e1" }],
			messages: [msg1],
		};
		const state1 = applySubagentMessagesPage(state0, page1);
		expect(state1.fromByte).toBe(512);
		expect(state1.sessionFile).toBe("/tmp/sub-1.jsonl");
		expect(state1.messages).toEqual([msg1]);
		expect(state1.entries).toEqual([{ id: "e1" }]);
	});

	test("incremental page (reset: false) appends new messages and updates nextByte", () => {
		const state1 = applySubagentMessagesPage(createSubagentCursorState(), {
			sessionFile: "/tmp/sub-1.jsonl",
			fromByte: 0,
			nextByte: 512,
			reset: false,
			entries: [{ id: "e1" }],
			messages: [msg1],
		});
		const state2 = applySubagentMessagesPage(state1, {
			sessionFile: "/tmp/sub-1.jsonl",
			fromByte: 512,
			nextByte: 1024,
			reset: false,
			entries: [{ id: "e2" }],
			messages: [msg2],
		});
		expect(state2.fromByte).toBe(1024);
		expect(state2.messages).toEqual([msg1, msg2]);
		expect(state2.entries).toEqual([{ id: "e1" }, { id: "e2" }]);

		// Empty poll at same byte offset preserves state reference
		const state3 = applySubagentMessagesPage(state2, {
			sessionFile: "/tmp/sub-1.jsonl",
			fromByte: 1024,
			nextByte: 1024,
			reset: false,
			entries: [],
			messages: [],
		});
		expect(state3).toBe(state2);
	});

	test("reset: true discards previously accumulated messages and replaces from zero", () => {
		const state1 = applySubagentMessagesPage(createSubagentCursorState(), {
			sessionFile: "/tmp/sub-1.jsonl",
			fromByte: 0,
			nextByte: 1024,
			reset: false,
			entries: [{ id: "e1" }, { id: "e2" }],
			messages: [msg1, msg2],
		});

		const afterReset = applySubagentMessagesPage(state1, {
			sessionFile: "/tmp/sub-1.jsonl",
			fromByte: 0,
			nextByte: 256,
			reset: true,
			entries: [{ id: "e3" }],
			messages: [msg3],
		});
		expect(afterReset.fromByte).toBe(256);
		expect(afterReset.messages).toEqual([msg3]);
		expect(afterReset.entries).toEqual([{ id: "e3" }]);
	});

	test("extractSubagentMeta and extractSubagentDetailRows format progress fields", () => {
		expect(extractSubagentMeta({ turns: 12, tokens: 34000 })).toBe("12 轮 · 34k");
		expect(extractSubagentMeta({ summary: "自定义进度" })).toBe("自定义进度");
		expect(extractSubagentMeta(undefined)).toBeNull();

		const view = buildPanelFixtureView();
		const explore = view.subagents.get("sub-explore")!;
		const rows = extractSubagentDetailRows(explore);
		expect(rows).toEqual([
			{ label: "读取 session-tree.ts", value: "2.1k" },
			{ label: "搜索 leafId", value: "14 处" },
		]);
	});
});

describe("Goal budget meter thresholds and formatting", () => {
	test("below 90% uses accent tone and isWarning=false", () => {
		const m0 = computeGoalBudgetMeter(0, 100_000);
		expect(m0.hasBudget).toBe(true);
		expect(m0.rawPercent).toBe(0);
		expect(m0.widthPercent).toBe(0);
		expect(m0.tone).toBe("accent");
		expect(m0.isWarning).toBe(false);
		expect(m0.isExceeded).toBe(false);

		const m34 = computeGoalBudgetMeter(34_000, 100_000);
		expect(m34.rawPercent).toBe(34);
		expect(m34.widthPercent).toBe(34);
		expect(m34.tone).toBe("accent");
		expect(m34.isWarning).toBe(false);

		const m89 = computeGoalBudgetMeter(89_999, 100_000);
		expect(m89.tone).toBe("accent");
		expect(m89.isWarning).toBe(false);
	});

	test("at and above 90% switches to orange tone and clamps widthPercent at 100%", () => {
		const m90 = computeGoalBudgetMeter(90_000, 100_000);
		expect(m90.rawPercent).toBe(90);
		expect(m90.widthPercent).toBe(90);
		expect(m90.tone).toBe("orange");
		expect(m90.isWarning).toBe(true);
		expect(m90.isExceeded).toBe(false);

		const m100 = computeGoalBudgetMeter(100_000, 100_000);
		expect(m100.rawPercent).toBe(100);
		expect(m100.widthPercent).toBe(100);
		expect(m100.tone).toBe("orange");
		expect(m100.isWarning).toBe(true);
		expect(m100.isExceeded).toBe(true);

		const m125 = computeGoalBudgetMeter(125_000, 100_000);
		expect(m125.rawPercent).toBe(125);
		expect(m125.widthPercent).toBe(100);
		expect(m125.tone).toBe("orange");
		expect(m125.isWarning).toBe(true);
		expect(m125.isExceeded).toBe(true);
	});

	test("missing or non-positive budget returns hasBudget=false", () => {
		expect(computeGoalBudgetMeter(10_000, undefined).hasBudget).toBe(false);
		expect(computeGoalBudgetMeter(10_000, 0).hasBudget).toBe(false);
		expect(computeGoalBudgetMeter(10_000, -500).hasBudget).toBe(false);
	});

	test("formatGoalUsageSummary matches FRONTEND §6.16 '已用 34k / 100k · 12 分钟'", () => {
		expect(
			formatGoalUsageSummary({
				tokensUsed: 34_000,
				tokenBudget: 100_000,
				timeUsedSeconds: 720,
			}),
		).toBe("已用 34k / 100k · 12 分钟");

		expect(formatGoalDuration(45)).toBe("45 秒");
		expect(formatGoalDuration(3660)).toBe("1 小时 1 分钟");
		expect(formatCompactTokens(84_200)).toBe("84.2k");
	});
});

describe("Changed files grouping & Btw turns", () => {
	test("groupChangedFiles aggregates additions/deletions and merged diffs per file", () => {
		const view = buildPanelFixtureView();
		const groups = groupChangedFiles(view);
		expect(groups).toHaveLength(3);
		expect(groups[0]!.path).toBe("packages/bridge/src/process.ts");
		expect(groups[0]!.dir).toBe("packages/bridge/src/");
		expect(groups[0]!.base).toBe("process.ts");
		expect(groups[0]!.additions).toBe(186);
		expect(groups[0]!.mergedDiff).toContain("export class OmpProcess");

		expect(groups[1]!.path).toBe("packages/bridge/src/pool.ts");
		expect(groups[1]!.additions).toBe(74);
		expect(groups[1]!.deletions).toBe(12);
		expect(parseUnifiedDiffLines(groups[1]!.mergedDiff).some(l => l.kind === "add")).toBe(true);
		expect(splitFilePath("README.md")).toEqual({ dir: "", base: "README.md" });
	});

	test("parseUnifiedDiffLines parses omp +123|content / -123|content / ' 123|content' lines", () => {
		const lines = parseUnifiedDiffLines(
			" 18|  evict() {\n-19|    const victim = this.lru.oldest();\n+19|    const victim = this.lru.find(p => p.isSettled);\n 20|    victim.stop();",
		);
		expect(lines).toEqual([
			{ kind: "ctx", oldLine: 18, newLine: 18, text: "  evict() {" },
			{ kind: "del", oldLine: 19, text: "    const victim = this.lru.oldest();" },
			{ kind: "add", newLine: 19, text: "    const victim = this.lru.find(p => p.isSettled);" },
			{ kind: "ctx", oldLine: 20, newLine: 20, text: "    victim.stop();" },
		]);
	});

	test("buildBtwTurns merges followUps and live streaming delta onto latest turn", () => {
		const record: BtwHistoryRecord = {
			id: "btw-test",
			question: "第一个问题",
			answer: "第一个回答",
			status: "complete",
			createdAt: 100,
			updatedAt: 200,
			leafId: null,
			followUps: [
				{
					question: "追问问题",
					answer: "半截回答",
					status: "running",
					createdAt: 300,
					updatedAt: 350,
				},
			],
		};

		const turns = buildBtwTurns(record, " + 实时增量");
		expect(turns).toHaveLength(2);
		expect(turns[0]!.answer).toBe("第一个回答");
		expect(turns[0]!.isStreaming).toBe(false);
		expect(turns[1]!.answer).toBe("半截回答 + 实时增量");
		expect(turns[1]!.isStreaming).toBe(true);
	});
});

describe("Component rendering (SidePanel, SubagentRow, SubagentDrawer, BtwDrawer, Gallery)", () => {
	test("SidePanel renders all 5 tabs and populates from fixture SessionView", () => {
		const view = buildPanelFixtureView(PANEL_FIXTURE_SESSION_ID);
		useAppStore.setState(s => ({
			currentSessionId: PANEL_FIXTURE_SESSION_ID,
			views: { ...s.views, [PANEL_FIXTURE_SESSION_ID]: view },
		}));

		const todoHtml = renderToStaticMarkup(
			createElement(SidePanel, {
				sessionId: PANEL_FIXTURE_SESSION_ID,
				defaultTab: "todo",
				view,
				includeOverlays: false,
			}),
		);
		expect(todoHtml).toContain("待办");
		expect(todoHtml).toContain("子代理");
		expect(todoHtml).toContain("变更");
		expect(todoHtml).toContain("目标");
		expect(todoHtml).toContain("信息");
		expect(todoHtml).toContain("帧解析与 v2 分片重组");
		expect(todoHtml).toContain("等待真实 provider 凭据");

		const subagentsHtml = renderToStaticMarkup(
			createElement(SidePanel, {
				sessionId: PANEL_FIXTURE_SESSION_ID,
				defaultTab: "subagents",
				view,
				includeOverlays: false,
			}),
		);
		expect(subagentsHtml).toContain("explore");
		expect(subagentsHtml).toContain("12 轮 · 34k");

		const changesHtml = renderToStaticMarkup(
			createElement(SidePanel, {
				sessionId: PANEL_FIXTURE_SESSION_ID,
				defaultTab: "changes",
				view,
				includeOverlays: false,
			}),
		);
		expect(changesHtml).toContain("process.ts");
		expect(changesHtml).toContain("pool.ts");

		const goalHtml = renderToStaticMarkup(
			createElement(SidePanel, {
				sessionId: PANEL_FIXTURE_SESSION_ID,
				defaultTab: "goal",
				view,
				includeOverlays: false,
			}),
		);
		expect(goalHtml).toContain("已用 34k / 100k · 12 分钟");

		const infoHtml = renderToStaticMarkup(
			createElement(SidePanel, {
				sessionId: PANEL_FIXTURE_SESSION_ID,
				defaultTab: "info",
				view,
				includeOverlays: false,
			}),
		);
		expect(infoHtml).toContain("cpa/claude-opus-5.5");
		expect(infoHtml).toContain("系统提示词");
		expect(infoHtml).toContain("可用工具");
	});

	test("SubagentRow, SubagentDrawer, BtwDrawer, and PanelGallerySection render cleanly", () => {
		const view = buildPanelFixtureView(PANEL_FIXTURE_SESSION_ID);
		const explore = view.subagents.get("sub-explore")!;
		const capsuleHtml = renderToStaticMarkup(
			createElement(SubagentRow, {
				subagent: explore,
				sessionId: PANEL_FIXTURE_SESSION_ID,
				variant: "capsule",
				defaultOpen: true,
			}),
		);
		expect(capsuleHtml).toContain("查看完整记录");
		expect(capsuleHtml).toContain("读取 session-tree.ts");

		const subDrawerHtml = renderToStaticMarkup(
			createElement(SubagentDrawer, {
				sessionId: PANEL_FIXTURE_SESSION_ID,
				initialSubagentId: "sub-explore",
				subagent: explore,
				initialMessages: PANEL_FIXTURE_SUBAGENT_MESSAGES,
				inline: true,
			}),
		);
		expect(subDrawerHtml).toContain("session-tree.ts");
		expect(subDrawerHtml).toContain("终止");

		const btwDrawerHtml = renderToStaticMarkup(
			createElement(BtwDrawer, {
				sessionId: PANEL_FIXTURE_SESSION_ID,
				view,
				defaultOpen: true,
				inline: true,
			}),
		);
		expect(btwDrawerHtml).toContain("旁问 (btw)");
		expect(btwDrawerHtml).toContain("rpc_chunk 的最大重组字节数默认是多少？");

		const galleryHtml = renderToStaticMarkup(createElement(PanelGallerySection));
		expect(galleryHtml).toContain("右侧面板");
	});
});
