/**
 * Realistic fixtures for Composer & UiRequestLayer gallery and tests.
 * Built by feeding `RpcServerFrame` sequences through `reduce`.
 */
import type {
	AvailableSlashCommand,
	ConfirmUiRequest,
	EditorUiRequest,
	FileHit,
	InputUiRequest,
	ModelInfo,
	RpcServerFrame,
	SelectUiRequest,
	SessionState,
	ThinkingLevel,
} from "@omp-ui/protocol";
import type { AttachmentItem } from "@/features/composer/logic";
import { createSessionView, reduce, type SessionView } from "@/store/session-reducer";

export const COMPOSER_MODELS: ModelInfo[] = [
	{
		id: "claude-opus-5.5",
		name: "Claude Opus 5.5",
		api: "anthropic-messages",
		provider: "anthropic",
		baseUrl: "https://api.anthropic.com",
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
		contextWindow: 200_000,
		maxTokens: 32_000,
		thinking: {
			mode: "budget",
			efforts: ["low", "medium", "high", "xhigh"],
			defaultLevel: "high",
		},
	},
	{
		id: "claude-sonnet-5",
		name: "Claude Sonnet 5",
		api: "anthropic-messages",
		provider: "anthropic",
		baseUrl: "https://api.anthropic.com",
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
		contextWindow: 200_000,
		maxTokens: 16_384,
		thinking: {
			mode: "budget",
			efforts: ["low", "medium", "high"],
			defaultLevel: "high",
		},
	},
	{
		id: "gpt-5.4",
		name: "GPT-5.4",
		api: "openai-responses",
		provider: "openai",
		baseUrl: "https://api.openai.com/v1",
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 2.5, output: 10, cacheRead: 0.25, cacheWrite: 2.5 },
		contextWindow: 400_000,
		maxTokens: 32_768,
		thinking: {
			mode: "effort",
			efforts: ["minimal", "low", "medium", "high", "xhigh"],
			defaultLevel: "high",
		},
	},
	{
		id: "deepseek-r2",
		name: "DeepSeek R2 (仅文本)",
		api: "openai-completions",
		provider: "deepseek",
		baseUrl: "https://api.deepseek.com",
		reasoning: true,
		input: ["text"],
		cost: { input: 0.55, output: 2.19, cacheRead: 0.14, cacheWrite: 0.55 },
		contextWindow: 128_000,
		maxTokens: 16_384,
	},
];

export const COMPOSER_THINKING_LEVELS: ThinkingLevel[] = [
	"inherit",
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
];

export const COMPOSER_SLASH_COMMANDS: AvailableSlashCommand[] = [
	{
		name: "compact",
		source: "builtin",
		description: "压缩当前上下文",
		input: { hint: "[instructions]" },
	},
	{
		name: "fork",
		source: "builtin",
		description: "从当前位置分叉为新会话",
	},
	{
		name: "security",
		source: "extension",
		description: "计划、运行、比较安全扫描",
		subcommands: [
			{ name: "scan", description: "扫描工作区高危依赖与配置", usage: "[target]" },
			{ name: "compare", description: "与上次基线报告对比差异", usage: "<baseline>" },
		],
	},
	{
		name: "commit",
		source: "skill",
		description: "生成提交信息并更新 changelog",
		input: { hint: "[scope]" },
	},
	{
		name: "pr-summary",
		source: "mcp_prompt",
		description: "汇总当前分支变更并草拟 PR 描述",
	},
];

export const COMPOSER_FILE_HITS: FileHit[] = [
	{
		path: "packages/bridge/src/process.ts",
		dir: "packages/bridge/src",
		name: "process.ts",
	},
	{
		path: "packages/bridge/src/pool.ts",
		dir: "packages/bridge/src",
		name: "pool.ts",
	},
	{
		path: "packages/web/src/store/session-reducer.ts",
		dir: "packages/web/src/store",
		name: "session-reducer.ts",
	},
	{
		path: "docs/DESIGN.md",
		dir: "docs",
		name: "DESIGN.md",
	},
];

const SAMPLE_THUMB_SVG_1 =
	"data:image/svg+xml;utf8," +
	encodeURIComponent(
		`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" rx="8" fill="#2b5ce6"/><circle cx="22" cy="22" r="7" fill="#fff" opacity="0.85"/><path d="M10 50l14-16 11 11 9-9 10 14z" fill="#fff"/></svg>`,
	);

const SAMPLE_THUMB_SVG_2 =
	"data:image/svg+xml;utf8," +
	encodeURIComponent(
		`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" rx="8" fill="#1e293b"/><path d="M16 20h32M16 32h24M16 44h28" stroke="#94a3b8" stroke-width="4" stroke-linecap="round"/></svg>`,
	);

export const COMPOSER_SAMPLE_ATTACHMENTS: AttachmentItem[] = [
	{
		id: "att-fixture-1",
		name: "architecture-diagram.png",
		image: {
			type: "image",
			mimeType: "image/png",
			data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
		},
		dataUrl: SAMPLE_THUMB_SVG_1,
		width: 1440,
		height: 900,
	},
	{
		id: "att-fixture-2",
		name: "trace-flamegraph-2026.png",
		image: {
			type: "image",
			mimeType: "image/png",
			data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
		},
		dataUrl: SAMPLE_THUMB_SVG_2,
		width: 2000,
		height: 1125,
	},
];

function applyFrames(initial: SessionView, frames: readonly RpcServerFrame[]): SessionView {
	let view = initial;
	for (const frame of frames) {
		view = reduce(view, frame, { live: false });
	}
	return { ...view, effects: [] };
}

function baseState(sessionId: string, overrides?: Partial<SessionState>): SessionState {
	return {
		sessionId,
		model: COMPOSER_MODELS[0],
		thinkingLevel: "high",
		isStreaming: false,
		isCompacting: false,
		fastModeEnabled: false,
		fastModeActive: false,
		slowModeSupported: true,
		slowModeEnabled: false,
		slowModeScope: "session",
		isSettled: true,
		contextUsage: { tokens: 84_200, contextWindow: 200_000, percent: 42 },
		...overrides,
	};
}

export function createComposerIdleView(sessionId = "composer-idle"): SessionView {
	const base: SessionView = {
		...createSessionView(sessionId, { proc: "ready", title: "设计前端并实现 Bridge" }),
		state: baseState(sessionId),
		models: COMPOSER_MODELS,
		thinkingLevels: COMPOSER_THINKING_LEVELS,
		commands: COMPOSER_SLASH_COMMANDS,
	};

	const frames: RpcServerFrame[] = [
		{
			type: "available_commands_update",
			commands: COMPOSER_SLASH_COMMANDS,
		},
		{
			type: "message_start",
			messageId: "u-1",
			message: {
				role: "user",
				content: "先看一下 omp 的 RPC 协议，然后把 Bridge 的帧解析写出来，支持 v2 分片。",
				timestamp: 1_760_000_001_000,
			},
		},
		{
			type: "message_end",
			messageId: "u-1",
			message: {
				role: "user",
				content: "先看一下 omp 的 RPC 协议，然后把 Bridge 的帧解析写出来，支持 v2 分片。",
				timestamp: 1_760_000_001_000,
			},
		},
	];

	return applyFrames(base, frames);
}

export function createComposerRunningView(sessionId = "composer-running"): SessionView {
	const base = createComposerIdleView(sessionId);
	const frames: RpcServerFrame[] = [
		{ type: "agent_start" },
		{
			type: "queue_update",
			steering: ["先检查 byteLength 边界条件", "补充乱序分片单测"],
			followUp: ["顺便更新 DESIGN.md 的进程池一节"],
			liveSteered: 1,
		},
		{
			type: "extension_ui_request",
			id: "w-above",
			method: "setWidget",
			widgetKey: "test-watcher",
			widgetPlacement: "aboveEditor",
			widgetLines: ["watch: packages/bridge/src/process.test.ts · 4 pass · 0 fail"],
		},
		{
			type: "extension_ui_request",
			id: "st-lsp",
			method: "setStatus",
			statusKey: "lsp",
			statusText: "lsp: ts ready",
		},
	];
	const next = applyFrames(base, frames);
	return {
		...next,
		state: baseState(sessionId, { isStreaming: true, isSettled: false }),
	};
}

export function createComposerUsageLimitView(sessionId = "composer-model-menu"): SessionView {
	const base = createComposerIdleView(sessionId);
	return {
		...base,
		state: baseState(sessionId, {
			thinkingLevel: "inherit",
			fastModeEnabled: true,
			fastModeActive: true,
			slowModeSupported: true,
			slowModeEnabled: false,
			slowModeScope: "session",
			usageLimit: {
				stage: "low_priority",
				allowanceLeftPercent: 28,
				resetsAtSec: Math.floor(Date.now() / 1000) + 3600,
			},
		}),
	};
}

/** Live session started with `--approval-mode yolo`: the permission chip is orange-ink. */
export function createComposerYoloView(sessionId = "composer-yolo"): SessionView {
	return { ...createComposerIdleView(sessionId), approvalMode: "yolo" };
}

/** Permission switch in flight (stop + start(resume)): chip spinner, input disabled until `ready`. */
export function createComposerRestartingView(sessionId = "composer-restarting"): SessionView {
	return { ...createComposerIdleView(sessionId), proc: "starting", approvalMode: "write" };
}

export const SELECT_UI_REQUEST_FIXTURE: SelectUiRequest = {
	type: "extension_ui_request",
	id: "ui-select-1",
	method: "select",
	title: "选择测试运行范围",
	options: ["仅当前包 (@omp-ui/web)", "全量工作区 (bridge + protocol + web)", "仅变更关联文件"],
	optionDetails: [
		{ description: "最快，约 0.8s 完成组件与纯逻辑单测" },
		{ description: "运行所有包测试与类型检查，约 3.2s" },
		{ description: "按编辑记录筛选对应的 *.test.ts" },
	],
	timeout: 60_000,
};

export const CONFIRM_UI_REQUEST_FIXTURE: ConfirmUiRequest = {
	type: "extension_ui_request",
	id: "ui-confirm-1",
	method: "confirm",
	title: "切换审批模式并重启会话进程？",
	message: "--approval-mode 是启动参数。确认后将停止当前子进程并以 --resume 重新启动，已保存的对话记录不会丢失。",
	timeout: 45_000,
};

export const INPUT_UI_REQUEST_FIXTURE: InputUiRequest = {
	type: "extension_ui_request",
	id: "ui-input-1",
	method: "input",
	title: "输入压缩上下文指令",
	placeholder: "例如：保留所有 RPC 帧协议字段与错误码约定…",
	timeout: 30_000,
};

export const EDITOR_UI_REQUEST_FIXTURE: EditorUiRequest = {
	type: "extension_ui_request",
	id: "ui-editor-1",
	method: "editor",
	title: "编辑交接摘要 (Handoff Prompt)",
	prefill: [
		"# 已完成工作",
		"- 完成 Bridge OmpProcess 帧解析与 v2 分片重组",
		"- 完成 Composer 与 Extension UI 模态层实现",
		"",
		"# 下一步任务",
		"- 联调右侧面板与会话树分叉操作",
	].join("\n"),
	promptStyle: false,
};

export function createUiRequestView(
	request: SelectUiRequest | ConfirmUiRequest | InputUiRequest | EditorUiRequest,
	sessionId = `ui-req-${request.method}`,
): SessionView {
	const base = createComposerIdleView(sessionId);
	return applyFrames(base, [request]);
}
