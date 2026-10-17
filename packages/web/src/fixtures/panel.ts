import type { AgentMessage, RpcServerFrame, SessionState, SessionStats } from "@omp-ui/protocol";
import { createSessionView, reduce, type SessionView } from "@/store/session-reducer";

export const PANEL_FIXTURE_SESSION_ID = "fixture-panel-session";

export const PANEL_FIXTURE_FRAMES: RpcServerFrame[] = [
	{ type: "agent_start" },
	{ type: "turn_start" },
	{
		type: "message_start",
		messageId: "m-user-1",
		message: {
			role: "user",
			content: "先看一下 omp 的 RPC 协议，然后把 Bridge 的帧解析与进程池写出来。",
			timestamp: 1760590001000,
		},
	},
	{
		type: "message_end",
		messageId: "m-user-1",
		message: {
			role: "user",
			content: "先看一下 omp 的 RPC 协议，然后把 Bridge 的帧解析与进程池写出来。",
			timestamp: 1760590001000,
		},
	},
	{
		type: "message_start",
		messageId: "m-asst-1",
		message: {
			role: "assistant",
			content: [],
			api: "anthropic-messages",
			provider: "cpa",
			model: "claude-opus-5.5",
			usage: {
				input: 12000,
				output: 1800,
				cacheRead: 4000,
				cacheWrite: 600,
				totalTokens: 18400,
				cost: { input: 0.18, output: 0.135, cacheRead: 0.006, cacheWrite: 0.011, total: 0.332 },
			},
			stopReason: "toolUse",
			timestamp: 1760590005000,
		},
	},
	{
		type: "message_end",
		messageId: "m-asst-1",
		message: {
			role: "assistant",
			content: [
				{
					type: "thinking",
					thinking:
						"ready 帧之后才能 negotiate_protocol。v2 下大帧会被拆成 rpc_chunk，需要按 chunkId 重组并校验 byteLength。",
				},
				{
					type: "toolCall",
					id: "tc-write-process",
					name: "write",
					arguments: {
						path: "packages/bridge/src/process.ts",
						content:
							"export class OmpProcess {\n  #chunks = new Map<string, string[]>();\n  onChunk(f: RpcChunkFrame) {\n    if (f.byteLength > 64 * 1024 * 1024) throw new Error('frame too large');\n  }\n}\n",
					},
				},
				{
					type: "toolCall",
					id: "tc-edit-pool",
					name: "edit",
					arguments: {
						path: "packages/bridge/src/pool.ts",
						oldText: "  evict() {\n    const victim = this.lru.oldest();\n    victim.stop();\n  }",
						newText:
							"  evict() {\n    const victim = this.lru.find(p =>\n      p.isSettled && p.pendingUi.size === 0);\n    if (!victim) return false;\n    victim.stop();\n  }",
					},
				},
				{
					type: "toolCall",
					id: "tc-write-test",
					name: "write",
					arguments: {
						path: "packages/bridge/src/process.test.ts",
						content:
							"import { describe, expect, test } from 'bun:test';\ndescribe('OmpProcess', () => {\n  test('reassembles out-of-order chunks', () => {\n    expect(true).toBe(true);\n  });\n});\n",
					},
				},
			],
			api: "anthropic-messages",
			provider: "cpa",
			model: "claude-opus-5.5",
			usage: {
				input: 12000,
				output: 1800,
				cacheRead: 4000,
				cacheWrite: 600,
				totalTokens: 18400,
				cost: { input: 0.18, output: 0.135, cacheRead: 0.006, cacheWrite: 0.011, total: 0.332 },
			},
			stopReason: "toolUse",
			timestamp: 1760590005000,
		},
	},
	{
		type: "message_end",
		messageId: "m-tr-1",
		message: {
			role: "toolResult",
			toolCallId: "tc-write-process",
			toolName: "write",
			content: [{ type: "text", text: "Wrote packages/bridge/src/process.ts" }],
			details: {
				additions: 186,
				deletions: 0,
				diff: "@@ -0,0 +1,6 @@\n+export class OmpProcess {\n+  #chunks = new Map<string, string[]>();\n+  // v2: 按 chunkId 重组，校验 byteLength\n+  onChunk(f: RpcChunkFrame) {\n+    if (f.byteLength > 64 * 1024 * 1024) throw new Error(\"frame too large\");\n+  }\n+}",
			},
			isError: false,
			timestamp: 1760590006000,
		},
	},
	{
		type: "message_end",
		messageId: "m-tr-2",
		message: {
			role: "toolResult",
			toolCallId: "tc-edit-pool",
			toolName: "edit",
			content: [{ type: "text", text: "Updated packages/bridge/src/pool.ts" }],
			details: {
				additions: 74,
				deletions: 12,
				diff: " 18|  evict() {\n-19|    const victim = this.lru.oldest();\n+19|    const victim = this.lru.find(p =>\n+20|      p.isSettled && p.pendingUi.size === 0);\n+21|    if (!victim) return false;\n 20|    victim.stop();",
			},
			isError: false,
			timestamp: 1760590007000,
		},
	},
	{
		type: "message_end",
		messageId: "m-tr-3",
		message: {
			role: "toolResult",
			toolCallId: "tc-write-test",
			toolName: "write",
			content: [{ type: "text", text: "Wrote packages/bridge/src/process.test.ts" }],
			details: {
				additions: 94,
				deletions: 0,
				diff: "@@ -0,0 +1,6 @@\n+import { describe, expect, test } from \"bun:test\";\n+describe(\"OmpProcess\", () => {\n+  test(\"reassembles out-of-order chunks\", () => {\n+    expect(true).toBe(true);\n+  });\n+});",
			},
			isError: false,
			timestamp: 1760590008000,
		},
	},
	// Subagents lifecycle & progress frames (§10.1, prototype lines 562-568)
	{
		type: "subagent_lifecycle",
		payload: {
			id: "sub-explore",
			index: 1,
			agent: "explore",
			agentSource: "bundled",
			description: "梳理 session 树与 branch 关系",
			status: "started",
			sessionFile: "~/.omp/agent/sessions/sub-explore.jsonl",
			parentToolCallId: "tc-task-1",
		},
	},
	{
		type: "subagent_progress",
		payload: {
			index: 1,
			agent: "explore",
			agentSource: "bundled",
			task: "梳理 session 树与 branch 关系",
			progress: {
				turns: 12,
				tokens: 34000,
				items: [
					{ label: "读取 session-tree.ts", value: "2.1k" },
					{ label: "搜索 leafId", value: "14 处" },
				],
			},
		},
	},
	{
		type: "subagent_lifecycle",
		payload: {
			id: "sub-reviewer",
			index: 2,
			agent: "reviewer",
			agentSource: "bundled",
			description: "审查 process.ts",
			status: "completed",
			sessionFile: "~/.omp/agent/sessions/sub-reviewer.jsonl",
		},
	},
	{
		type: "subagent_lifecycle",
		payload: {
			id: "sub-task",
			index: 3,
			agent: "task",
			agentSource: "project",
			description: "迁移旧配置文件",
			status: "failed",
			sessionFile: "~/.omp/agent/sessions/sub-task.jsonl",
		},
	},
	// Btw records + live streaming delta (§9.8)
	{
		type: "btw_record",
		record: {
			id: "btw-1",
			question: "rpc_chunk 的最大重组字节数默认是多少？",
			answer: "默认上限为 `64 MiB`（`maxReassembledFrameBytes = 64 * 1024 * 1024`），超出时拒绝该帧并记录诊断计数。",
			status: "complete",
			createdAt: 1760590100000,
			updatedAt: 1760590105000,
			leafId: "leaf-1",
			followUps: [
				{
					question: "如果中间丢了一片 chunk 会阻塞后续正常帧吗？",
					answer: "不会。分片按 `chunkId` 独立缓存在 Map 中，其他完整行帧仍按序正常解析。",
					status: "complete",
					createdAt: 1760590120000,
					updatedAt: 1760590126000,
				},
			],
		},
	},
	{
		type: "btw_record",
		record: {
			id: "btw-2",
			question: "為什麼 messageUpdates 选用 delta 而不是 full？",
			answer: "在 `full` 模式下每个 token 都会携带从消息头开始的完整快照，长回复会产生 ",
			status: "running",
			createdAt: 1760590200000,
			updatedAt: 1760590202000,
			leafId: "leaf-2",
		},
	},
	{
		type: "btw_delta",
		recordId: "btw-2",
		delta: "`O(n²)` 级别的 IPC 流量；`delta` 模式只传增量并在 `text_end` 校正。",
	},
];

export const PANEL_FIXTURE_STATE: SessionState = {
	sessionId: PANEL_FIXTURE_SESSION_ID,
	sessionName: "设计前端并实现 Bridge",
	sessionFile: "~/.omp/agent/sessions/-Desktop-code/2026-10-16_01a1b2c3.jsonl",
	thinkingLevel: "high",
	isStreaming: true,
	isSettled: false,
	model: {
		id: "claude-opus-5.5",
		name: "Claude Opus 5.5",
		api: "anthropic-messages",
		provider: "cpa",
		baseUrl: "https://api.anthropic.com",
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
		contextWindow: 200000,
		maxTokens: 32000,
	},
	contextUsage: {
		tokens: 84200,
		contextWindow: 200000,
		percent: 42,
	},
	todoPhases: [
		{
			name: "M1 骨架",
			tasks: [
				{ content: "帧解析与 v2 分片重组", status: "completed" },
				{ content: "进程池与 LRU 回收", status: "in_progress" },
				{ content: "WS 鉴权与 Origin 校验", status: "pending" },
				{
					content: "夹具录制",
					status: "blocked",
					blocker: "等待真实 provider 凭据",
				},
			],
		},
		{
			name: "M2 核心对话",
			tasks: [
				{ content: "流式 reducer", status: "pending" },
				{ content: "逐词入场动画", status: "abandoned" },
			],
		},
	],
	goal: {
		enabled: true,
		mode: "active",
		goal: {
			id: "goal-m1",
			objective: "完成 Bridge 进程池、帧重组与前端面板联调并通过全部测试",
			status: "active",
			tokensUsed: 34000,
			tokenBudget: 100000,
			timeUsedSeconds: 720,
			createdAt: 1760590000000,
			updatedAt: 1760590720000,
		},
	},
	systemPrompt: [
		"Role: You are omp's coding assistant working on omp-ui.",
		"Rules: Follow FRONTEND.md and DESIGN.md specifications strictly.",
	],
	dumpTools: [
		{ name: "read", description: "Read file contents or line ranges from the workspace" },
		{ name: "edit", description: "Apply anchored hashline patches to existing files" },
		{ name: "write", description: "Create or overwrite files in the workspace" },
		{ name: "bash", description: "Execute commands in persistent shell session" },
		{ name: "task", description: "Spawn concurrent subagents for scoped tasks" },
	],
};

export const PANEL_FIXTURE_STATS: SessionStats = {
	sessionId: PANEL_FIXTURE_SESSION_ID,
	userMessages: 4,
	assistantMessages: 5,
	toolCalls: 7,
	toolResults: 7,
	totalMessages: 16,
	tokens: {
		input: 48200,
		output: 12400,
		cacheRead: 21000,
		cacheWrite: 2600,
		reasoning: 3200,
		total: 84200,
	},
	premiumRequests: 4,
	cost: 0.42,
	sessionFile: "~/.omp/agent/sessions/-Desktop-code/2026-10-16_01a1b2c3.jsonl",
	routedModels: {
		"cpa/claude-opus-5.5": 4,
		"cpa/claude-sonnet-5": 1,
	},
	contextUsage: {
		tokens: 84200,
		contextWindow: 200000,
		percent: 42,
	},
};

export const PANEL_FIXTURE_SUBAGENT_MESSAGES: AgentMessage[] = [
	{
		role: "user",
		content: "梳理 session 树与 branch 关系，找出 leafId 如何决定当前分支消息列表。",
		timestamp: 1760590010000,
	},
	{
		role: "assistant",
		content: [
			{
				type: "thinking",
				thinking: "先读取 session-tree.ts，再检索 leafId 的更新位置。",
			},
			{
				type: "toolCall",
				id: "sub-tc-1",
				name: "read",
				arguments: { path: "src/session/session-tree.ts:1-120" },
			},
			{
				type: "toolCall",
				id: "sub-tc-2",
				name: "grep",
				arguments: { pattern: "leafId", path: "src/session" },
			},
			{
				type: "text",
				text: "已梳理完毕：`SessionTree` 通过 `leafId` 向上回溯 `parentId` 构造当前活动分支，调用 `branch { entryId }` 时会把 `leafId` 移动到目标节点并返回原用户提示词文本。",
			},
		],
		api: "anthropic-messages",
		provider: "cpa",
		model: "claude-sonnet-5",
		usage: {
			input: 18000,
			output: 1600,
			cacheRead: 14400,
			cacheWrite: 0,
			totalTokens: 34000,
			cost: { input: 0.054, output: 0.024, cacheRead: 0.004, cacheWrite: 0, total: 0.082 },
		},
		stopReason: "stop",
		timestamp: 1760590040000,
	},
	{
		role: "toolResult",
		toolCallId: "sub-tc-1",
		toolName: "read",
		content: [
			{
				type: "text",
				text: "export class SessionTree {\n  leafId: string | null = null;\n  getBranch(leafId = this.leafId): SessionEntry[] { ... }\n}",
			},
		],
		isError: false,
		timestamp: 1760590020000,
	},
	{
		role: "toolResult",
		toolCallId: "sub-tc-2",
		toolName: "grep",
		content: [
			{
				type: "text",
				text: "src/session/session-tree.ts:14: leafId: string | null\nsrc/session/session-manager.ts:88: this.tree.leafId = entry.id",
			},
		],
		isError: false,
		timestamp: 1760590025000,
	},
];

/**
 * Build a complete fixture `SessionView` by feeding `PANEL_FIXTURE_FRAMES`
 * through the pure `reduce` function (plus cold-start `state` and `stats`).
 */
export function buildPanelFixtureView(
	sessionId = PANEL_FIXTURE_SESSION_ID,
	overrides?: {
		goalTokensUsed?: number;
		noGoal?: boolean;
	},
): SessionView {
	let view = createSessionView(sessionId, {
		proc: "ready",
		readonly: false,
		title: "设计前端并实现 Bridge",
	});

	for (const frame of PANEL_FIXTURE_FRAMES) {
		view = reduce(view, frame, { live: false });
	}

	const goalState = overrides?.noGoal
		? null
		: PANEL_FIXTURE_STATE.goal
			? {
					...PANEL_FIXTURE_STATE.goal,
					goal: {
						...PANEL_FIXTURE_STATE.goal.goal,
						tokensUsed:
							overrides?.goalTokensUsed ?? PANEL_FIXTURE_STATE.goal.goal.tokensUsed,
					},
				}
			: null;

	return {
		...view,
		state: {
			...PANEL_FIXTURE_STATE,
			sessionId,
			goal: goalState,
		},
		stats: {
			...PANEL_FIXTURE_STATS,
			sessionId,
		},
		statsStale: false,
		effects: [],
	};
}
