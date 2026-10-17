/**
 * Transcript & Tools fixtures built by feeding realistic `RpcServerFrame` sequences
 * through `reduce` (DESIGN §6.2, FRONTEND §6.3–§6.11, prototype/index.html).
 */
import type { AssistantMessage, RpcServerFrame, Usage } from "@omp-ui/protocol";
import { createSessionView, reduce, type SessionView } from "../store/session-reducer";

const BASE_USAGE: Usage = {
	input: 12400,
	output: 5800,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 18200,
	cost: { input: 0.18, output: 0.24, cacheRead: 0, cacheWrite: 0, total: 0.42 },
};

function makeAssistantMessage(overrides: Partial<AssistantMessage>): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: "anthropic-messages",
		provider: "anthropic",
		model: "cpa/claude-opus-5.5",
		usage: BASE_USAGE,
		stopReason: "stop",
		timestamp: 1760590000000,
		duration: 41000,
		ttft: 420,
		...overrides,
	};
}

export const SAMPLE_TYPESCRIPT_CODE = `export class OmpProcess {
  #chunks = new Map<string, string[]>();
  // v2: 按 chunkId 重组，校验 byteLength
  onChunk(f: RpcChunkFrame) {
    if (f.byteLength > 64 * 1024 * 1024) throw new Error("frame too large");
    const slots = this.#chunks.get(f.chunkId) ?? new Array<string>(f.count);
    slots[f.index] = f.data;
    this.#chunks.set(f.chunkId, slots);
  }
}`;

export const SAMPLE_OMP_DIFF = ` 18|  evict() {
-19|    const victim = this.lru.oldest();
+19|    const victim = this.lru.find(p =>
+20|      p.isSettled && p.pendingUi.size === 0);
+21|    if (!victim) return false;
 22|    victim.stop();
 23|    return true;
 24|  }`;

export const SAMPLE_FOLDABLE_OLD = [
	"export class ProcessPool {",
	"  private readonly maxProcesses = 6;",
	"  private readonly active = new Map<string, OmpProcess>();",
	"  private readonly lastUsed = new Map<string, number>();",
	"  private readonly pendingCount = new Map<string, number>();",
	"  private readonly settledFlags = new Map<string, boolean>();",
	"  private readonly listeners = new Set<() => void>();",
	"  private readonly logger = createLogger('pool');",
	"  private readonly metrics = createMetrics('pool');",
	"",
	"  evict(): boolean {",
	"    const victim = this.lru.oldest();",
	"    victim.stop();",
	"    return true;",
	"  }",
	"}",
].join("\n");

export const SAMPLE_FOLDABLE_NEW = [
	"export class ProcessPool {",
	"  private readonly maxProcesses = 6;",
	"  private readonly active = new Map<string, OmpProcess>();",
	"  private readonly lastUsed = new Map<string, number>();",
	"  private readonly pendingCount = new Map<string, number>();",
	"  private readonly settledFlags = new Map<string, boolean>();",
	"  private readonly listeners = new Set<() => void>();",
	"  private readonly logger = createLogger('pool');",
	"  private readonly metrics = createMetrics('pool');",
	"",
	"  evict(): boolean {",
	"    const victim = this.lru.find(p =>",
	"      p.isSettled && p.pendingUi.size === 0);",
	"    if (!victim) return false;",
	"    victim.stop();",
	"    return true;",
	"  }",
	"}",
].join("\n");

/**
 * Build the primary prototype chat scene `SessionView` by replaying RPC frames
 * through `reduce`:
 * - Turn 1 (completed): user message + fileMention chip, thinking (6s),
 *   3 merged read calls ("查看了 3 个文件"), write process.ts (+186),
 *   bash `bun test packages/bridge` (exit 0), prose summary, diff chips, action row.
 * - Compaction summary divider ("上下文已压缩 · 182k → 24k").
 * - Turn 2 (live): user message, thinking (3s), edit pool.ts (+74 -12),
 *   task subagent capsule (`explore`), and bash `bun test && bun run typecheck`
 *   awaiting approval with anchored `ApprovalCard` + `RunIndicator` ("等待你的回应").
 */
export function createPrototypeChatFixture(sessionId = "fixture-chat"): SessionView {
	let view = createSessionView(sessionId, {
		proc: "ready",
		title: "设计前端并实现 Bridge",
	});

	const t0 = 1760590000000;
	const frames: RpcServerFrame[] = [
		// ── Turn 1: User message + fileMention ──────────────────────
		{
			type: "message_end",
			messageId: "u-1",
			message: {
				role: "user",
				content: "先看一下 omp 的 RPC 协议，然后把 Bridge 的帧解析写出来，支持 v2 分片。",
				timestamp: t0,
			},
		},
		{
			type: "message_end",
			messageId: "fm-1",
			message: {
				role: "fileMention",
				files: [
					{
						path: "docs/DESIGN.md",
						content: "# omp-ui 设计文档",
						lineCount: 614,
					},
				],
				timestamp: t0 + 10,
			},
		},

		// ── Turn 1: Assistant message with thinking, 5 tools, prose ──
		{
			type: "tool_execution_start",
			toolCallId: "tc-read-1",
			toolName: "read",
			args: { path: "src/modes/rpc/wire/frames.ts" },
		},
		{
			type: "tool_execution_end",
			toolCallId: "tc-read-1",
			toolName: "read",
			result: { output: "export interface RpcChunkFrame { chunkId: string; index: number; count: number; }" },
		},
		{
			type: "tool_execution_start",
			toolCallId: "tc-read-2",
			toolName: "read",
			args: { path: "src/modes/rpc/rpc-frame.ts" },
		},
		{
			type: "tool_execution_end",
			toolCallId: "tc-read-2",
			toolName: "read",
			result: { output: "export function parseFrame(line: string): unknown { return JSON.parse(line); }" },
		},
		{
			type: "tool_execution_start",
			toolCallId: "tc-read-3",
			toolName: "read",
			args: { path: "src/modes/rpc/rpc-types.ts:320-340" },
		},
		{
			type: "tool_execution_end",
			toolCallId: "tc-read-3",
			toolName: "read",
			result: { output: "export type ProtocolVersion = 1 | 2;" },
		},
		{
			type: "tool_execution_start",
			toolCallId: "tc-write-1",
			toolName: "write",
			args: {
				path: "packages/bridge/src/process.ts",
				content: SAMPLE_TYPESCRIPT_CODE,
			},
		},
		{
			type: "tool_execution_end",
			toolCallId: "tc-write-1",
			toolName: "write",
			result: {
				details: { resolvedPath: "packages/bridge/src/process.ts", additions: 186, deletions: 0 },
			},
		},
		{
			type: "tool_execution_start",
			toolCallId: "tc-write-2",
			toolName: "write",
			args: {
				path: "packages/bridge/test/process.test.ts",
				content: `import { describe, expect, test } from "bun:test";\ndescribe("OmpProcess", () => {\n  test("reassembles chunks", () => {\n    expect(true).toBe(true);\n  });\n});`,
			},
		},
		{
			type: "tool_execution_end",
			toolCallId: "tc-write-2",
			toolName: "write",
			result: {
				details: { resolvedPath: "packages/bridge/test/process.test.ts", additions: 94, deletions: 0 },
			},
		},
		{
			type: "tool_execution_start",
			toolCallId: "tc-bash-1",
			toolName: "bash",
			args: { command: "bun test packages/bridge" },
		},
		{
			type: "tool_execution_end",
			toolCallId: "tc-bash-1",
			toolName: "bash",
			result: {
				exitCode: 0,
				output: [
					"bun test v1.3.2",
					" ✓ frames › reassembles out-of-order chunks [1.2ms]",
					" ✓ frames › rejects byteLength mismatch [0.3ms]",
					" ✓ frames › enforces maxReassembledFrameBytes [0.4ms]",
					" ✓ process › correlates responses by id [3.1ms]",
					"",
					" 4 pass · 0 fail · 12 expect() calls",
				].join("\n"),
			},
		},
		{
			type: "message_end",
			messageId: "a-1",
			message: makeAssistantMessage({
				timestamp: t0 + 1000,
				duration: 12000,
				content: [
					{
						type: "thinking",
						thinking:
							"ready 帧之后才能 negotiate_protocol。v2 下大帧会被拆成 rpc_chunk，需要按 chunkId 重组并校验 byteLength。先读 wire/frames.ts 和 rpc-frame.ts。",
					},
					{
						type: "toolCall",
						id: "tc-read-1",
						name: "read",
						arguments: { path: "src/modes/rpc/wire/frames.ts" },
					},
					{
						type: "toolCall",
						id: "tc-read-2",
						name: "read",
						arguments: { path: "src/modes/rpc/rpc-frame.ts" },
					},
					{
						type: "toolCall",
						id: "tc-read-3",
						name: "read",
						arguments: { path: "src/modes/rpc/rpc-types.ts:320-340" },
					},
					{
						type: "toolCall",
						id: "tc-write-1",
						name: "write",
						arguments: {
							path: "packages/bridge/src/process.ts",
							content: SAMPLE_TYPESCRIPT_CODE,
						},
					},
					{
						type: "toolCall",
						id: "tc-write-2",
						name: "write",
						arguments: {
							path: "packages/bridge/test/process.test.ts",
							content: "// tests",
						},
					},
					{
						type: "toolCall",
						id: "tc-bash-1",
						name: "bash",
						arguments: { command: "bun test packages/bridge" },
					},
					{
						type: "text",
						text: [
							"Bridge 的帧层已写好，在 `packages/bridge/src/process.ts`：",
							"",
							"- 按行切分 stdout，首帧必须是 `ready`，支持 v2 时自动协商；",
							"- `rpc_chunk` 按 `chunkId` 重组，校验 `byteLength` 和 64MB 上限；",
							"- 命令按 `id` 关联，`login` 与 `predict_word` 使用各自的超时。",
							"",
							"4 个测试全部通过。下一步是进程池，见 [DESIGN.md §3.1](#)。",
						].join("\n"),
					},
				],
			}),
		},
		{
			type: "message_end",
			messageId: "tr-write-1",
			message: {
				role: "toolResult",
				toolCallId: "tc-write-1",
				toolName: "write",
				isError: false,
				timestamp: t0 + 2000,
				content: [{ type: "text", text: SAMPLE_TYPESCRIPT_CODE }],
				details: { resolvedPath: "packages/bridge/src/process.ts", additions: 186, deletions: 0 },
			},
		},
		{
			type: "message_end",
			messageId: "tr-write-2",
			message: {
				role: "toolResult",
				toolCallId: "tc-write-2",
				toolName: "write",
				isError: false,
				timestamp: t0 + 2100,
				content: [{ type: "text", text: "// tests" }],
				details: { resolvedPath: "packages/bridge/test/process.test.ts", additions: 94, deletions: 0 },
			},
		},
		{
			type: "message_end",
			messageId: "tr-bash-1",
			message: {
				role: "toolResult",
				toolCallId: "tc-bash-1",
				toolName: "bash",
				isError: false,
				timestamp: t0 + 3000,
				content: [
					{
						type: "text",
						text: [
							"bun test v1.3.2",
							" ✓ frames › reassembles out-of-order chunks [1.2ms]",
							" ✓ frames › rejects byteLength mismatch [0.3ms]",
							" ✓ frames › enforces maxReassembledFrameBytes [0.4ms]",
							" ✓ process › correlates responses by id [3.1ms]",
							"",
							" 4 pass · 0 fail · 12 expect() calls",
						].join("\n"),
					},
				],
				details: { exitCode: 0, durationMs: 2100 },
			},
		},

		// ── Compaction summary divider ──────────────────────────────
		{
			type: "message_end",
			messageId: "compact-1",
			message: {
				role: "compactionSummary",
				summary: "已完成 Bridge 帧解析与 v2 分片重组实现，4 个单元测试通过。",
				tokensBefore: 182000,
				tokensAfter: 24000,
				timestamp: t0 + 4000,
			},
		},

		// ── Turn 2: User message + live turn with approval pending ──
		{
			type: "message_end",
			messageId: "u-2",
			message: {
				role: "user",
				content: "好，继续做进程池，跑一下全部测试。",
				timestamp: t0 + 5000,
			},
		},
		{
			type: "agent_start",
		},
		{
			type: "tool_execution_start",
			toolCallId: "tc-edit-pool",
			toolName: "edit",
			args: { path: "packages/bridge/src/pool.ts" },
		},
		{
			type: "tool_execution_end",
			toolCallId: "tc-edit-pool",
			toolName: "edit",
			result: {
				details: {
					path: "packages/bridge/src/pool.ts",
					diff: SAMPLE_OMP_DIFF,
					additions: 74,
					deletions: 12,
				},
			},
		},
		{
			type: "subagent_lifecycle",
			payload: {
				id: "sub-explore-1",
				index: 1,
				agent: "explore",
				agentSource: "bundled",
				status: "started",
				description: "梳理 session 树与 branch 关系",
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
				parentToolCallId: "tc-task-1",
				progress: {
					turns: 12,
					tokens: 34000,
					steps: [
						{ label: "读取 session-tree.ts", value: "2.1k" },
						{ label: "搜索 leafId", value: "14 处" },
					],
				},
			},
		},
		{
			type: "tool_execution_start",
			toolCallId: "tc-bash-pending",
			toolName: "bash",
			args: { command: "bun test && bun run typecheck" },
		},
		{
			type: "message_end",
			messageId: "a-2",
			message: makeAssistantMessage({
				timestamp: t0 + 6000,
				duration: 6000,
				stopReason: "toolUse",
				content: [
					{
						type: "thinking",
						thinking:
							"池上限 6，超限时回收 isSettled 且没有待答 UI 请求的进程。需要改 pool.ts，然后跑 bun test。",
					},
					{
						type: "toolCall",
						id: "tc-edit-pool",
						name: "edit",
						arguments: { path: "packages/bridge/src/pool.ts" },
					},
					{
						type: "toolCall",
						id: "tc-task-1",
						name: "task",
						arguments: {
							context: "梳理 session 树与 branch 关系",
							tasks: [{ name: "explore", task: "梳理 session 树与 branch 关系", solutionSpace: "read-only" }],
						},
					},
					{
						type: "toolCall",
						id: "tc-bash-pending",
						name: "bash",
						arguments: { command: "bun test && bun run typecheck" },
					},
				],
			}),
		},
		{
			type: "message_end",
			messageId: "tr-edit-pool",
			message: {
				role: "toolResult",
				toolCallId: "tc-edit-pool",
				toolName: "edit",
				isError: false,
				timestamp: t0 + 6200,
				content: [{ type: "text", text: SAMPLE_OMP_DIFF }],
				details: {
					path: "packages/bridge/src/pool.ts",
					diff: SAMPLE_OMP_DIFF,
					additions: 74,
					deletions: 12,
				},
			},
		},
		// Approval select request arrives after tool_execution_start for `tc-bash-pending`
		{
			type: "extension_ui_request",
			id: "req-approve-bash",
			method: "select",
			title: [
				"Allow tool: bash",
				'Reason: 审批模式为"每次询问"',
				"$ bun test && bun run typecheck",
				"cwd: ~/Desktop/code/tools/omp-ui",
			].join("\n"),
			options: ["Approve", "Deny"],
			timeout: 60000,
		},
	];

	for (const frame of frames) {
		view = reduce(view, frame, { live: false });
	}

	// Set deterministic durations on toolExec entries so "0.4s" / "2.1s" match prototype
	const r1 = view.toolExec.get("tc-read-1");
	if (r1) view.toolExec.set("tc-read-1", { ...r1, startedAt: 1000, endedAt: 1400 });
	const b1 = view.toolExec.get("tc-bash-1");
	if (b1) view.toolExec.set("tc-bash-1", { ...b1, startedAt: 1000, endedAt: 3100 });

	return view;
}

/**
 * Build a fixture showcasing live streaming bash (`exec.streamLog`),
 * `AskCard` (multi-question with recommended chip & preview),
 * `OpenUrlCard`, and in-transcript `retry` + `prompt-error` banners.
 */
export function createInteractiveAndBannersFixture(sessionId = "fixture-ask"): SessionView {
	let view = createSessionView(sessionId, {
		proc: "ready",
		title: "进程池策略与异常处理",
	});

	const t0 = 1760595000000;
	const frames: RpcServerFrame[] = [
		{
			type: "message_end",
			messageId: "u-ask-1",
			message: {
				role: "user",
				content: "配置进程池上限回收策略，并运行压测脚本。",
				timestamp: t0,
			},
		},
		{
			type: "agent_start",
		},
		{
			type: "tool_execution_start",
			toolCallId: "tc-bash-live",
			toolName: "bash",
			args: { command: "bun scripts/bench-pool.ts --concurrency 8" },
		},
		{
			type: "tool_stream_update",
			toolCallId: "tc-bash-live",
			toolName: "bash",
			update: "[00:00.1] Spawning 6 worker processes...\n[00:01.4] Pool saturated (6/6 active), 2 queued...\n[00:02.0] Waiting for eviction policy...",
		},
		{
			type: "message_end",
			messageId: "a-ask-1",
			message: makeAssistantMessage({
				timestamp: t0 + 1000,
				stopReason: "toolUse",
				content: [
					{
						type: "toolCall",
						id: "tc-bash-live",
						name: "bash",
						arguments: { command: "bun scripts/bench-pool.ts --concurrency 8" },
					},
				],
			}),
		},
		{
			type: "extension_ui_request",
			id: "req-ask-pool",
			method: "ask",
			timeout: 120000,
			questions: [
				{
					id: "q-evict",
					header: "进程池",
					question: "超出上限时怎么处理新会话？",
					recommended: 0,
					options: [
						{
							label: "回收最久未用的空闲进程",
							description: "仅回收 isSettled=true 且无待答 UI 请求的进程（SIGTERM → 5s SIGKILL）",
							preview: "const victim = this.lru.find(p => p.isSettled && p.pendingUi.size === 0);",
						},
						{
							label: "拒绝并提示用户手动关闭",
						},
						{
							label: "不限制数量",
						},
					],
				},
				{
					id: "q-limit",
					header: "容量",
					question: "默认最大并发进程数设为多少？",
					recommended: 1,
					options: [
						{ label: "4 个进程" },
						{ label: "6 个进程" },
						{ label: "10 个进程" },
					],
				},
			],
		},
		{
			type: "auto_retry_start",
			attempt: 2,
			maxAttempts: 5,
			delayMs: 4000,
			errorMessage: "429 rate limited",
		},
		{
			type: "prompt_result",
			id: "p-1",
			agentInvoked: true,
			status: "error",
			sessionSettled: true,
			error: {
				message: "Provider overloaded",
				provider: "anthropic",
				model: "opus-5.5",
				httpStatus: 529,
				retryable: true,
			},
		},
	];

	for (const frame of frames) {
		view = reduce(view, frame, { live: false });
	}
	return view;
}
