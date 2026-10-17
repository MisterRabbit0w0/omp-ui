import { describe, expect, test } from "bun:test";
import type {
	AskUiRequest,
	AvailableSlashCommand,
	ConfirmUiRequest,
	EditorUiRequest,
	ExtensionUiRequest,
	InputUiRequest,
	OpenUrlUiRequest,
	SelectUiRequest,
} from "@omp-ui/protocol";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
	COMPOSER_FILE_HITS,
	COMPOSER_MODELS,
	COMPOSER_SAMPLE_ATTACHMENTS,
	COMPOSER_SLASH_COMMANDS,
	CONFIRM_UI_REQUEST_FIXTURE,
	EDITOR_UI_REQUEST_FIXTURE,
	INPUT_UI_REQUEST_FIXTURE,
	SELECT_UI_REQUEST_FIXTURE,
	createComposerIdleView,
	createComposerRunningView,
	createComposerRestartingView,
	createComposerUsageLimitView,
	createComposerYoloView,
	createUiRequestView,
} from "@/fixtures/composer";
import ComposerGallerySection from "@/gallery/sections/Composer";
import { Composer } from "./Composer";
import { ModelMenuPanel, thinkingSegments } from "./ModelSelector";
import { PermissionMenuPanel } from "./PermissionChip";
import { FileMentionMenu, SlashMenu } from "./SlashMenu";
import { UiRequestLayer } from "./UiRequestLayer";
import {
	applyFileMention,
	applySlashInsertion,
	buildCancelResponse,
	buildQueueChipItems,
	buildTimeoutResponse,
	canModelAcceptImages,
	collectUserPromptHistory,
	computeDownscaledDimensions,
	detectMenuTrigger,
	filterModels,
	filterSlashCommands,
	formatContextWindow,
	formatThinkingButtonLabel,
	formatUsageLimitWarning,
	getSendButtonState,
	groupModelsByProvider,
	groupSlashCommands,
	imageContentToAttachment,
	isModalUiRequest,
	isOAuthCodeInputRequest,
	loadSessionDraft,
	mergeAbortAndRestoreQueue,
	mergeRemovedQueueImages,
	resolveSendAction,
	saveSessionDraft,
	validateOAuthCodeInput,
	selectActiveModalUiRequest,
	selectModalUiRequests,
} from "./logic";

describe("composer › send-mode routing table & button state machine", () => {
	test("idle composer button state and routing", () => {
		expect(
			getSendButtonState({
				text: "   ",
				imagesCount: 0,
				runKind: "idle",
			}),
		).toBe("disabled");

		expect(
			resolveSendAction({
				text: "   ",
				imagesCount: 0,
				runKind: "idle",
				trigger: "enter",
			}),
		).toEqual({ kind: "noop" });

		expect(
			getSendButtonState({
				text: "解释一下架构",
				imagesCount: 0,
				runKind: "idle",
			}),
		).toBe("send");

		expect(
			resolveSendAction({
				text: "解释一下架构",
				imagesCount: 0,
				runKind: "idle",
				trigger: "enter",
			}),
		).toEqual({ kind: "prompt", mode: "auto" });

		// Image-only prompt in idle state
		expect(
			getSendButtonState({
				text: "",
				imagesCount: 2,
				runKind: "idle",
			}),
		).toBe("send");

		expect(
			resolveSendAction({
				text: "",
				imagesCount: 2,
				runKind: "idle",
				trigger: "button",
			}),
		).toEqual({ kind: "prompt", mode: "auto" });
	});

	test("running composer without text routes button to abort", () => {
		for (const runKind of ["running", "settling", "compacting", "retrying"] as const) {
			expect(
				getSendButtonState({
					text: "",
					imagesCount: 0,
					runKind,
				}),
			).toBe("stop");

			expect(
				resolveSendAction({
					text: "",
					imagesCount: 0,
					runKind,
					trigger: "button",
				}),
			).toEqual({ kind: "abort" });

			expect(
				resolveSendAction({
					text: "",
					imagesCount: 0,
					runKind,
					trigger: "enter",
				}),
			).toEqual({ kind: "noop" });
		}
	});

	test("running composer with text routes Enter->steer, Alt+Enter->followUp, Ctrl+Enter->interrupt", () => {
		expect(
			getSendButtonState({
				text: "补充一条约束",
				imagesCount: 0,
				runKind: "running",
			}),
		).toBe("send_while_running");

		expect(
			resolveSendAction({
				text: "补充一条约束",
				imagesCount: 0,
				runKind: "running",
				trigger: "enter",
			}),
		).toEqual({ kind: "prompt", mode: "steer" });

		expect(
			resolveSendAction({
				text: "补充一条约束",
				imagesCount: 0,
				runKind: "running",
				trigger: "alt_enter",
			}),
		).toEqual({ kind: "prompt", mode: "followUp" });

		expect(
			resolveSendAction({
				text: "补充一条约束",
				imagesCount: 0,
				runKind: "running",
				trigger: "ctrl_enter",
			}),
		).toEqual({ kind: "prompt", mode: "interrupt" });

		// Button click respects selectedRunMode dropdown
		expect(
			resolveSendAction({
				text: "补充一条约束",
				imagesCount: 0,
				runKind: "running",
				trigger: "button",
				selectedRunMode: "followUp",
			}),
		).toEqual({ kind: "prompt", mode: "followUp" });

		expect(
			resolveSendAction({
				text: "补充一条约束",
				imagesCount: 0,
				runKind: "running",
				trigger: "mode_interrupt",
			}),
		).toEqual({ kind: "prompt", mode: "interrupt" });
	});

	test("shell mode (!prefix) and bashRunning routing", () => {
		expect(
			resolveSendAction({
				text: "!bun test packages/web",
				imagesCount: 0,
				runKind: "idle",
				trigger: "enter",
			}),
		).toEqual({ kind: "bash", command: "bun test packages/web" });

		expect(
			resolveSendAction({
				text: "!   ",
				imagesCount: 0,
				runKind: "idle",
				trigger: "enter",
			}),
		).toEqual({ kind: "noop" });

		expect(
			getSendButtonState({
				text: "!ls",
				imagesCount: 0,
				runKind: "idle",
				bashRunning: true,
			}),
		).toBe("stop_bash");

		expect(
			resolveSendAction({
				text: "!ls",
				imagesCount: 0,
				runKind: "idle",
				bashRunning: true,
				trigger: "button",
			}),
		).toEqual({ kind: "abort_bash" });
	});

	test("starting and dead states disable composer", () => {
		expect(
			getSendButtonState({
				text: "hello",
				imagesCount: 0,
				runKind: "idle",
				proc: "starting",
			}),
		).toBe("disabled");

		expect(
			resolveSendAction({
				text: "hello",
				imagesCount: 0,
				runKind: "idle",
				proc: "starting",
				trigger: "enter",
			}),
		).toEqual({ kind: "noop", reason: "正在启动会话进程…" });

		expect(
			resolveSendAction({
				text: "hello",
				imagesCount: 0,
				runKind: "dead",
				proc: "crashed",
				readonly: false,
				trigger: "enter",
			}),
		).toEqual({ kind: "noop", reason: "会话进程已退出，请先恢复或重新打开" });
	});
});

describe("composer › image downscale sizing math", () => {
	test("keeps dimensions unchanged when long edge <= 2000px", () => {
		expect(computeDownscaledDimensions(1440, 900)).toEqual({
			width: 1440,
			height: 900,
			scaled: false,
		});
		expect(computeDownscaledDimensions(2000, 1500)).toEqual({
			width: 2000,
			height: 1500,
			scaled: false,
		});
	});

	test("downscales landscape images with width > 2000px proportionally", () => {
		expect(computeDownscaledDimensions(4000, 3000)).toEqual({
			width: 2000,
			height: 1500,
			scaled: true,
		});
		expect(computeDownscaledDimensions(3840, 2160)).toEqual({
			width: 2000,
			height: 1125,
			scaled: true,
		});
	});

	test("downscales portrait images with height > 2000px proportionally", () => {
		expect(computeDownscaledDimensions(1500, 3000)).toEqual({
			width: 1000,
			height: 2000,
			scaled: true,
		});
	});

	test("clamps extreme aspect ratios to at least 1px", () => {
		const res = computeDownscaledDimensions(10_000, 2);
		expect(res.width).toBe(2000);
		expect(res.height).toBeGreaterThanOrEqual(1);
		expect(res.scaled).toBe(true);
	});

	test("detects whether current model accepts image input", () => {
		expect(canModelAcceptImages(COMPOSER_MODELS[0])).toBe(true);
		expect(canModelAcceptImages(COMPOSER_MODELS[3])).toBe(false);
		expect(canModelAcceptImages(null)).toBe(true);
	});
});

describe("composer › slash (/) and @ file trigger detection & insertion", () => {
	test("detects slash command at start of text or line", () => {
		expect(detectMenuTrigger("/com", 4)).toEqual({
			kind: "slash",
			query: "com",
			start: 0,
			end: 4,
		});

		expect(detectMenuTrigger("第一行\n/sec", 8)).toEqual({
			kind: "slash",
			query: "sec",
			start: 4,
			end: 8,
		});

		// Subcommand query
		expect(detectMenuTrigger("/security sc", 12)).toEqual({
			kind: "slash",
			query: "security sc",
			commandName: "security",
			subcommandQuery: "sc",
			start: 0,
			end: 12,
		});

		// Slash in middle of sentence is not a slash command trigger
		expect(detectMenuTrigger("查看 a/b/c 路径", 8)).toBeNull();
		// Shell mode disables slash/@ triggers
		expect(detectMenuTrigger("!/bin/sh", 8)).toBeNull();
	});

	test("detects @ file mention at start or after whitespace", () => {
		expect(detectMenuTrigger("@proc", 5)).toEqual({
			kind: "at",
			query: "proc",
			start: 0,
			end: 5,
		});

		expect(detectMenuTrigger("请先阅读 @packages/bridge/src/pr 并修改", 28)).toEqual({
			kind: "at",
			query: "packages/bridge/src/pr",
			start: 5,
			end: 28,
		});

		// Email address should not trigger @ file mention
		expect(detectMenuTrigger("联系 user@example.com", 19)).toBeNull();
	});

	test("inserts slash command and @ file mention at trigger range", () => {
		const slashTrigger = detectMenuTrigger("/com", 4);
		expect(slashTrigger?.kind).toBe("slash");
		if (slashTrigger?.kind === "slash") {
			expect(applySlashInsertion("/com", slashTrigger, "compact")).toEqual({
				text: "/compact ",
				cursor: 9,
			});
		}
		const subTrigger = detectMenuTrigger("/security sc", 12);
		expect(subTrigger?.kind).toBe("slash");
		if (subTrigger?.kind === "slash") {
			expect(applySlashInsertion("/security sc", subTrigger, "security", "scan")).toEqual({
				text: "/security scan ",
				cursor: 15,
			});
		}

		const atText = "请检查 @proc 的实现";
		const atTrigger = detectMenuTrigger(atText, 9);
		expect(atTrigger?.kind).toBe("at");
		if (atTrigger?.kind === "at") {
			expect(applyFileMention(atText, atTrigger, "packages\\bridge\\src\\process.ts")).toEqual({
				text: "请检查 @packages/bridge/src/process.ts 的实现",
				cursor: 35,
			});
		}
	});

	test("filters and groups slash commands by source and subcommands", () => {
		const allRows = filterSlashCommands(COMPOSER_SLASH_COMMANDS, {
			kind: "slash",
			query: "",
			start: 0,
			end: 1,
		});
		expect(allRows.length).toBe(COMPOSER_SLASH_COMMANDS.length);

		const groups = groupSlashCommands(allRows);
		expect(groups.map(g => g.source)).toEqual(["builtin", "skill", "extension", "mcp_prompt"]);
		expect(groups[0]?.label).toBe("内置");

		// Subcommand filtering for `/security s`
		const subRows = filterSlashCommands(COMPOSER_SLASH_COMMANDS, {
			kind: "slash",
			query: "security s",
			commandName: "security",
			subcommandQuery: "s",
			start: 0,
			end: 11,
		});
		expect(subRows.length).toBe(1);
		expect(subRows[0]?.displayName).toBe("/security scan");
		expect(subRows[0]?.hint).toBe("[target]");

		// Alias matching
		const withAlias: AvailableSlashCommand[] = [
			...COMPOSER_SLASH_COMMANDS,
			{ name: "clear", aliases: ["cls"], source: "builtin", description: "清空" },
		];
		const aliasMatch = filterSlashCommands(withAlias, {
			kind: "slash",
			query: "cls",
			start: 0,
			end: 4,
		});
		expect(aliasMatch.map(r => r.command.name)).toEqual(["clear"]);
	});
});

describe("composer › queue chips & restoring images", () => {
	test("builds queue chip items with liveSteered marked 已送达 and non-removable", () => {
		const items = buildQueueChipItems({
			steering: ["已送达消息", "待处理插话"],
			followUp: ["完成后跟进消息"],
			liveSteered: 1,
		});

		expect(items).toEqual([
			{
				id: "steering-0-已送达消息",
				queue: "steering",
				text: "已送达消息",
				index: 0,
				liveSteered: true,
				badgeLabel: "已送达",
				canRemove: false,
				canPromote: false,
			},
			{
				id: "steering-1-待处理插话",
				queue: "steering",
				text: "待处理插话",
				index: 1,
				liveSteered: false,
				badgeLabel: "插话",
				canRemove: true,
				canPromote: false,
			},
			{
				id: "followUp-0-完成后跟进消息",
				queue: "followUp",
				text: "完成后跟进消息",
				index: 0,
				liveSteered: false,
				badgeLabel: "稍后",
				canRemove: true,
				canPromote: true,
			},
		]);
	});

	test("restores removed queue chip images back to attachments", () => {
		const existing = [
			imageContentToAttachment({ type: "image", mimeType: "image/png", data: "AAA=" }, "first.png"),
		];
		const updated = mergeRemovedQueueImages(existing, {
			removed: true,
			images: [{ type: "image", mimeType: "image/jpeg", data: "BBB=" }],
		});
		expect(updated.length).toBe(2);
		expect(updated[0]?.name).toBe("first.png");
		expect(updated[1]?.image).toEqual({ type: "image", mimeType: "image/jpeg", data: "BBB=" });
	});

	test("merges abort_and_restore_queue text and images back into composer", () => {
		const existing = [
			imageContentToAttachment({ type: "image", mimeType: "image/png", data: "AAA=" }, "existing.png"),
		];
		const merged = mergeAbortAndRestoreQueue("正在输入的草稿", existing, {
			steering: [
				{
					text: "插话 1",
					images: [{ type: "image", mimeType: "image/png", data: "STEER_IMG" }],
				},
			],
			followUp: [{ text: "稍后 2" }],
		});

		expect(merged.text).toBe("插话 1\n稍后 2\n正在输入的草稿");
		expect(merged.attachments.length).toBe(2);
		expect(merged.attachments[1]?.image.data).toBe("STEER_IMG");
	});
});

describe("composer › UiRequestLayer ordering, filtering & timeouts", () => {
	const approvalSelect: SelectUiRequest = {
		type: "extension_ui_request",
		id: "req-approval",
		method: "select",
		title: "Allow tool: bash\nReason: Needs shell access\n$ rm -rf dist",
		options: ["Approve", "Deny"],
	};

	const askRequest: AskUiRequest = {
		type: "extension_ui_request",
		id: "req-ask",
		method: "ask",
		questions: [
			{
				id: "q1",
				question: "如何处理超限进程？",
				options: [{ label: "LRU 回收" }],
			},
		],
	};

	const openUrlRequest: OpenUrlUiRequest = {
		type: "extension_ui_request",
		id: "req-url",
		method: "open_url",
		url: "https://example.com/auth",
	};

	test("skips approval select, ask, and open_url; preserves arrival order for modal requests", () => {
		const queue: ExtensionUiRequest[] = [
			approvalSelect,
			askRequest,
			openUrlRequest,
			SELECT_UI_REQUEST_FIXTURE,
			CONFIRM_UI_REQUEST_FIXTURE,
			INPUT_UI_REQUEST_FIXTURE,
			EDITOR_UI_REQUEST_FIXTURE,
		];

		expect(isModalUiRequest(approvalSelect)).toBe(false);
		expect(isModalUiRequest(askRequest)).toBe(false);
		expect(isModalUiRequest(openUrlRequest)).toBe(false);
		expect(isModalUiRequest(SELECT_UI_REQUEST_FIXTURE)).toBe(true);

		const modals = selectModalUiRequests(queue);
		expect(modals.map(m => m.id)).toEqual([
			SELECT_UI_REQUEST_FIXTURE.id,
			CONFIRM_UI_REQUEST_FIXTURE.id,
			INPUT_UI_REQUEST_FIXTURE.id,
			EDITOR_UI_REQUEST_FIXTURE.id,
		]);

		// First active modal is select; once resolved, confirm becomes active
		expect(selectActiveModalUiRequest(queue)?.id).toBe(SELECT_UI_REQUEST_FIXTURE.id);
		const afterFirstResolved = queue.filter(r => r.id !== SELECT_UI_REQUEST_FIXTURE.id);
		expect(selectActiveModalUiRequest(afterFirstResolved)?.id).toBe(CONFIRM_UI_REQUEST_FIXTURE.id);
	});

	test("constructs timeout and cancel responses according to protocol", () => {
		expect(buildTimeoutResponse("ui-select-1")).toEqual({
			type: "extension_ui_response",
			id: "ui-select-1",
			cancelled: true,
			timedOut: true,
		});

		expect(buildCancelResponse("ui-select-1")).toEqual({
			type: "extension_ui_response",
			id: "ui-select-1",
			cancelled: true,
		});
	});

	test("validates OAuth code input and suppresses input modal when SettingsDialog handles OAuth", () => {
		const oauthInput: InputUiRequest = {
			type: "extension_ui_request",
			id: "req-oauth-input",
			method: "input",
			title: "Paste the authorization code (or full redirect URL):",
			timeout: 600_000,
		};
		expect(isOAuthCodeInputRequest(oauthInput)).toBe(true);
		expect(isOAuthCodeInputRequest(INPUT_UI_REQUEST_FIXTURE)).toBe(false);

		expect(validateOAuthCodeInput("   ").valid).toBe(false);
		expect(validateOAuthCodeInput("http://localhost:1455/auth/callback?error=access_denied").valid).toBe(false);
		expect(validateOAuthCodeInput("https://auth.openai.com/oauth/authorize?client_id=x").valid).toBe(false);
		expect(validateOAuthCodeInput("http://localhost:1455/auth/callback?code=abc123&state=s1").valid).toBe(true);
		expect(validateOAuthCodeInput("raw-auth-code#state-1").valid).toBe(true);

		expect(selectActiveModalUiRequest([oauthInput], { suppressOAuthInput: true })).toBeNull();
		expect(selectActiveModalUiRequest([oauthInput], { suppressOAuthInput: false })?.id).toBe("req-oauth-input");
	});
});

describe("composer › model/thinking formatting, history, drafts & fixtures", () => {
	test("formats thinking level with auto · high when inherit/auto", () => {
		expect(formatThinkingButtonLabel("inherit", COMPOSER_MODELS[0], true)).toEqual({
			label: "自动 · 高",
			rawText: "auto · high",
		});
		expect(formatThinkingButtonLabel("high", COMPOSER_MODELS[0], false)).toEqual({
			label: "高",
			rawText: "high",
		});
	});

	test("filters and groups models by provider and formats context window & usageLimit", () => {
		expect(formatContextWindow(200_000)).toBe("200k");
		expect(formatContextWindow(1_000_000)).toBe("1M");
		expect(formatContextWindow(null)).toBeNull();

		const filtered = filterModels(COMPOSER_MODELS, "opus");
		expect(filtered.map(m => m.id)).toEqual(["claude-opus-5.5"]);

		const groups = groupModelsByProvider(COMPOSER_MODELS);
		expect(groups.map(g => g.provider)).toEqual(["anthropic", "openai", "deepseek"]);

		const warning = formatUsageLimitWarning({
			stage: "low_priority",
			allowanceLeftPercent: 28,
			resetsAtSec: 1_760_000_000,
		});
		expect(warning).toContain("低优先级通道（剩余 28%）");
	});

	test("collects user prompt history and persists per-session drafts", () => {
		const idleView = createComposerIdleView();
		const history = collectUserPromptHistory(idleView.messages);
		expect(history).toEqual(["先看一下 omp 的 RPC 协议，然后把 Bridge 的帧解析写出来，支持 v2 分片。"]);

		const runningView = createComposerRunningView();
		expect(runningView.run.kind).toBe("running");
		expect(runningView.queue.liveSteered).toBe(1);
		expect(runningView.widgets.get("test-watcher")?.placement).toBe("aboveEditor");
		expect(runningView.statusChips.get("lsp")).toBe("lsp: ts ready");

		// Mock storage for draft persistence
		const store: Record<string, string> = {};
		const mockStorage = {
			getItem: (k: string) => store[k] ?? null,
			setItem: (k: string, v: string) => {
				store[k] = v;
			},
			removeItem: (k: string) => {
				delete store[k];
			},
		};
		saveSessionDraft("s-1", "草稿内容", mockStorage);
		expect(loadSessionDraft("s-1", mockStorage)).toBe("草稿内容");
		saveSessionDraft("s-1", "", mockStorage);
		expect(loadSessionDraft("s-1", mockStorage)).toBe("");
	});
});

describe("composer › component & gallery rendering", () => {
	test("renders Composer in idle, running, running-with-text, shell, attachments, drag-over, and welcome states", () => {
		const idleView = createComposerIdleView();
		const runningView = createComposerRunningView();

		const idleHtml = renderToStaticMarkup(
			createElement(Composer, { sessionId: "s-idle", cwd: "/repo", viewOverride: idleView, initialText: "" }),
		);
		expect(idleHtml).toContain("给 omp 发消息，@ 引用文件，/ 运行命令");
		expect(idleHtml).toContain("opus-5.5");

		const runningHtml = renderToStaticMarkup(
			createElement(Composer, { sessionId: "s-run", cwd: "/repo", viewOverride: runningView, initialText: "" }),
		);
		expect(runningHtml).toContain("已送达");
		expect(runningHtml).toContain("顺便更新 DESIGN.md 的进程池一节");
		expect(runningHtml).toContain("lsp: ts ready");

		const runningTextHtml = renderToStaticMarkup(
			createElement(Composer, {
				sessionId: "s-run-text",
				cwd: "/repo",
				viewOverride: runningView,
				initialText: "补充一条插话",
			}),
		);
		expect(runningTextHtml).toContain("插话");
		expect(runningTextHtml).toContain("Enter 插话 · Alt+Enter 完成后发送 · Ctrl+Enter 打断");

		const shellHtml = renderToStaticMarkup(
			createElement(Composer, {
				sessionId: "s-shell",
				cwd: "/repo",
				viewOverride: idleView,
				initialText: "!bun test",
			}),
		);
		expect(shellHtml).toContain("运行 shell 命令");
		expect(shellHtml).toContain("$");

		const attachHtml = renderToStaticMarkup(
			createElement(Composer, {
				sessionId: "s-att",
				cwd: "/repo",
				viewOverride: idleView,
				initialText: "检查附图",
				initialAttachments: COMPOSER_SAMPLE_ATTACHMENTS,
			}),
		);
		expect(attachHtml).toContain("architecture-diagram.png");

		const dragHtml = renderToStaticMarkup(
			createElement(Composer, {
				sessionId: "s-drag",
				cwd: "/repo",
				viewOverride: idleView,
				initialDragOver: true,
			}),
		);
		expect(dragHtml).toContain("松开以附加图片");

		const welcomeHtml = renderToStaticMarkup(
			createElement(Composer, { sessionId: null, cwd: "/repo", initialText: "" }),
		);
		expect(welcomeHtml).toContain("给 omp 发消息，@ 引用文件，/ 运行命令");
	});

	test("renders SlashMenu, FileMentionMenu (including running @ hint), ModelMenuPanel, UiRequestLayer, and Gallery section", () => {
		const rows = filterSlashCommands(COMPOSER_SLASH_COMMANDS, {
			kind: "slash",
			query: "",
			start: 0,
			end: 1,
		});
		const slashHtml = renderToStaticMarkup(
			createElement(SlashMenu, {
				inline: true,
				rows,
				selectedIndex: 0,
				onHoverIndex: () => undefined,
				onSelect: () => undefined,
			}),
		);
		expect(slashHtml).toContain("/compact");
		expect(slashHtml).toContain("↑↓ 选择 · Enter 确认 · Esc 关闭");

		const atIdleHtml = renderToStaticMarkup(
			createElement(FileMentionMenu, {
				inline: true,
				files: COMPOSER_FILE_HITS,
				selectedIndex: 0,
				onHoverIndex: () => undefined,
				onSelect: () => undefined,
				isRunning: false,
			}),
		);
		expect(atIdleHtml).toContain("process.ts");
		expect(atIdleHtml).not.toContain("运行中发送的 @ 引用不会展开");

		const atRunningHtml = renderToStaticMarkup(
			createElement(FileMentionMenu, {
				inline: true,
				files: COMPOSER_FILE_HITS,
				selectedIndex: 0,
				onHoverIndex: () => undefined,
				onSelect: () => undefined,
				isRunning: true,
			}),
		);
		expect(atRunningHtml).toContain("运行中发送的 @ 引用不会展开");

		const usageView = createComposerUsageLimitView();
		const modelMenuHtml = renderToStaticMarkup(
			createElement(ModelMenuPanel, {
				models: COMPOSER_MODELS,
				currentModel: usageView.state?.model,
				state: usageView.state,
				onSelectModel: () => undefined,
			}),
		);
		expect(modelMenuHtml).toContain("低优先级通道");
		expect(modelMenuHtml).toContain("200k");
		expect(modelMenuHtml).toContain("快速模式 (Fast)");
		expect(modelMenuHtml).toContain("慢速通道 (Slow)");

		for (const fixture of [
			SELECT_UI_REQUEST_FIXTURE,
			CONFIRM_UI_REQUEST_FIXTURE,
			INPUT_UI_REQUEST_FIXTURE,
			EDITOR_UI_REQUEST_FIXTURE,
		]) {
			const reqView = createUiRequestView(fixture);
			const html = renderToStaticMarkup(
				createElement(UiRequestLayer, { sessionId: "s-ui", viewOverride: reqView, inline: true }),
			);
			expect(html).toContain(fixture.title);
		}

		const galleryHtml = renderToStaticMarkup(createElement(ComposerGallerySection));
		expect(galleryHtml).toContain("Composer 与交互请求");
	});
});

describe("welcome model label (M7)", () => {
	test("never invents a model: neutral prompt without a configured default", async () => {
		const { modelButtonLabel, NO_MODEL_LABEL } = await import("./logic");
		expect(modelButtonLabel(null)).toBe(NO_MODEL_LABEL);
		expect(modelButtonLabel(undefined, "  ")).toBe(NO_MODEL_LABEL);
		expect(NO_MODEL_LABEL).not.toContain("opus");
	});

	test("configured default shows its short name; a live model wins", async () => {
		const { modelButtonLabel, modelInfoFromCatalog } = await import("./logic");
		expect(modelButtonLabel(null, "anthropic/claude-sonnet-4-20250514")).toBe("sonnet-4");
		const live = modelInfoFromCatalog({ provider: "fake", id: "model", selector: "fake/model", name: "Fake", contextWindow: 1000, maxTokens: 10, reasoning: true, input: ["text"] });
		expect(modelButtonLabel(live, "anthropic/other")).toBe("model");
		expect(live.contextWindow).toBe(1000);
	});
});

describe("composer › §6.12 layout: context strip, permission chip, merged model·thinking button", () => {
	const render = (props: Parameters<typeof Composer>[0]) => renderToStaticMarkup(createElement(Composer, props));

	test("the context strip only exists on the welcome composer", () => {
		const welcome = render({ sessionId: null, cwd: null, initialText: "" });
		expect(welcome).toContain('data-testid="composer-context-strip"');
		expect(welcome).toContain("选择项目");
		const live = render({ sessionId: "s-live", cwd: "/repo", viewOverride: createComposerIdleView(), initialText: "" });
		expect(live).not.toContain("composer-context-strip");
	});

	test("welcome composer has no separate thinking button; the merged button carries model and thinking", () => {
		const html = render({ sessionId: "s-live", cwd: "/repo", viewOverride: createComposerIdleView(), initialText: "" });
		expect(html).not.toContain("思考级别：");
		expect(html).toContain("模型：opus-5.5，思考：高");
		expect(render({ sessionId: null, cwd: null, initialText: "" })).toContain("选择模型");
	});

	test("permission chip shows the session's mode; yolo is orange-ink, restarting shows a spinner and disables the chip", () => {
		const ask = render({ sessionId: "s-live", cwd: "/repo", viewOverride: createComposerIdleView(), initialText: "" });
		expect(ask).toContain("权限：仅写操作");
		const yolo = render({ sessionId: "s-yolo", cwd: "/repo", viewOverride: createComposerYoloView(), initialText: "" });
		expect(yolo).toContain("权限：完全访问");
		expect(yolo).toContain("text-orange-ink");
		const restarting = render({
			sessionId: "s-restart",
			cwd: "/repo",
			viewOverride: createComposerRestartingView(),
			initialText: "",
		});
		expect(restarting).toContain('aria-busy="true"');
		expect(restarting).toContain('role="progressbar"');
		expect(restarting).toContain("正在启动会话进程");
	});

	test("shell mode swaps the permission chip for the orange $ Shell chip", () => {
		const html = render({ sessionId: "s-live", cwd: "/repo", viewOverride: createComposerIdleView(), initialText: "!ls" });
		expect(html).toContain("$ Shell");
		expect(html).not.toContain("权限：");
	});

	test("permission menu lists three modes with the right footer per context and lock state", () => {
		const panel = (props: Partial<Parameters<typeof PermissionMenuPanel>[0]>) =>
			renderToStaticMarkup(createElement(PermissionMenuPanel, { mode: "write", context: "session", onPick: () => undefined, ...props }));
		const session = panel({});
		for (const label of ["每次询问", "仅写操作", "完全访问"]) expect(session).toContain(label);
		expect(session).toContain("所有工具直接执行，不再询问");
		expect(session).toContain("切换会重启会话进程，历史不受影响");
		expect(panel({ context: "welcome" })).toContain("作用于这次新建的会话");
		const locked = panel({ locked: true });
		expect(locked).toContain("运行结束后可切换");
		expect(locked).toContain("disabled");
	});

	test("model menu: thinking segmented row (自动 first), fast/slow rows only when supported", () => {
		const usage = createComposerUsageLimitView();
		const withThinking = renderToStaticMarkup(
			createElement(ModelMenuPanel, {
				models: COMPOSER_MODELS,
				currentModel: usage.state?.model,
				state: usage.state,
				thinkingLevels: ["off", "low", "high"],
				currentThinking: "high",
				onSelectModel: () => undefined,
				onSelectThinking: () => undefined,
			}),
		);
		expect(withThinking).toContain('role="radiogroup"');
		expect(withThinking.indexOf("自动")).toBeLessThan(withThinking.indexOf(">高<"));
		expect(withThinking).toContain('aria-checked="true"');
		expect(thinkingSegments([])[0]).toBe("inherit");
		expect(thinkingSegments(["off", "inherit", "high"])).toEqual(["inherit", "off", "high"]);

		const bare = renderToStaticMarkup(
			createElement(ModelMenuPanel, {
				models: COMPOSER_MODELS,
				state: { sessionId: "x" },
				onSelectModel: () => undefined,
			}),
		);
		expect(bare).not.toContain("快速模式");
		expect(bare).not.toContain("慢速通道");
		expect(bare).not.toContain("radiogroup");
	});
});
