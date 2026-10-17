import type { ApprovalMode, FileHit, ModelInfo, ThinkingLevel } from "@omp-ui/protocol";
import { ArrowUp, ChevronDown, CornerDownLeft, Plus, RotateCcw, Square, X } from "lucide-react";
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	type ChangeEvent,
	type ClipboardEvent,
	type DragEvent,
	type KeyboardEvent,
} from "react";
import { useAppStore, type SendMode } from "@/store/app-store";
import { getBridge, updateSessionView } from "@/store/bridge-access";
import { useSessionView } from "@/store/hooks";
import type { SessionView } from "@/store/session-reducer";
import { Kbd } from "@/ui/Chip";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/ui/Menu";
import { Tooltip } from "@/ui/Tooltip";
import { ModelThinkingButton, thinkingSegments } from "./ModelSelector";
import { PermissionChip } from "./PermissionChip";
import { ProjectMenuButton } from "./ProjectMenu";
import { resolveSessionConfig } from "./new-session-config";
import { ComposerStatusChips, EditorWidgets, QueueChips } from "./QueueChips";
import { FileMentionMenu, SlashMenu } from "./SlashMenu";
import {
	applyFileMention,
	applySlashInsertion,
	canModelAcceptImages,
	collectUserPromptHistory,
	detectMenuTrigger,
	downscaleImageFile,
	filterSlashCommands,
	getSendButtonState,
	isComposerDisabled,
	isRunBusy,
	isShellInput,
	loadSessionDraft,
	mergeAbortAndRestoreQueue,
	mergeRemovedQueueImages,
	resolveSendAction,
	saveSessionDraft,
	type AttachmentItem,
	type QueueChipItem,
	type RunSendMode,
	type SendTrigger,
	type SlashMenuRow,
	modelInfoFromCatalog,
} from "./logic";

const COMPOSER_BEAM_CSS = `
.composer-running::before {
  content: "";
  position: absolute;
  inset: -2px;
  border-radius: 18px;
  padding: 1px;
  background: conic-gradient(
    from var(--beam-angle),
    transparent 0 70%,
    color-mix(in oklch, var(--accent) 70%, transparent) 85%,
    transparent 100%
  );
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
  opacity: 0.55;
  animation: beam 2.4s linear infinite;
  pointer-events: none;
  transition: opacity 0.3s;
}
.composer-sweep {
  background-image: linear-gradient(
    105deg,
    transparent 40%,
    color-mix(in oklch, var(--accent) 14%, transparent) 50%,
    transparent 60%
  );
  background-size: 200% 100%;
  animation: shimmer-text 600ms var(--ease-out-strong) 1 both;
}
@media (prefers-reduced-motion: reduce) {
  .composer-running::before,
  .composer-sweep {
    display: none !important;
  }
}
`;

const RUN_MODE_LABELS: Record<RunSendMode, string> = {
	steer: "插话",
	followUp: "稍后",
	interrupt: "打断",
};

export interface ComposerProps {
	sessionId: string | null;
	cwd: string | null;
	/** Optional view override for gallery / isolated tests */
	viewOverride?: SessionView;
	/** Optional initial text for gallery states */
	initialText?: string;
	/** Optional initial attachments for gallery states */
	initialAttachments?: AttachmentItem[];
	/** Optional forced open menu for gallery states */
	initialOpenMenu?: "slash" | "at" | "model" | "project" | "permission" | null;
	/** Optional preloaded @ files for gallery states */
	initialFiles?: FileHit[];
	/** Render Slash/@ menus inline in flow rather than absolute for gallery cards */
	inlineMenus?: boolean;
	/** Optional drag-over showcase state */
	initialDragOver?: boolean;
	/** Optional ghost text showcase state */
	initialGhostText?: string;
}

/**
 * FRONTEND §6.12 & DESIGN §9.4 Composer:
 * Rounded PromptBar with single-line ↔ multi-line grid switch, autosize to 40vh,
 * IME-safe Enter, image attachments (paste/drag/button, downscaled <=2000px),
 * model & thinking selectors, send/stop/steer state machine, `!` shell mode,
 * `/` slash command menu, `@` file mention menu, queue chips, widgets, status
 * chips, ghost text prediction, and welcome new-session support.
 */
export function Composer({
	sessionId,
	cwd,
	viewOverride,
	initialText,
	initialAttachments,
	initialOpenMenu = null,
	initialFiles,
	inlineMenus = false,
	initialDragOver = false,
	initialGhostText = "",
}: ComposerProps) {
	const storeView = useSessionView(sessionId);
	const view = viewOverride ?? storeView;

	const config = useAppStore(s => s.config);
	const modelCatalog = useAppStore(s => s.modelCatalog);
	const loadModelCatalog = useAppStore(s => s.loadModelCatalog);
	const projects = useAppStore(s => s.projects);
	const sessions = useAppStore(s => s.sessions);
	const composerInsert = useAppStore(s => s.composerInsert);
	const sendPrompt = useAppStore(s => s.sendPrompt);
	const pending = useAppStore(s => s.pendingSession);
	const updatePending = useAppStore(s => s.updatePendingSession);
	const newSessionFromPending = useAppStore(s => s.newSessionFromPending);
	const abort = useAppStore(s => s.abort);
	const pushToast = useAppStore(s => s.pushToast);
	const welcomeRequest = useAppStore(s => s.welcomeRequest);
	const restartWithApprovalMode = useAppStore(s => s.restartWithApprovalMode);

	const [text, setText] = useState<string>(() =>
		initialText !== undefined ? initialText : loadSessionDraft(sessionId),
	);
	const [cursor, setCursor] = useState<number>(() => (initialText ?? "").length);
	const [attachments, setAttachments] = useState<AttachmentItem[]>(() => initialAttachments ?? []);
	const [selectedRunMode, setSelectedRunMode] = useState<RunSendMode>("steer");
	const [bashRunning, setBashRunning] = useState(false);
	const [isDragOver, setIsDragOver] = useState(initialDragOver);
	const [sweepKey, setSweepKey] = useState(0);

	const [modelOpen, setModelOpen] = useState(initialOpenMenu === "model");
	const [projectOpen, setProjectOpen] = useState(initialOpenMenu === "project");
	const [permissionOpen, setPermissionOpen] = useState(initialOpenMenu === "permission");

	// Slash / @ menu state
	const [menuIndex, setMenuIndex] = useState(0);
	const [dismissedTriggerKey, setDismissedTriggerKey] = useState<string | null>(null);
	// A restored draft such as "/" must not pop the menu open; only user input arms it (m13).
	const [userEdited, setUserEdited] = useState(false);
	const [atFiles, setAtFiles] = useState<FileHit[]>(() => initialFiles ?? []);
	const [atLoading, setAtLoading] = useState(false);

	// Ghost text state
	const [ghostText, setGhostText] = useState<string>(initialGhostText);

	const textareaRef = useRef<HTMLTextAreaElement | null>(null);
	const fileInputRef = useRef<HTMLInputElement | null>(null);
	const undoStackRef = useRef<string[]>([]);
	const lastEscAtRef = useRef<number>(0);
	const dragDepthRef = useRef<number>(0);

	const welcome = sessionId === null;
	const resolved = useMemo(() => resolveSessionConfig(pending, config, projects), [pending, config, projects]);


	const effectiveCwd = welcome
		? (resolved.cwd ?? cwd ?? ".")
		: (cwd ?? sessions.find(s => s.id === sessionId)?.cwd ?? projects[0]?.cwd ?? sessions[0]?.cwd ?? ".");

	// Welcome composer (no process yet): models come from the bridge's `omp models --json` catalog.
	const catalogModels = useMemo(() => (modelCatalog ?? []).map(modelInfoFromCatalog), [modelCatalog]);
	const welcomeCatalogModel = resolved.model
		? catalogModels.find(m => `${m.provider}/${m.id}` === resolved.model)
		: undefined;
	const menuModels = welcome ? catalogModels : (view?.models ?? []);
	const currentModel: ModelInfo | null | undefined = welcome
		? (welcomeCatalogModel ?? view?.state?.model)
		: (view?.state?.model ?? view?.models[0]);
	const currentThinking: ThinkingLevel = welcome ? (resolved.thinking ?? "inherit") : (view?.state?.thinkingLevel ?? "high");
	const approvalMode: ApprovalMode = welcome
		? resolved.approvalMode
		: (view?.approvalMode ?? config?.defaultApprovalMode ?? "write");

	const acceptsImages = canModelAcceptImages(currentModel);

	// The catalog spawns `omp models --json` (seconds), so only fetch it when the welcome composer needs it.
	useEffect(() => {
		if (sessionId === null) void loadModelCatalog();
	}, [sessionId, loadModelCatalog]);

	// 新对话 / Ctrl+N / group "+" land here: preselect the project, then focus the input.
	useEffect(() => {
		if (sessionId !== null || !welcomeRequest) return;
		if (welcomeRequest.cwd) updatePending({ cwd: welcomeRequest.cwd });
		useAppStore.setState({ welcomeRequest: null });
		// No cleanup: clearing the request re-runs this effect and must not cancel the focus.
		requestAnimationFrame(() => textareaRef.current?.focus());
	}, [sessionId, welcomeRequest]);

	// Reload draft when switching sessions (unless controlled by initialText in gallery)
	useEffect(() => {
		if (initialText !== undefined) return;
		const draft = loadSessionDraft(sessionId);
		setText(draft);
		setCursor(draft.length);
		setUserEdited(false);
		undoStackRef.current = [];
	}, [sessionId, initialText]);

	// Persist draft to localStorage
	useEffect(() => {
		if (initialText !== undefined) return;
		saveSessionDraft(sessionId, text);
	}, [sessionId, text, initialText]);

	// Consume `composerInsert` (from `set_editor_text` or branch edit, DESIGN §7.1 / §9.3)
	useEffect(() => {
		if (!composerInsert) return;
		if (sessionId !== null && composerInsert.sessionId !== sessionId) return;
		if (text.length > 0 && text !== composerInsert.text) {
			undoStackRef.current.push(text);
		}
		setText(composerInsert.text);
		setCursor(composerInsert.text.length);
		useAppStore.setState({ composerInsert: null });
		requestAnimationFrame(() => {
			const el = textareaRef.current;
			if (el) {
				el.focus();
				el.setSelectionRange(composerInsert.text.length, composerInsert.text.length);
			}
		});
	}, [composerInsert, sessionId, text]);

	// Autosize the fixed two-row textarea: min 44, max 40vh
	useLayoutEffect(() => {
		const el = textareaRef.current;
		if (!el) return;
		el.style.height = "auto";
		const maxPx = typeof window !== "undefined" ? Math.round(window.innerHeight * 0.4) : 320;
		el.style.height = `${Math.max(44, Math.min(el.scrollHeight, maxPx))}px`;
	}, [text]);

	// Detect active `/` or `@` trigger
	const rawTrigger = detectMenuTrigger(text, cursor);
	const triggerKey = rawTrigger ? `${rawTrigger.kind}:${rawTrigger.start}:${rawTrigger.query}` : null;
	const activeTrigger =
		initialOpenMenu === "slash"
			? ({ kind: "slash", query: text.startsWith("/") ? text.slice(1) : "", start: 0, end: text.length } as const)
			: initialOpenMenu === "at"
				? ({ kind: "at", query: text.includes("@") ? text.slice(text.lastIndexOf("@") + 1) : "", start: Math.max(0, text.lastIndexOf("@")), end: text.length } as const)
				: rawTrigger && userEdited && triggerKey !== dismissedTriggerKey
					? rawTrigger
					: null;

	const slashRows =
		activeTrigger?.kind === "slash" ? filterSlashCommands(view?.commands ?? [], activeTrigger) : [];

	// Reset menu highlight index when query changes
	useEffect(() => {
		setMenuIndex(0);
	}, [triggerKey]);

	// Debounced 120ms `@` file search via BridgeHttp
	useEffect(() => {
		if (activeTrigger?.kind !== "at") return;
		if (initialFiles) {
			const q = activeTrigger.query.trim().toLowerCase();
			setAtFiles(
				q ? initialFiles.filter(f => f.path.toLowerCase().includes(q) || f.name.toLowerCase().includes(q)) : initialFiles,
			);
			return;
		}
		let cancelled = false;
		setAtLoading(true);
		const timer = setTimeout(() => {
			void getBridge()
				.http.searchFiles(effectiveCwd, activeTrigger.query)
				.then(hits => {
					if (!cancelled) {
						setAtFiles(hits);
						setAtLoading(false);
					}
				})
				.catch(() => {
					if (!cancelled) {
						setAtFiles([]);
						setAtLoading(false);
					}
				});
		}, 120);
		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
	}, [activeTrigger?.kind, activeTrigger?.query, effectiveCwd, initialFiles, initialOpenMenu]);

	// Ghost text prediction after 300ms pause (when config.ghostText is enabled)
	useEffect(() => {
		if (initialGhostText) return;
		if (!config?.ghostText || !sessionId || !text.trim() || cursor !== text.length || activeTrigger || isShellInput(text)) {
			setGhostText("");
			return;
		}
		let cancelled = false;
		const timer = setTimeout(() => {
			void getBridge()
				.rpc(sessionId, { type: "predict_word", text, cursor })
				.then(res => {
					if (!cancelled && res.suffix) {
						setGhostText(res.suffix);
					}
				})
				.catch(() => undefined);
		}, 300);
		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
	}, [config?.ghostText, sessionId, text, cursor, activeTrigger, initialGhostText]);

	const dismissGhostWithFeedback = useCallback(
		(accepted: boolean) => {
			if (!ghostText) return;
			const suggestion = ghostText;
			setGhostText("");
			if (sessionId && config?.ghostText) {
				void getBridge()
					.rpc(sessionId, {
						type: "predict_word_feedback",
						text,
						cursor,
						suggestion,
						accepted,
					})
					.catch(() => undefined);
			}
		},
		[ghostText, sessionId, config?.ghostText, text, cursor],
	);

	// Global Ctrl+L to focus composer (DESIGN §12)
	useEffect(() => {
		const onKeyDown = (e: globalThis.KeyboardEvent) => {
			if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "l") {
				e.preventDefault();
				textareaRef.current?.focus();
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, []);

	const runKind = view?.run.kind ?? "idle";
	const proc = view?.proc ?? "ready";
	const readonly = view?.readonly ?? false;
	const busy = isRunBusy(runKind);
	const { disabled: composerDisabled, reason: disabledReason } = isComposerDisabled(proc, runKind, readonly);

	const sendButtonState = getSendButtonState({
		text,
		imagesCount: attachments.length,
		runKind,
		proc,
		readonly,
		bashRunning,
	});

	const ensureTargetSessionId = async (): Promise<string | null> => {
		if (sessionId !== null) return sessionId;
		try {
			const createdId = await newSessionFromPending();
			// null = still no project after refreshing (the store already toasted): show the picker
			if (createdId === null) setProjectOpen(true);
			return createdId;
		} catch (err) {
			pushToast("error", err instanceof Error ? err.message : "无法创建新会话");
			return null;
		}
	};

	const executeSend = async (trigger: SendTrigger, overrideText?: string) => {
		const effectiveText = overrideText ?? text;
		const action = resolveSendAction({
			text: effectiveText,
			imagesCount: attachments.length,
			runKind,
			proc,
			readonly,
			bashRunning,
			trigger,
			selectedRunMode,
		});

		if (action.kind === "noop") return;

		if (action.kind === "abort") {
			if (sessionId) await abort(sessionId);
			return;
		}

		if (action.kind === "abort_bash") {
			if (sessionId) {
				try {
					await getBridge().rpc(sessionId, { type: "abort_bash" });
				} catch (err) {
					pushToast("error", err instanceof Error ? err.message : "停止命令失败");
				} finally {
					setBashRunning(false);
				}
			}
			return;
		}

		const targetSessionId = await ensureTargetSessionId();
		if (!targetSessionId) return;

		const sentAttachments = attachments;
		setText("");
		setCursor(0);
		setAttachments([]);
		setGhostText("");
		saveSessionDraft(sessionId, "");

		if (action.kind === "bash") {
			const beforeMsgCount = useAppStore.getState().views[targetSessionId]?.messages.length ?? 0;
			setBashRunning(true);
			try {
				const res = await getBridge().rpc(targetSessionId, { type: "bash", command: action.command });
				const afterMessages = useAppStore.getState().views[targetSessionId]?.messages ?? [];
				const hasBashMessage = afterMessages
					.slice(beforeMsgCount)
					.some(m => m.role === "bashExecution" || m.role === "custom");
				if (!hasBashMessage) {
					const summary = res.output.trim()
						? res.output.trim().slice(0, 240)
						: `命令已执行 (exit ${res.exitCode ?? 0})`;
					pushToast(res.exitCode && res.exitCode !== 0 ? "error" : "info", summary);
				}
			} catch (err) {
				pushToast("error", err instanceof Error ? err.message : "Shell 命令执行失败");
			} finally {
				setBashRunning(false);
			}
			return;
		}

		// action.kind === "prompt"
		const images = sentAttachments.length > 0 ? sentAttachments.map(a => a.image) : undefined;
		await sendPrompt(targetSessionId, effectiveText, { images, mode: action.mode as SendMode });
	};

	const handleSelectSlashRow = (row: SlashMenuRow, viaTab = false) => {
		if (!activeTrigger || activeTrigger.kind !== "slash") return;
		const hasSubcommands = !row.subcommand && (row.command.subcommands?.length ?? 0) > 0;
		const needsArgs = Boolean(row.command.input?.hint);

		if (viaTab || hasSubcommands || needsArgs) {
			const inserted = applySlashInsertion(
				text,
				activeTrigger,
				row.command.name,
				row.subcommand?.name,
				true,
			);
			setText(inserted.text);
			setCursor(inserted.cursor);
			requestAnimationFrame(() => {
				const el = textareaRef.current;
				if (el) {
					el.focus();
					el.setSelectionRange(inserted.cursor, inserted.cursor);
				}
			});
			return;
		}

		// DESIGN §9.4: selecting a ready slash command sends it as prompt
		const inserted = applySlashInsertion(
			text,
			activeTrigger,
			row.command.name,
			row.subcommand?.name,
			false,
		);
		void executeSend("enter", inserted.text.trim());
	};

	const handleSelectFileHit = (hit: FileHit) => {
		if (!activeTrigger || activeTrigger.kind !== "at") return;
		const inserted = applyFileMention(text, activeTrigger, hit.path);
		setText(inserted.text);
		setCursor(inserted.cursor);
		requestAnimationFrame(() => {
			const el = textareaRef.current;
			if (el) {
				el.focus();
				el.setSelectionRange(inserted.cursor, inserted.cursor);
			}
		});
	};

	const handleFilesAdded = async (files: FileList | File[]) => {
		const imageFiles = Array.from(files).filter(f => f.type.startsWith("image/"));
		if (imageFiles.length === 0) return;
		if (!acceptsImages) {
			pushToast("warning", "当前模型不支持图片输入");
			return;
		}
		try {
			const processed = await Promise.all(imageFiles.map(f => downscaleImageFile(f)));
			setAttachments(prev => [...prev, ...processed]);
		} catch (err) {
			pushToast("error", err instanceof Error ? err.message : "处理图片附件失败");
		}
	};

	const handlePaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
		const items = e.clipboardData?.items;
		if (!items) return;
		const files: File[] = [];
		for (let i = 0; i < items.length; i++) {
			const item = items[i];
			if (item && item.kind === "file" && item.type.startsWith("image/")) {
				const file = item.getAsFile();
				if (file) files.push(file);
			}
		}
		if (files.length > 0) {
			e.preventDefault();
			void handleFilesAdded(files);
		}
	};

	const handleDragEnter = (e: DragEvent<HTMLDivElement>) => {
		if (!e.dataTransfer?.types.includes("Files")) return;
		e.preventDefault();
		dragDepthRef.current += 1;
		setIsDragOver(true);
	};

	const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
		if (!e.dataTransfer?.types.includes("Files")) return;
		e.preventDefault();
		e.dataTransfer.dropEffect = acceptsImages ? "copy" : "none";
	};

	const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
		if (!e.dataTransfer?.types.includes("Files")) return;
		e.preventDefault();
		dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
		if (dragDepthRef.current === 0) {
			setIsDragOver(false);
		}
	};

	const handleDrop = (e: DragEvent<HTMLDivElement>) => {
		e.preventDefault();
		dragDepthRef.current = 0;
		setIsDragOver(false);
		if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
			void handleFilesAdded(e.dataTransfer.files);
		}
	};

	const handleRemoveQueueItem = async (item: QueueChipItem) => {
		if (!sessionId) return;
		try {
			const res = await getBridge().rpc(sessionId, {
				type: "remove_queued_message",
				message: item.text,
				queue: item.queue,
			});
			if (res.removed) {
				setAttachments(prev => mergeRemovedQueueImages(prev, res));
				updateSessionView(sessionId, v => ({
					...v,
					queue: {
						...v.queue,
						steering:
							item.queue === "steering"
								? v.queue.steering.filter((_, i) => i !== item.index)
								: v.queue.steering,
						followUp:
							item.queue === "followUp"
								? v.queue.followUp.filter((_, i) => i !== item.index)
								: v.queue.followUp,
					},
				}));
			}
		} catch (err) {
			pushToast("error", err instanceof Error ? err.message : "移除排队消息失败");
		}
	};

	const handlePromoteQueueItem = async (item: QueueChipItem) => {
		if (!sessionId) return;
		try {
			const res = await getBridge().rpc(sessionId, {
				type: "promote_queued_message",
				message: item.text,
			});
			if (res.promoted) {
				updateSessionView(sessionId, v => ({
					...v,
					queue: {
						...v.queue,
						steering: [...v.queue.steering, item.text],
						followUp: v.queue.followUp.filter((_, i) => i !== item.index),
					},
				}));
			}
		} catch (err) {
			pushToast("error", err instanceof Error ? err.message : "提升排队消息失败");
		}
	};

	const handleAbortAndRestoreQueue = async () => {
		if (!sessionId) return;
		try {
			const res = await getBridge().rpc(sessionId, { type: "abort_and_restore_queue" });
			const merged = mergeAbortAndRestoreQueue(text, attachments, res);
			setText(merged.text);
			setCursor(merged.text.length);
			setAttachments(merged.attachments);
			updateSessionView(sessionId, v => ({
				...v,
				queue: { steering: [], followUp: [], liveSteered: 0 },
			}));
			requestAnimationFrame(() => textareaRef.current?.focus());
		} catch (err) {
			pushToast("error", err instanceof Error ? err.message : "停止并取回排队消息失败");
		}
	};

	const handleSelectModel = async (model: ModelInfo) => {
		setSweepKey(k => k + 1);
		if (!sessionId) {
			updatePending({ model: `${model.provider}/${model.id}` });
			return;
		}
		try {
			const updated = await getBridge().rpc(sessionId, {
				type: "set_model",
				provider: model.provider,
				modelId: model.id,
			});
			updateSessionView(sessionId, v => ({
				...v,
				state: v.state ? { ...v.state, model: updated } : v.state,
			}));
		} catch (err) {
			pushToast("error", err instanceof Error ? err.message : "切换模型失败");
		}
	};

	const handleSelectThinking = async (level: ThinkingLevel) => {
		if (!sessionId) {
			updatePending({ thinking: level });
			return;
		}
		try {
			await getBridge().rpc(sessionId, { type: "set_thinking_level", level });
			updateSessionView(sessionId, v => ({
				...v,
				state: v.state ? { ...v.state, thinkingLevel: level } : v.state,
			}));
		} catch (err) {
			pushToast("error", err instanceof Error ? err.message : "切换思考级别失败");
		}
	};

	const handleSelectApproval = (mode: ApprovalMode) => {
		if (sessionId === null) {
			updatePending({ approvalMode: mode });
			return;
		}
		void restartWithApprovalMode(sessionId, mode);
	};

	const handleToggleFastMode = async (enabled: boolean) => {
		if (!sessionId) return;
		try {
			const res = await getBridge().rpc(sessionId, { type: "set_fast_mode", enabled });
			updateSessionView(sessionId, v => ({
				...v,
				state: v.state
					? { ...v.state, fastModeEnabled: res.enabled, fastModeActive: res.active }
					: v.state,
			}));
		} catch (err) {
			pushToast("error", err instanceof Error ? err.message : "切换快速模式失败");
		}
	};

	const handleToggleSlowMode = async (enabled: boolean) => {
		if (!sessionId) return;
		try {
			const res = await getBridge().rpc(sessionId, { type: "set_slow_mode", enabled });
			updateSessionView(sessionId, v => ({
				...v,
				state: v.state ? { ...v.state, slowModeEnabled: res.enabled } : v.state,
			}));
		} catch (err) {
			pushToast("error", err instanceof Error ? err.message : "切换慢速通道失败");
		}
	};

	// Ctrl+M toggles the model menu, Ctrl+T cycles the thinking level (FRONTEND §6.12)
	useEffect(() => {
		const onKeyDown = (e: globalThis.KeyboardEvent) => {
			if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || composerDisabled) return;
			const key = e.key.toLowerCase();
			if (key === "m") {
				e.preventDefault();
				setModelOpen(v => !v);
			} else if (key === "t") {
				e.preventDefault();
				const levels = thinkingSegments(view?.thinkingLevels ?? []);
				const next = levels[(levels.indexOf(currentThinking) + 1) % levels.length];
				if (next) void handleSelectThinking(next);
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	});

	const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
		// 1. Never act during IME composition (DESIGN §9.4)
		if (e.nativeEvent.isComposing || e.keyCode === 229) return;

		// 2. Undo replaced text via Ctrl+Z / Cmd+Z
		if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "z") {
			if (undoStackRef.current.length > 0) {
				e.preventDefault();
				const restored = undoStackRef.current.pop() ?? "";
				setText(restored);
				setCursor(restored.length);
				return;
			}
		}

		// 3. Slash or @ menu keyboard navigation
		if (activeTrigger?.kind === "slash") {
			if (e.key === "ArrowDown") {
				e.preventDefault();
				if (slashRows.length > 0) setMenuIndex(i => (i + 1) % slashRows.length);
				return;
			}
			if (e.key === "ArrowUp") {
				e.preventDefault();
				if (slashRows.length > 0) setMenuIndex(i => (i - 1 + slashRows.length) % slashRows.length);
				return;
			}
			if (e.key === "Tab" && slashRows[menuIndex]) {
				e.preventDefault();
				handleSelectSlashRow(slashRows[menuIndex]!, true);
				return;
			}
			if (e.key === "Enter" && !e.shiftKey && slashRows[menuIndex]) {
				e.preventDefault();
				handleSelectSlashRow(slashRows[menuIndex]!, false);
				return;
			}
			if (e.key === "Escape") {
				e.preventDefault();
				if (triggerKey) setDismissedTriggerKey(triggerKey);
				return;
			}
		} else if (activeTrigger?.kind === "at") {
			if (e.key === "ArrowDown") {
				e.preventDefault();
				if (atFiles.length > 0) setMenuIndex(i => (i + 1) % atFiles.length);
				return;
			}
			if (e.key === "ArrowUp") {
				e.preventDefault();
				if (atFiles.length > 0) setMenuIndex(i => (i - 1 + atFiles.length) % atFiles.length);
				return;
			}
			if ((e.key === "Enter" || e.key === "Tab") && !e.shiftKey && atFiles[menuIndex]) {
				e.preventDefault();
				handleSelectFileHit(atFiles[menuIndex]!);
				return;
			}
			if (e.key === "Escape") {
				e.preventDefault();
				if (triggerKey) setDismissedTriggerKey(triggerKey);
				return;
			}
		}

		// 4. Tab accepts ghost text prediction (DESIGN §9.4)
		if (e.key === "Tab" && ghostText) {
			e.preventDefault();
			const acceptedSuffix = ghostText;
			dismissGhostWithFeedback(true);
			const nextText = text + acceptedSuffix;
			setText(nextText);
			setCursor(nextText.length);
			return;
		}

		// 5. Double Escape to abort when running (DESIGN §9.4)
		if (e.key === "Escape") {
			const now = Date.now();
			if (now - lastEscAtRef.current <= 500 && (busy || bashRunning)) {
				e.preventDefault();
				lastEscAtRef.current = 0;
				if (bashRunning) {
					void executeSend("button");
				} else if (sessionId) {
					void abort(sessionId);
				}
				return;
			}
			lastEscAtRef.current = now;
			return;
		}

		// 6. Up arrow recalls previous user message when empty (DESIGN §9.4)
		if (e.key === "ArrowUp" && text.length === 0) {
			const history = collectUserPromptHistory(view?.messages ?? []);
			const previous = history[history.length - 1];
			if (previous) {
				e.preventDefault();
				undoStackRef.current.push("");
				setText(previous);
				setCursor(previous.length);
				return;
			}
		}

		// 7. Enter / Alt+Enter / Ctrl+Enter send routing
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			if (e.ctrlKey || e.metaKey) {
				void executeSend("ctrl_enter");
			} else if (e.altKey) {
				void executeSend("alt_enter");
			} else {
				void executeSend("enter");
			}
		}
	};

	const handleTextChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
		if (ghostText) {
			dismissGhostWithFeedback(false);
		}
		const nextText = e.target.value;
		const nextCursor = e.target.selectionStart ?? nextText.length;
		setText(nextText);
		setCursor(nextCursor);
		setDismissedTriggerKey(null);
		setUserEdited(true);
	};

	const shellMode = isShellInput(text);
	const showRunningHint = sendButtonState === "send_while_running" && !shellMode;
	const hasQueuedMessages =
		(view?.queue.steering.length ?? 0) - (view?.queue.liveSteered ?? 0) + (view?.queue.followUp.length ?? 0) > 0;

	const restartingProc = !welcome && proc === "starting";

	const plusButton = !acceptsImages ? (
		<Tooltip content="当前模型不支持图片输入">
			<span className="inline-flex">
				<button
					type="button"
					disabled
					aria-label="添加附件（当前模型不支持图片）"
					className="inline-flex size-7 shrink-0 cursor-default items-center justify-center rounded-control text-ink-3 opacity-35"
				>
					<Plus size={18} strokeWidth={1.8} />
				</button>
			</span>
		</Tooltip>
	) : (
		<button
			type="button"
			aria-label="添加附件"
			title="添加图片附件"
			disabled={composerDisabled}
			onClick={() => fileInputRef.current?.click()}
			className={
				"inline-flex size-7 shrink-0 items-center justify-center rounded-control text-ink-3 " +
				"transition-[background-color_0.1s,color_0.1s,transform_0.2s] hover:bg-hover hover:text-ink-2 active:scale-[0.94] " +
				(composerDisabled ? "pointer-events-none opacity-35" : "")
			}
		>
			<Plus size={18} strokeWidth={1.8} />
		</button>
	);

	// §6.12 Shell mode swaps the permission chip for an orange `$ Shell` chip
	const permissionSlot = shellMode ? (
		<span
			aria-label="Shell 模式"
			title="Shell 模式 (!)"
			className="inline-flex h-7 shrink-0 items-center rounded-control bg-orange-tint px-2 font-mono text-[13px] font-medium text-orange-ink"
		>
			$ Shell
		</span>
	) : (
		<PermissionChip
			mode={approvalMode}
			context={welcome ? "welcome" : "session"}
			restarting={restartingProc}
			locked={busy || bashRunning}
			disabled={composerDisabled && !restartingProc}
			open={permissionOpen}
			onOpenChange={setPermissionOpen}
			onSelect={handleSelectApproval}
		/>
	);

	const modelAndThinkingSlot = (
		<ModelThinkingButton
			models={menuModels}
			currentModel={currentModel}
			defaultModel={welcome ? resolved.model : undefined}
			state={view?.state}
			thinkingLevels={view?.thinkingLevels ?? []}
			currentThinking={currentThinking}
			open={modelOpen}
			onOpenChange={setModelOpen}
			onSelectModel={m => void handleSelectModel(m)}
			onSelectThinking={lvl => void handleSelectThinking(lvl)}
			onToggleFastMode={enabled => void handleToggleFastMode(enabled)}
			onToggleSlowMode={enabled => void handleToggleSlowMode(enabled)}
			disabled={composerDisabled}
		/>
	);

	const isStopIcon = sendButtonState === "stop" || sendButtonState === "stop_bash";
	const isSendDisabled = sendButtonState === "disabled";

	const sendAndModeSlot = (
		<div className="inline-flex shrink-0 items-center gap-1">
			{sendButtonState === "send_while_running" && !shellMode && (
				<Menu>
					<MenuTrigger asChild>
						<button
							type="button"
							aria-label="运行中发送方式"
							className="inline-flex h-7 items-center gap-1 rounded-control px-2 text-[13px] font-medium text-ink-2 transition-colors hover:bg-hover hover:text-ink active:scale-[0.94]"
						>
							<span>{RUN_MODE_LABELS[selectedRunMode]}</span>
							<ChevronDown size={11} strokeWidth={2.4} className="text-ink-3" />
						</button>
					</MenuTrigger>
					<MenuContent align="end" width={220}>
						<MenuItem
							icon={<CornerDownLeft size={14} strokeWidth={2} />}
							kbd="Enter"
							onSelect={() => {
								setSelectedRunMode("steer");
								void executeSend("mode_steer");
							}}
						>
							插话
						</MenuItem>
						<MenuItem
							icon={<ArrowUp size={14} strokeWidth={2} />}
							kbd="Alt Enter"
							onSelect={() => {
								setSelectedRunMode("followUp");
								void executeSend("mode_followUp");
							}}
						>
							完成后发送
						</MenuItem>
						<MenuItem
							icon={<Square size={13} strokeWidth={2} />}
							kbd="Ctrl Enter"
							onSelect={() => {
								setSelectedRunMode("interrupt");
								void executeSend("mode_interrupt");
							}}
						>
							打断并发送
						</MenuItem>
						<MenuSeparator />
						<MenuItem
							icon={<RotateCcw size={14} strokeWidth={1.8} />}
							onSelect={() => void handleAbortAndRestoreQueue()}
						>
							停止并取回排队消息
						</MenuItem>
					</MenuContent>
				</Menu>
			)}

			{sendButtonState === "stop" && hasQueuedMessages && (
				<Menu>
					<MenuTrigger asChild>
						<button
							type="button"
							aria-label="停止选项"
							title="停止选项"
							className="inline-flex h-7 items-center gap-0.5 rounded-control px-1 text-[11.5px] font-medium text-ink-2 transition-colors hover:bg-hover hover:text-ink active:scale-[0.94]"
						>
							<ChevronDown size={11} strokeWidth={2.4} className="text-ink-3" />
						</button>
					</MenuTrigger>
					<MenuContent align="end" width={210}>
						<MenuItem
							icon={<Square size={13} strokeWidth={2} />}
							kbd="Esc Esc"
							onSelect={() => {
								if (sessionId) void abort(sessionId);
							}}
						>
							停止运行
						</MenuItem>
						<MenuItem
							icon={<RotateCcw size={14} strokeWidth={1.8} />}
							onSelect={() => void handleAbortAndRestoreQueue()}
						>
							停止并取回排队消息
						</MenuItem>
					</MenuContent>
				</Menu>
			)}

			<button
				type="button"
				disabled={isSendDisabled}
				aria-label={isStopIcon ? "停止" : "发送"}
				title={isStopIcon ? "停止 (Esc Esc)" : "发送 (Enter)"}
				onClick={() => void executeSend("button")}
				className={
					"relative grid size-8 shrink-0 place-items-center rounded-full transition-[transform_0.2s,background-color_0.2s] active:scale-[0.94] " +
					(isSendDisabled
						? "cursor-default bg-line-strong text-ink-2 shadow-none"
						: "bg-ink text-surface shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]")
				}
			>
				{/* §4.3 icon cross-fade + scale(.8 <-> 1) 150ms */}
				<span
					aria-hidden={isStopIcon}
					className={
						"col-start-1 row-start-1 inline-flex items-center justify-center transition-[opacity,transform] duration-150 " +
						(isStopIcon ? "scale-80 opacity-0" : "scale-100 opacity-100")
					}
				>
					<ArrowUp size={16} strokeWidth={2.4} />
				</span>
				<span
					aria-hidden={!isStopIcon}
					className={
						"col-start-1 row-start-1 inline-flex items-center justify-center transition-[opacity,transform] duration-150 " +
						(isStopIcon ? "scale-100 opacity-100" : "scale-80 opacity-0")
					}
				>
					<span className="size-2.5 rounded-[2px] bg-current" />
				</span>
			</button>
		</div>
	);

	const textareaElement = (
		<div className="relative min-w-0">
			<textarea
				ref={textareaRef}
				data-bare=""
				rows={1}
				value={text}
				disabled={composerDisabled}
				onChange={handleTextChange}
				onKeyDown={handleKeyDown}
				onPaste={handlePaste}
				onClick={e => setCursor(e.currentTarget.selectionStart ?? text.length)}
				onKeyUp={e => setCursor(e.currentTarget.selectionStart ?? text.length)}
				placeholder={
					disabledReason ??
					(shellMode ? "运行 shell 命令" : "给 omp 发消息，@ 引用文件，/ 运行命令")
				}
				aria-label="消息"
				className={
					"block max-h-[40vh] min-h-[44px] w-full resize-none border-0 bg-transparent p-0 " +
					"text-[14px] leading-[22px] text-ink outline-none placeholder:text-ink-3 " +
					(shellMode ? "font-mono" : "font-sans")
				}
			/>
			{ghostText && !text.includes("\n") && (
				<div
					aria-hidden="true"
					className={
						"pointer-events-none absolute inset-0 overflow-hidden break-words whitespace-pre-wrap " +
						"text-[14px] leading-[22px] " +
						(shellMode ? "font-mono" : "font-sans")
					}
				>
					<span className="invisible">{text}</span>
					<span className="text-ink-3">{ghostText}</span>
					<span className="ml-1.5 inline-flex align-middle">
						<Kbd>Tab</Kbd>
					</span>
				</div>
			)}
		</div>
	);

	return (
		<div className="relative w-full">
			<style>{COMPOSER_BEAM_CSS}</style>
			<input
				ref={fileInputRef}
				type="file"
				accept="image/*"
				multiple
				className="hidden"
				onChange={e => {
					if (e.target.files && e.target.files.length > 0) {
						void handleFilesAdded(e.target.files);
						e.target.value = "";
					}
				}}
			/>

			{/* aboveEditor widgets (DESIGN §9.1) */}
			{view && <EditorWidgets widgets={view.widgets} placement="aboveEditor" />}

			{/* Queue chips (DESIGN §9.5) */}
			{view && (
				<QueueChips
					queue={view.queue}
					onRemove={item => void handleRemoveQueueItem(item)}
					onPromote={item => void handlePromoteQueueItem(item)}
				/>
			)}

			{/* §6.12 context strip (welcome only): the card overlaps its lower 10px */}
			{welcome && (
				<div
					data-testid="composer-context-strip"
					className="relative flex h-10 items-center rounded-t-[14px] bg-field px-3.5 pb-2.5"
				>
					<ProjectMenuButton
						cwd={resolved.cwd}
						projects={projects}
						onSelect={next => updatePending({ cwd: next })}
						disabled={composerDisabled}
						open={projectOpen}
						onOpenChange={setProjectOpen}
					/>
				</div>
			)}

			{/* Composer anchor wrapper so Slash/@ menus sit 8px above the Composer box */}
			<div className={(inlineMenus ? "flex flex-col gap-2" : "relative") + (welcome ? " z-10 -mt-2.5" : "")}>
				{activeTrigger?.kind === "slash" && (
					<SlashMenu
						inline={inlineMenus}
						rows={slashRows}
						selectedIndex={menuIndex}
						onHoverIndex={setMenuIndex}
						onSelect={row => handleSelectSlashRow(row, false)}
					/>
				)}
				{activeTrigger?.kind === "at" && (
					<FileMentionMenu
						inline={inlineMenus}
						files={atFiles}
						loading={atLoading}
						selectedIndex={menuIndex}
						onHoverIndex={setMenuIndex}
						onSelect={handleSelectFileHit}
						isRunning={busy}
					/>
				)}
				<div
					onDragEnter={handleDragEnter}
					onDragOver={handleDragOver}
					onDragLeave={handleDragLeave}
					onDrop={handleDrop}
					className={
						"composer relative isolate rounded-[16px] bg-surface px-3 pt-2.5 pb-2 shadow-card transition-[border-color,background-color] duration-150 " +
						(isDragOver
							? "border-2 border-dashed border-accent bg-accent-tint"
							: "border border-line focus-within:border-line-strong ") +
						(busy || bashRunning ? "composer-running" : "")
					}
				>
					{/* §2.2 one-shot model-switch sweep */}
					{sweepKey > 0 && (
						<span
							key={sweepKey}
							aria-hidden="true"
							className="composer-sweep pointer-events-none absolute inset-0 rounded-[15px]"
						/>
					)}

					{/* §6.18 drag-over overlay */}
					{isDragOver && (
						<div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-[14px] text-[13px] font-medium text-accent-on-tint">
							松开以附加图片
						</div>
					)}

					<div className={isDragOver ? "invisible" : undefined}>
						{/* §6.12 attachments row */}
						{attachments.length > 0 && (
							<div className="flex flex-wrap gap-1.5 pb-1.5" aria-label="已添加附件">
								{attachments.map(att => (
									<span
										key={att.id}
										className="anim-pop-in inline-flex h-[26px] items-center gap-1.5 rounded-chip bg-field pr-1.5 pl-1 text-[11.5px] text-ink-2 shadow-hairline"
									>
										<img
											src={att.dataUrl}
											alt={att.name}
											className="size-5 shrink-0 rounded-[4px] object-cover"
										/>
										<span className="max-w-[144px] truncate text-ink">{att.name}</span>
										<button
											type="button"
											aria-label={`移除 ${att.name}`}
											onClick={() =>
												setAttachments(prev => prev.filter(item => item.id !== att.id))
											}
											className="inline-flex size-4 shrink-0 items-center justify-center rounded-[4px] text-ink-3 hover:bg-hover-2 hover:text-ink-2"
										>
											<X size={10} strokeWidth={2.5} />
										</button>
									</span>
								))}
							</div>
						)}

						{textareaElement}

						{/* §6.12 controls row: + · permission chip | model·thinking · send */}
						<div className="mt-1 flex h-8 items-center justify-between gap-2">
							<div className="flex min-w-0 items-center gap-1">
								{plusButton}
								{permissionSlot}
							</div>
							<div className="flex shrink-0 items-center gap-1">
								{modelAndThinkingSlot}
								{sendAndModeSlot}
							</div>
						</div>
					</div>
				</div>
			</div>

			{/* §6.12 running with text bottom hint line */}
			{showRunningHint && (
				<div className="mt-1.5 text-center text-[11.5px] text-ink-2">
					Enter 插话 · Alt+Enter 完成后发送 · Ctrl+Enter 打断
				</div>
			)}

			{/* belowEditor widgets & status chips (DESIGN §9.1) */}
			{view && <EditorWidgets widgets={view.widgets} placement="belowEditor" />}
			{view && <ComposerStatusChips statusChips={view.statusChips} />}
		</div>
	);
}
