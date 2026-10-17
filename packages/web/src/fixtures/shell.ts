import type { RpcServerFrame, SessionListItem, SessionState, SessionStats } from "@omp-ui/protocol";
import { createSessionView, reduce, type SessionView } from "@/store/session-reducer";

const NOW = Date.parse("2026-10-16T12:00:00Z");

export const SHELL_FIXTURE_NOW_MS = NOW;

export const SHELL_FIXTURE_SESSIONS: readonly SessionListItem[] = [
	{
		id: "sess-running",
		file: "~/.omp/agent/sessions/-Desktop-code-tools-omp-ui/2026-10-16_sess-running.jsonl",
		cwd: "/Users/chengqi/Desktop/code/tools/omp-ui",
		title: "设计前端并实现 Bridge",
		createdAt: new Date(NOW - 1800_000).toISOString(),
		updatedAt: new Date(NOW - 20_000).toISOString(),
		sizeBytes: 48_200,
		live: true,
		running: false,
		archived: false,
	},
	{
		id: "sess-waiting",
		file: "~/.omp/agent/sessions/-Desktop-code-tools-omp-ui/2026-10-16_sess-waiting.jsonl",
		cwd: "/Users/chengqi/Desktop/code/tools/omp-ui",
		title: "审批流程联调",
		createdAt: new Date(NOW - 3600_000).toISOString(),
		updatedAt: new Date(NOW - 12 * 60_000).toISOString(),
		sizeBytes: 31_400,
		live: true,
		running: false,
		archived: false,
	},
	{
		id: "sess-idle",
		file: "~/.omp/agent/sessions/-Desktop-code-tools-omp-ui/2026-10-16_sess-idle.jsonl",
		cwd: "/Users/chengqi/Desktop/code/tools/omp-ui",
		title: "RPC 帧夹具录制",
		createdAt: new Date(NOW - 4 * 3600_000).toISOString(),
		updatedAt: new Date(NOW - 2 * 3600_000).toISOString(),
		sizeBytes: 19_800,
		live: false,
		running: false,
		archived: false,
	},
	{
		id: "sess-unread",
		file: "~/.omp/agent/sessions/-Desktop-code-oh-my-pi/2026-10-15_sess-unread.jsonl",
		cwd: "/Users/chengqi/Desktop/code/oh-my-pi",
		title: "修复 grep 工具的 Windows 路径",
		createdAt: new Date(NOW - 28 * 3600_000).toISOString(),
		updatedAt: new Date(NOW - 26 * 3600_000).toISOString(),
		sizeBytes: 64_100,
		live: false,
		running: false,
		archived: false,
	},
	{
		id: "sess-error",
		file: "~/.omp/agent/sessions/-Desktop-code-oh-my-pi/2026-10-15_sess-error.jsonl",
		cwd: "/Users/chengqi/Desktop/code/oh-my-pi",
		title: "升级 tailwind v4",
		createdAt: new Date(NOW - 30 * 3600_000).toISOString(),
		updatedAt: new Date(NOW - 27 * 3600_000).toISOString(),
		sizeBytes: 22_500,
		live: true,
		running: false,
		archived: false,
	},
	{
		id: "sess-tree",
		file: "~/.omp/agent/sessions/-Desktop-code-oh-my-pi/2026-10-12_sess-tree.jsonl",
		cwd: "/Users/chengqi/Desktop/code/oh-my-pi",
		title: "解释 session 树结构",
		createdAt: new Date(NOW - 4 * 86400_000).toISOString(),
		updatedAt: new Date(NOW - 4 * 86400_000).toISOString(),
		sizeBytes: 14_900,
		live: false,
		running: false,
		archived: false,
	},
	{
		id: "sess-school-1",
		file: "~/.omp/agent/sessions/-Desktop-school/2026-09-28_sess-school-1.jsonl",
		cwd: "/Users/chengqi/Desktop/school",
		title: "OS Lab 3 页表实现",
		createdAt: "2026-09-28T08:00:00Z",
		updatedAt: "2026-09-28T10:30:00Z",
		sizeBytes: 51_200,
		live: false,
		running: false,
		archived: false,
	},
	{
		id: "sess-school-2",
		file: "~/.omp/agent/sessions/-Desktop-school/2026-09-20_sess-school-2.jsonl",
		cwd: "/Users/chengqi/Desktop/school",
		title: "汇编示例逐行讲解",
		createdAt: "2026-09-20T08:00:00Z",
		updatedAt: "2026-09-20T09:15:00Z",
		sizeBytes: 18_400,
		live: false,
		running: false,
		archived: false,
	},
];

function applyFrames(base: SessionView, frames: readonly RpcServerFrame[]): SessionView {
	let view = base;
	for (const f of frames) {
		view = reduce(view, f, { live: false });
	}
	return { ...view, effects: [] };
}

function makeStats(sessionId: string, tokens: number, contextWindow: number, cost: number): SessionStats {
	const percent = Math.round((tokens / contextWindow) * 100);
	return {
		sessionId,
		userMessages: 3,
		assistantMessages: 3,
		toolCalls: 5,
		toolResults: 5,
		totalMessages: 11,
		tokens: {
			input: Math.round(tokens * 0.45),
			output: Math.round(tokens * 0.15),
			cacheRead: Math.round(tokens * 0.35),
			cacheWrite: Math.round(tokens * 0.05),
			total: tokens,
		},
		premiumRequests: 1,
		cost,
		contextUsage: {
			tokens,
			contextWindow,
			percent,
		},
	};
}

function makeState(sessionId: string, title: string, percent: number): SessionState {
	const tokens = Math.round((percent / 100) * 200_000);
	return {
		sessionId,
		sessionName: title,
		isStreaming: false,
		isSettled: true,
		contextUsage: {
			tokens,
			contextWindow: 200_000,
			percent,
		},
	};
}

export function buildShellFixtureViews(): Record<string, SessionView> {
	// 1. Running session (42% context, $0.42, status chip "lsp: ts ready")
	const runningBase: SessionView = {
		...createSessionView("sess-running", { proc: "ready", title: "设计前端并实现 Bridge" }),
		state: makeState("sess-running", "设计前端并实现 Bridge", 42),
		stats: makeStats("sess-running", 84_200, 200_000, 0.42),
	};
	const runningView = applyFrames(runningBase, [
		{ type: "agent_start" },
		{
			type: "extension_ui_request",
			id: "status-1",
			method: "setStatus",
			statusKey: "lsp",
			statusText: "lsp: ts ready",
		},
	]);

	// 2. Waiting for approval session (84% orange context ring, $1.18)
	const waitingBase: SessionView = {
		...createSessionView("sess-waiting", { proc: "ready", title: "审批流程联调" }),
		state: makeState("sess-waiting", "审批流程联调", 84),
		stats: makeStats("sess-waiting", 168_000, 200_000, 1.18),
	};
	const waitingView = applyFrames(waitingBase, [
		{ type: "agent_start" },
		{
			type: "extension_ui_request",
			id: "appr-1",
			method: "select",
			title: "Allow tool: bash\nReason: 审批模式为每次询问\n$ bun test && bun run typecheck",
			options: ["Approve", "Deny"],
			timeout: 60_000,
		},
	]);

	// 3. Error / high context session (97% red context ring, $2.64)
	const errorBase: SessionView = {
		...createSessionView("sess-error", { proc: "ready", title: "升级 tailwind v4" }),
		state: makeState("sess-error", "升级 tailwind v4", 97),
		stats: makeStats("sess-error", 194_000, 200_000, 2.64),
	};
	const errorView = applyFrames(errorBase, [
		{
			type: "prompt_result",
			agentInvoked: true,
			status: "error",
			sessionSettled: true,
			error: {
				message: "Overloaded",
				retryable: true,
				provider: "anthropic",
				model: "opus-5.5",
				httpStatus: 529,
			},
		},
	]);

	return {
		"sess-running": runningView,
		"sess-waiting": waitingView,
		"sess-error": errorView,
	};
}

export const SHELL_FIXTURE_ATTENTION: Readonly<Record<string, number>> = {
	"sess-unread": NOW - 60_000,
};
