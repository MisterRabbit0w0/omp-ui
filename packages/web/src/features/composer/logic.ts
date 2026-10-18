/**
 * Pure logic for Composer and UiRequestLayer:
 * - Send-mode routing table & button state machine (FRONTEND §6.12, DESIGN §9.4)
 * - Image downscale sizing math & canvas conversion (FRONTEND §6.12, DESIGN §9.4)
 * - Slash (/) & file mention (@) trigger detection, filtering, grouping & insertion (FRONTEND §6.14, DESIGN §9.4)
 * - Queue chip transformation & image/text restoration (DESIGN §9.4, §9.5)
 * - Extension UI modal request filtering, ordering & timeout helpers (DESIGN §7.1, §7.2)
 */
import {
	isApprovalRequest,
	type AbortAndRestoreQueueResult,
	type AvailableSlashCommand,
	type CancelUiResponse,
	type CatalogModel,
	type ConfirmUiRequest,
	type EditorUiRequest,
	type ExtensionUiRequest,
	type ImageContent,
	type InputUiRequest,
	type ModelInfo,
	type ProcState,
	type QueuedMessageQueue,
	type RemoveQueuedMessageResult,
	type SelectUiRequest,
	type SlashCommandSource,
	type SlashSubcommand,
	type ThinkingLevel,
	type UsageLimitState,
} from "@omp-ui/protocol";
import type { SendMode } from "@/store/app-store";
import type { RunStatus, SessionView, ViewMessage } from "@/store/session-reducer";

// ── 1. Send-mode routing & button state machine ─────────────────────

export type RunSendMode = "steer" | "followUp" | "interrupt";

export type SendTrigger =
	| "button"
	| "enter"
	| "alt_enter"
	| "ctrl_enter"
	| "mode_steer"
	| "mode_followUp"
	| "mode_interrupt";

export type SendButtonState = "disabled" | "send" | "stop" | "send_while_running" | "stop_bash";

export type SendAction =
	| { kind: "noop"; reason?: string }
	| { kind: "prompt"; mode: SendMode }
	| { kind: "bash"; command: string }
	| { kind: "abort" }
	| { kind: "abort_bash" };

export function isShellInput(text: string): boolean {
	return text.startsWith("!");
}

export function parseShellCommand(text: string): string {
	if (!isShellInput(text)) return "";
	return text.slice(1).trim();
}

export function isRunBusy(runKind: RunStatus["kind"]): boolean {
	return runKind === "running" || runKind === "settling" || runKind === "compacting" || runKind === "retrying";
}

export function isComposerDisabled(
	proc: SessionView["proc"] | ProcState,
	runKind: RunStatus["kind"],
	readonly = false,
): { disabled: boolean; reason?: string } {
	if (proc === "starting") {
		return { disabled: true, reason: "正在启动会话进程…" };
	}
	if (runKind === "dead" && !readonly) {
		return { disabled: true, reason: "会话进程已退出，请先恢复或重新打开" };
	}
	return { disabled: false };
}

export function hasComposableContent(text: string, imagesCount: number): boolean {
	if (isShellInput(text)) {
		return parseShellCommand(text).length > 0;
	}
	return text.trim().length > 0 || imagesCount > 0;
}

export interface SendStateInput {
	text: string;
	imagesCount: number;
	runKind: RunStatus["kind"];
	proc?: SessionView["proc"];
	readonly?: boolean;
	bashRunning?: boolean;
}

export function getSendButtonState(input: SendStateInput): SendButtonState {
	const { disabled } = isComposerDisabled(input.proc ?? "ready", input.runKind, input.readonly);
	if (disabled) return "disabled";
	if (input.bashRunning) return "stop_bash";

	const busy = isRunBusy(input.runKind);
	const hasContent = hasComposableContent(input.text, input.imagesCount);

	if (!busy) {
		return hasContent ? "send" : "disabled";
	}
	return hasContent ? "send_while_running" : "stop";
}

export interface ResolveSendInput extends SendStateInput {
	trigger: SendTrigger;
	selectedRunMode?: RunSendMode;
}

export function resolveSendAction(input: ResolveSendInput): SendAction {
	const { disabled, reason } = isComposerDisabled(input.proc ?? "ready", input.runKind, input.readonly);
	if (disabled) {
		return { kind: "noop", reason };
	}

	if (input.bashRunning) {
		if (input.trigger === "button") {
			return { kind: "abort_bash" };
		}
		return { kind: "noop" };
	}

	const busy = isRunBusy(input.runKind);
	const shell = isShellInput(input.text);

	if (shell) {
		const command = parseShellCommand(input.text);
		if (!command) {
			if (busy && input.trigger === "button") {
				return { kind: "abort" };
			}
			return { kind: "noop" };
		}
		if (
			input.trigger === "button" ||
			input.trigger === "enter" ||
			input.trigger === "ctrl_enter" ||
			input.trigger === "alt_enter"
		) {
			return { kind: "bash", command };
		}
		return { kind: "noop" };
	}

	const hasContent = hasComposableContent(input.text, input.imagesCount);

	if (!busy) {
		if (!hasContent) return { kind: "noop" };
		if (
			input.trigger === "button" ||
			input.trigger === "enter" ||
			input.trigger === "ctrl_enter" ||
			input.trigger === "alt_enter"
		) {
			return { kind: "prompt", mode: "auto" };
		}
		return { kind: "noop" };
	}

	// busy === true
	if (!hasContent) {
		if (input.trigger === "button") {
			return { kind: "abort" };
		}
		return { kind: "noop" };
	}

	switch (input.trigger) {
		case "enter":
		case "mode_steer":
			return { kind: "prompt", mode: "steer" };
		case "alt_enter":
		case "mode_followUp":
			return { kind: "prompt", mode: "followUp" };
		case "ctrl_enter":
		case "mode_interrupt":
			return { kind: "prompt", mode: "interrupt" };
		case "button":
			return { kind: "prompt", mode: input.selectedRunMode ?? "steer" };
	}
}

// ── 2. Image attachments & downscale sizing math ────────────────────

export const MAX_IMAGE_LONG_EDGE = 2000;

export interface DownscaledDimensions {
	width: number;
	height: number;
	scaled: boolean;
}

/**
 * Pure sizing math for image attachments (DESIGN §9.4, FRONTEND §6.12):
 * shrinks the long edge to <= maxLongEdge while preserving aspect ratio.
 */
export function computeDownscaledDimensions(
	width: number,
	height: number,
	maxLongEdge: number = MAX_IMAGE_LONG_EDGE,
): DownscaledDimensions {
	const safeW = Math.max(1, Math.round(width));
	const safeH = Math.max(1, Math.round(height));
	const longEdge = Math.max(safeW, safeH);
	if (longEdge <= maxLongEdge) {
		return { width: safeW, height: safeH, scaled: false };
	}
	const ratio = maxLongEdge / longEdge;
	return {
		width: Math.max(1, Math.round(safeW * ratio)),
		height: Math.max(1, Math.round(safeH * ratio)),
		scaled: true,
	};
}

export function canModelAcceptImages(model?: ModelInfo | null): boolean {
	if (!model) return true;
	return Array.isArray(model.input) && model.input.includes("image");
}

export interface AttachmentItem {
	id: string;
	name: string;
	image: ImageContent;
	dataUrl: string;
	width?: number;
	height?: number;
}

let attachmentSeq = 0;

export function imageContentToAttachment(image: ImageContent, name?: string): AttachmentItem {
	attachmentSeq += 1;
	const mimeType = image.mimeType || "image/png";
	const ext = mimeType.split("/")[1] || "png";
	const dataUrl = image.url ?? `data:${mimeType};base64,${image.data}`;
	return {
		id: `att-${Date.now()}-${attachmentSeq}`,
		name: name ?? `image-${attachmentSeq}.${ext}`,
		image: { type: "image", data: image.data, mimeType },
		dataUrl,
	};
}

/**
 * Downscale a browser File/Blob image via HTMLCanvasElement so its long edge
 * is <= 2000px and encode as base64 ImageContent.
 */
export async function downscaleImageFile(file: File, maxLongEdge = MAX_IMAGE_LONG_EDGE): Promise<AttachmentItem> {
	const rawDataUrl = await readBlobAsDataUrl(file);
	const img = await loadHtmlImage(rawDataUrl);
	const { width, height, scaled } = computeDownscaledDimensions(
		img.naturalWidth || img.width || 1,
		img.naturalHeight || img.height || 1,
		maxLongEdge,
	);

	const outputMime =
		file.type === "image/jpeg" || file.type === "image/webp" || file.type === "image/png" ? file.type : "image/png";

	if (!scaled && file.type === outputMime) {
		const commaIdx = rawDataUrl.indexOf(",");
		const base64 = commaIdx >= 0 ? rawDataUrl.slice(commaIdx + 1) : rawDataUrl;
		attachmentSeq += 1;
		return {
			id: `att-${Date.now()}-${attachmentSeq}`,
			name: file.name || `image-${attachmentSeq}.png`,
			image: { type: "image", data: base64, mimeType: outputMime },
			dataUrl: rawDataUrl,
			width,
			height,
		};
	}

	const canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext("2d");
	if (!ctx) {
		throw new Error("无法创建 2D 画布上下文");
	}
	ctx.drawImage(img, 0, 0, width, height);
	const finalMime = outputMime === "image/jpeg" || outputMime === "image/webp" ? outputMime : "image/png";
	const dataUrl = canvas.toDataURL(finalMime, 0.92);
	const commaIdx = dataUrl.indexOf(",");
	const base64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;
	attachmentSeq += 1;
	return {
		id: `att-${Date.now()}-${attachmentSeq}`,
		name: file.name || `image-${attachmentSeq}.png`,
		image: { type: "image", data: base64, mimeType: finalMime },
		dataUrl,
		width,
		height,
	};
}

function readBlobAsDataUrl(blob: Blob): Promise<string> {
	const { promise, resolve, reject } = Promise.withResolvers<string>();
	const reader = new FileReader();
	reader.onload = () => resolve(String(reader.result ?? ""));
	reader.onerror = () => reject(reader.error ?? new Error("读取图片失败"));
	reader.readAsDataURL(blob);
	return promise;
}

function loadHtmlImage(src: string): Promise<HTMLImageElement> {
	const { promise, resolve, reject } = Promise.withResolvers<HTMLImageElement>();
	const img = new Image();
	img.onload = () => resolve(img);
	img.onerror = () => reject(new Error("解码图片失败"));
	img.src = src;
	return promise;
}

// ── 3. Slash (/) & File mention (@) trigger detection & insertion ───

export type MenuTriggerMatch =
	| {
			kind: "slash";
			/** Full query after `/`, e.g. `"com"` or `"security scan"` */
			query: string;
			/** Set when the user typed `/cmd <subquery>` */
			commandName?: string;
			subcommandQuery?: string;
			/** Index of the leading `/` */
			start: number;
			/** Current cursor index */
			end: number;
	  }
	| {
			kind: "at";
			/** Query after `@`, e.g. `"proc"` */
			query: string;
			/** Index of the `@` character */
			start: number;
			/** Current cursor index */
			end: number;
	  };

/**
 * Detect whether the cursor is currently inside a `/` command trigger (at line
 * start) or an `@` file mention trigger (at start of line or after whitespace).
 */
export function detectMenuTrigger(text: string, cursor: number): MenuTriggerMatch | null {
	if (isShellInput(text)) return null;
	const clampedCursor = Math.max(0, Math.min(cursor, text.length));
	const lineStart = text.lastIndexOf("\n", clampedCursor - 1) + 1;
	const linePrefix = text.slice(lineStart, clampedCursor);

	// 1. Check `@` mention closest to the cursor first if there is whitespace before `@`
	const atMatch = /(?:^|\s)@([^\s@]*)$/.exec(linePrefix);
	if (atMatch) {
		const query = atMatch[1] ?? "";
		const start = clampedCursor - query.length - 1;
		return {
			kind: "at",
			query,
			start,
			end: clampedCursor,
		};
	}

	// 2. Check `/` at line start
	const slashTokenMatch = /^\/([^\s/]*)$/.exec(linePrefix);
	if (slashTokenMatch) {
		const query = slashTokenMatch[1] ?? "";
		return {
			kind: "slash",
			query,
			start: lineStart,
			end: clampedCursor,
		};
	}

	// Subcommand form at line start: `/cmd sub`
	const slashSubMatch = /^\/([^\s/]+)\s+([^\s]*)$/.exec(linePrefix);
	if (slashSubMatch) {
		const commandName = slashSubMatch[1] ?? "";
		const subcommandQuery = slashSubMatch[2] ?? "";
		return {
			kind: "slash",
			query: `${commandName} ${subcommandQuery}`,
			commandName,
			subcommandQuery,
			start: lineStart,
			end: clampedCursor,
		};
	}

	return null;
}

export interface InsertionResult {
	text: string;
	cursor: number;
}

/**
 * Insert a slash command (and optional subcommand) at the trigger range.
 */
export function applySlashInsertion(
	text: string,
	trigger: Extract<MenuTriggerMatch, { kind: "slash" }>,
	commandName: string,
	subcommandName?: string,
	appendSpace = true,
): InsertionResult {
	const core = subcommandName ? `/${commandName} ${subcommandName}` : `/${commandName}`;
	const after = text.slice(trigger.end);
	const needsSpace = appendSpace && !after.startsWith(" ");
	const replacement = needsSpace ? `${core} ` : core;
	const nextText = text.slice(0, trigger.start) + replacement + after;
	return {
		text: nextText,
		cursor: trigger.start + replacement.length,
	};
}

/**
 * Insert an `@path` file mention at the trigger range.
 */
export function applyFileMention(
	text: string,
	trigger: Extract<MenuTriggerMatch, { kind: "at" }>,
	filePath: string,
): InsertionResult {
	const normalized = filePath.replace(/\\/g, "/");
	const after = text.slice(trigger.end);
	const needsSpace = !after.startsWith(" ");
	const replacement = needsSpace ? `@${normalized} ` : `@${normalized}`;
	const nextText = text.slice(0, trigger.start) + replacement + after;
	return {
		text: nextText,
		cursor: trigger.start + replacement.length,
	};
}

export const SLASH_SOURCE_LABELS: Record<SlashCommandSource, string> = {
	builtin: "内置",
	skill: "技能",
	extension: "扩展",
	mcp_prompt: "MCP",
	custom: "自定义",
	file: "文件",
};

const SOURCE_ORDER: SlashCommandSource[] = ["builtin", "skill", "extension", "mcp_prompt", "custom", "file"];

export interface SlashMenuRow {
	id: string;
	command: AvailableSlashCommand;
	subcommand?: SlashSubcommand;
	displayName: string;
	description?: string;
	hint?: string;
	sourceLabel: string;
	source: SlashCommandSource;
}

export interface SlashCommandGroup {
	source: SlashCommandSource;
	label: string;
	items: SlashMenuRow[];
}

export function filterSlashCommands(
	commands: readonly AvailableSlashCommand[],
	trigger: Extract<MenuTriggerMatch, { kind: "slash" }>,
): SlashMenuRow[] {
	if (trigger.commandName !== undefined) {
		const cmdLower = trigger.commandName.toLowerCase();
		const subLower = (trigger.subcommandQuery ?? "").toLowerCase();
		const parent = commands.find(
			c => c.name.toLowerCase() === cmdLower || c.aliases?.some(a => a.toLowerCase() === cmdLower),
		);
		if (!parent) return [];
		const subs = parent.subcommands ?? [];
		if (subs.length === 0) {
			return [
				{
					id: `cmd:${parent.name}`,
					command: parent,
					displayName: `/${parent.name}`,
					description: parent.description,
					hint: parent.input?.hint,
					sourceLabel: SLASH_SOURCE_LABELS[parent.source] ?? parent.source,
					source: parent.source,
				},
			];
		}
		return subs
			.filter(s => !subLower || s.name.toLowerCase().includes(subLower) || (s.description ?? "").toLowerCase().includes(subLower))
			.map(sub => ({
				id: `sub:${parent.name}:${sub.name}`,
				command: parent,
				subcommand: sub,
				displayName: `/${parent.name} ${sub.name}`,
				description: sub.description ?? parent.description,
				hint: sub.usage,
				sourceLabel: SLASH_SOURCE_LABELS[parent.source] ?? parent.source,
				source: parent.source,
			}));
	}

	const q = trigger.query.trim().toLowerCase();
	const matched = commands.filter(cmd => {
		if (!q) return true;
		if (cmd.name.toLowerCase().includes(q)) return true;
		if (cmd.aliases?.some(a => a.toLowerCase().includes(q))) return true;
		if (cmd.description?.toLowerCase().includes(q)) return true;
		return false;
	});

	// Sort prefix matches on name first
	matched.sort((a, b) => {
		const aStarts = a.name.toLowerCase().startsWith(q) ? 0 : 1;
		const bStarts = b.name.toLowerCase().startsWith(q) ? 0 : 1;
		if (aStarts !== bStarts) return aStarts - bStarts;
		return a.name.localeCompare(b.name);
	});

	return matched.map(cmd => ({
		id: `cmd:${cmd.name}`,
		command: cmd,
		displayName: `/${cmd.name}`,
		description: cmd.description,
		hint: cmd.input?.hint,
		sourceLabel: SLASH_SOURCE_LABELS[cmd.source] ?? cmd.source,
		source: cmd.source,
	}));
}

export function groupSlashCommands(rows: readonly SlashMenuRow[]): SlashCommandGroup[] {
	const bySource: Partial<Record<SlashCommandSource, SlashMenuRow[]>> = {};
	for (const row of rows) {
		const list = bySource[row.source] ?? [];
		list.push(row);
		bySource[row.source] = list;
	}
	const groups: SlashCommandGroup[] = [];
	for (const source of SOURCE_ORDER) {
		const items = bySource[source];
		if (items && items.length > 0) {
			groups.push({
				source,
				label: SLASH_SOURCE_LABELS[source] ?? source,
				items,
			});
		}
	}
	return groups;
}

// ── 4. Queue chips & image restoration ──────────────────────────────

export interface QueueChipItem {
	id: string;
	queue: QueuedMessageQueue;
	text: string;
	index: number;
	liveSteered: boolean;
	badgeLabel: "已送达" | "插话" | "稍后";
	canRemove: boolean;
	canPromote: boolean;
}

export function buildQueueChipItems(queue: SessionView["queue"]): QueueChipItem[] {
	const items: QueueChipItem[] = [];
	const liveCount = Math.max(0, queue.liveSteered);

	for (let i = 0; i < queue.steering.length; i++) {
		const text = queue.steering[i]!;
		const liveSteered = i < liveCount;
		items.push({
			id: `steering-${i}-${text}`,
			queue: "steering",
			text,
			index: i,
			liveSteered,
			badgeLabel: liveSteered ? "已送达" : "插话",
			canRemove: !liveSteered,
			canPromote: false,
		});
	}

	for (let j = 0; j < queue.followUp.length; j++) {
		const text = queue.followUp[j]!;
		items.push({
			id: `followUp-${j}-${text}`,
			queue: "followUp",
			text,
			index: j,
			liveSteered: false,
			badgeLabel: "稍后",
			canRemove: true,
			canPromote: true,
		});
	}

	return items;
}

/**
 * Restore images from a removed queued message back into composer attachments
 * (DESIGN §9.5).
 */
export function mergeRemovedQueueImages(
	currentAttachments: readonly AttachmentItem[],
	result: RemoveQueuedMessageResult,
): AttachmentItem[] {
	if (!result.removed || !result.images || result.images.length === 0) {
		return [...currentAttachments];
	}
	const restored = result.images.map((img, idx) => imageContentToAttachment(img, `restored-${idx + 1}.png`));
	return [...currentAttachments, ...restored];
}

/**
 * Merge withdrawn messages and images from `abort_and_restore_queue` back into
 * the composer's current text and attachments (DESIGN §9.4).
 */
export function mergeAbortAndRestoreQueue(
	currentText: string,
	currentAttachments: readonly AttachmentItem[],
	result: AbortAndRestoreQueueResult,
): { text: string; attachments: AttachmentItem[] } {
	const withdrawn = [...result.steering, ...result.followUp];
	const texts = withdrawn.map(m => m.text).filter(t => t.length > 0);
	if (currentText.trim().length > 0) {
		texts.push(currentText);
	}
	const restoredImages: AttachmentItem[] = [];
	for (const entry of withdrawn) {
		if (entry.images) {
			for (const img of entry.images) {
				restoredImages.push(imageContentToAttachment(img));
			}
		}
	}
	return {
		text: texts.join("\n"),
		attachments: [...currentAttachments, ...restoredImages],
	};
}

// ── 5. Extension UI modal request ordering & timeouts ───────────────

export type ModalUiRequest = SelectUiRequest | ConfirmUiRequest | InputUiRequest | EditorUiRequest;

/**
 * Returns true for modal extension UI requests handled by `UiRequestLayer`
 * (DESIGN §7.1): non-approval `select`, `confirm`, `input`, `editor`.
 * Approval `select`, `ask`, and `open_url` are rendered inline in the transcript.
 */
export function isModalUiRequest(req: ExtensionUiRequest): req is ModalUiRequest {
	switch (req.method) {
		case "select":
			return !isApprovalRequest(req);
		case "confirm":
		case "input":
		case "editor":
			return true;
		default:
			return false;
	}
}

export function selectModalUiRequests(pendingUi: readonly ExtensionUiRequest[]): ModalUiRequest[] {
	return pendingUi.filter(isModalUiRequest);
}

export function isOAuthCodeInputRequest(req: ExtensionUiRequest): boolean {
	return (
		req.method === "input" &&
		(req.title.includes("authorization code") || req.title.includes("redirect URL"))
	);
}

/**
 * Validate manual OAuth callback input (mirroring omp's `parseCallbackInput`) so
 * submitting an empty string or a URL without `?code=` never triggers omp's
 * `while (true)` re-prompt loop.
 */
export function validateOAuthCodeInput(input: string): { valid: boolean; error?: string } {
	const value = input.trim();
	if (!value) {
		return { valid: false, error: "请输入授权码或完整的回调 URL" };
	}
	try {
		const url = new URL(value);
		const code = url.searchParams.get("code")?.trim();
		if (!code) {
			const err = url.searchParams.get("error_description") || url.searchParams.get("error");
			return {
				valid: false,
				error: err
					? `回调 URL 包含错误 (${err})，请取消重试或粘贴包含 code= 的回调地址`
					: "该 URL 中未包含 code 参数，请粘贴浏览器跳转后的完整回调地址或授权码",
			};
		}
		return { valid: true };
	} catch {
		// Not a full URL; check query string or raw code below
	}
	if (value.includes("code=")) {
		const params = new URLSearchParams(value.replace(/^[?#]/, ""));
		const code = params.get("code")?.trim();
		if (!code) {
			return { valid: false, error: "未检测到有效的 code 参数" };
		}
		return { valid: true };
	}
	const [code] = value.split("#", 2);
	if (!code || !code.trim()) {
		return { valid: false, error: "请输入有效的授权码" };
	}
	return { valid: true };
}

export function selectActiveModalUiRequest(
	pendingUi: readonly ExtensionUiRequest[],
	options?: { suppressOAuthInput?: boolean },
): ModalUiRequest | null {
	for (const req of pendingUi) {
		if (!isModalUiRequest(req)) continue;
		if (options?.suppressOAuthInput && req.method === "input") continue;
		return req;
	}
	return null;
}

export function buildTimeoutResponse(requestId: string): CancelUiResponse {
	return {
		type: "extension_ui_response",
		id: requestId,
		cancelled: true,
		timedOut: true,
	};
}

export function buildCancelResponse(requestId: string): CancelUiResponse {
	return {
		type: "extension_ui_response",
		id: requestId,
		cancelled: true,
	};
}

// ── 6. Model, thinking, history & draft helpers ─────────────────────

export const THINKING_LABELS: Record<ThinkingLevel, string> = {
	inherit: "自动",
	off: "关",
	minimal: "极低",
	low: "低",
	medium: "中",
	high: "高",
	xhigh: "超高",
	max: "最大",
};

/**
 * Format thinking button label (FRONTEND §6.12 & task spec):
 * shows `auto · high` / `自动 · 高` when auto/inherit is active, or the level label.
 */
export function formatThinkingButtonLabel(
	level: ThinkingLevel | undefined,
	model?: ModelInfo | null,
	isAuto?: boolean,
): { label: string; rawText: string } {
	const effective = level ?? model?.thinking?.defaultLevel ?? "high";
	if (isAuto || effective === "inherit") {
		const resolved = effective === "inherit" ? (model?.thinking?.defaultLevel ?? "high") : effective;
		const zh = THINKING_LABELS[resolved] ?? resolved;
		return {
			label: `自动 · ${zh}`,
			rawText: `auto · ${resolved}`,
		};
	}
	return {
		label: THINKING_LABELS[effective] ?? effective,
		rawText: effective,
	};
}

export const NO_MODEL_LABEL = "选择模型";

/** Catalog entry (omp models --json) -> the ModelInfo shape the menu renders; transport fields are unknown here. */
export function modelInfoFromCatalog(c: CatalogModel): ModelInfo {
	return {
		id: c.id,
		name: c.name,
		api: "",
		provider: c.provider,
		baseUrl: "",
		reasoning: c.reasoning,
		input: c.input,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: c.contextWindow,
		maxTokens: c.maxTokens,
	};
}

/** Label for the model button: live model, else the configured default (`provider/id`), else a neutral prompt. */
export function modelButtonLabel(model: ModelInfo | null | undefined, defaultModel?: string): string {
	if (model) return shortModelName(model);
	const configured = defaultModel?.trim();
	if (configured) return shortModelName({ id: configured.includes("/") ? configured.slice(configured.indexOf("/") + 1) : configured } as ModelInfo);
	return NO_MODEL_LABEL;
}

export function shortModelName(model?: ModelInfo | null, fallback = NO_MODEL_LABEL): string {
	if (!model) return fallback;
	const raw = model.id || model.name;
	if (!raw) return fallback;
	return raw
		.replace(/^claude-/, "")
		.replace(/-\d{8}$/, "");
}

export function formatContextWindow(tokens: number | null | undefined): string | null {
	if (!tokens || tokens <= 0) return null;
	if (tokens >= 1_000_000) {
		const m = tokens / 1_000_000;
		return `${Number.isInteger(m) ? m : m.toFixed(1)}M`;
	}
	return `${Math.round(tokens / 1000)}k`;
}

export interface ModelProviderGroup {
	provider: string;
	models: ModelInfo[];
}

export function filterModels(models: readonly ModelInfo[], query: string): ModelInfo[] {
	const q = query.trim().toLowerCase();
	if (!q) return [...models];
	return models.filter(
		m =>
			m.name.toLowerCase().includes(q) ||
			m.id.toLowerCase().includes(q) ||
			m.provider.toLowerCase().includes(q),
	);
}

export function groupModelsByProvider(models: readonly ModelInfo[]): ModelProviderGroup[] {
	const map = new Map<string, ModelInfo[]>();
	for (const m of models) {
		const list = map.get(m.provider) ?? [];
		list.push(m);
		map.set(m.provider, list);
	}
	return Array.from(map.entries()).map(([provider, list]) => ({ provider, models: list }));
}

export function formatUsageLimitWarning(limit?: UsageLimitState | null): string | null {
	if (!limit) return null;
	const resetStr = limit.resetsAtSec
		? ` · ${new Date(limit.resetsAtSec * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} 重置`
		: "";
	if (limit.stage === "low_priority") {
		const left = limit.allowanceLeftPercent !== undefined ? `（剩余 ${Math.round(limit.allowanceLeftPercent)}%）` : "";
		return `低优先级通道${left}${resetStr}`;
	}
	return `收尾额度${limit.extraUsage ? "（超额计费已开启）" : ""}${resetStr}`;
}

export function extractUserMessageText(msg: ViewMessage): string {
	if (msg.role !== "user") return "";
	if (typeof msg.content === "string") return msg.content;
	if (Array.isArray(msg.content)) {
		return msg.content
			.filter((b): b is { type: "text"; text: string } => b.type === "text")
			.map(b => b.text)
			.join("\n");
	}
	return "";
}

export function collectUserPromptHistory(messages: readonly ViewMessage[]): string[] {
	const out: string[] = [];
	for (const m of messages) {
		if (m.role !== "user") continue;
		const text = extractUserMessageText(m).trim();
		if (text.length > 0 && out[out.length - 1] !== text) {
			out.push(text);
		}
	}
	return out;
}

const DRAFT_KEY_PREFIX = "omp-ui:draft:";

export function loadSessionDraft(sessionId: string | null, storage?: Pick<Storage, "getItem"> | null): string {
	const s = storage ?? (typeof localStorage !== "undefined" ? localStorage : null);
	if (!s) return "";
	const key = `${DRAFT_KEY_PREFIX}${sessionId ?? "__welcome__"}`;
	try {
		return s.getItem(key) ?? "";
	} catch {
		return "";
	}
}

export function saveSessionDraft(
	sessionId: string | null,
	text: string,
	storage?: Pick<Storage, "setItem" | "removeItem"> | null,
): void {
	const s = storage ?? (typeof localStorage !== "undefined" ? localStorage : null);
	if (!s) return;
	const key = `${DRAFT_KEY_PREFIX}${sessionId ?? "__welcome__"}`;
	try {
		if (text.length > 0) {
			s.setItem(key, text);
		} else {
			s.removeItem(key);
		}
	} catch {
		/* storage quota or private mode */
	}
}
