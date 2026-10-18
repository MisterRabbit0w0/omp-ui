import {
	Activity,
	ArrowRightLeft,
	Copy,
	Download,
	GitBranch,
	GitFork,
	MessageSquarePlus,
	Minimize2,
	MoreHorizontal,
	PanelLeft,
	PanelRight,
	RotateCcw,
	SlidersHorizontal,
} from "lucide-react";
import { BranchMenuButton } from "../composer/BranchMenu";
import { stripPrivateUse } from "../sidebar/sidebar-utils";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { SessionListItem } from "@omp-ui/protocol";
import { useAppStore } from "@/store/app-store";
import { getBridge, updateSessionView } from "@/store/bridge-access";
import type { SessionView } from "@/store/session-reducer";
import { Button, IconButton } from "@/ui/Button";
import { PixelGrid } from "@/ui/PixelGrid";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/ui/Menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/Popover";
import { toast } from "@/ui/Toast";
import { Tooltip } from "@/ui/Tooltip";
import { CompactDialog } from "./CompactDialog";
import { DiagnosticsDialog } from "./DiagnosticsDialog";
import { HandoffDialog } from "./HandoffDialog";
import { SessionTreeDialog } from "./SessionTreeDialog";
import {
	extractLastAssistantText,
	formatCostUsd,
	formatTokensCompact,
	getContextRingTone,
	truncateMiddlePath,
} from "./header-utils";

const RING_CIRCUMFERENCE = 2 * Math.PI * 7; // r = 7 -> ~43.98

export interface SessionHeaderProps {
	sessionId: string | null;
	scrolled?: boolean;
	showSidebarToggle?: boolean;
	onToggleSidebar?: () => void;
	onTogglePanel?: () => void;
	onOpenSettings?: (tab?: string) => void;
	onOpenDiagnostics?: (sessionId?: string) => void;
	/** Optional overrides for gallery/testing */
	viewOverride?: SessionView;
	sessionItemOverride?: SessionListItem;
}

const CWD_CHIP_MAX_WIDTH = 240;
const CWD_CHIP_PADDING = 12; // px-1.5 on both sides

/**
 * Path text for the cwd chip. The middle-ellipsis budget comes from the measured glyph width of the
 * (monospace) chip text, so the result always fits the chip instead of a fixed character count (§6.2).
 */
function CwdChipText({ cwd }: { cwd: string }) {
	const ref = useRef<HTMLSpanElement | null>(null);
	const [maxLen, setMaxLen] = useState(30);
	const text = truncateMiddlePath(cwd, maxLen);
	useLayoutEffect(() => {
		const el = ref.current;
		if (!el || text.length === 0) return;
		const charWidth = el.getBoundingClientRect().width / text.length;
		if (!Number.isFinite(charWidth) || charWidth <= 0) return;
		const fit = Math.max(8, Math.floor((CWD_CHIP_MAX_WIDTH - CWD_CHIP_PADDING) / charWidth));
		if (fit !== maxLen) setMaxLen(fit);
	}, [text, maxLen]);
	return <span ref={ref}>{text}</span>;
}

export function SessionHeader({
	sessionId,
	scrolled = false,
	showSidebarToggle = false,
	onToggleSidebar,
	onTogglePanel,
	onOpenSettings,
	onOpenDiagnostics,
	viewOverride,
	sessionItemOverride,
}: SessionHeaderProps) {
	const storeView = useAppStore(s => (sessionId ? s.views[sessionId] : undefined));
	const storeSessionItem = useAppStore(s => s.sessions.find(it => it.id === sessionId));
	const config = useAppStore(s => s.config);
	const loadSessions = useAppStore(s => s.loadSessions);

	const view = viewOverride ?? storeView;
	const sessionItem = sessionItemOverride ?? storeSessionItem;

	const [editingTitle, setEditingTitle] = useState(false);
	const [titleDraft, setTitleDraft] = useState("");
	const [compactOpen, setCompactOpen] = useState(false);
	const [handoffOpen, setHandoffOpen] = useState(false);
	const [treeOpen, setTreeOpen] = useState(false);
	const [diagOpen, setDiagOpen] = useState(false);
	// Listen for global action events from CommandPalette / shortcuts
	useEffect(() => {
		if (viewOverride !== undefined) return;
		const onHeaderAction = (e: Event) => {
			const action =
				e instanceof CustomEvent && e.detail && typeof e.detail === "object" && "action" in e.detail && typeof e.detail.action === "string"
					? e.detail.action
					: null;
			if (!action) return;
			if (action === "compact") setCompactOpen(true);
			else if (action === "handoff") setHandoffOpen(true);
			else if (action === "tree") setTreeOpen(true);
			else if (action === "diagnostics") setDiagOpen(true);
		};
		window.addEventListener("header-action", onHeaderAction);
		return () => window.removeEventListener("header-action", onHeaderAction);
	}, [viewOverride]);

	const displayTitle = stripPrivateUse(view?.title || view?.state?.sessionName || sessionItem?.title || "") || "新对话";
	const runKind = view?.run.kind;
	const sessionRunning =
		runKind === "running" || runKind === "settling" || runKind === "compacting" || runKind === "retrying";

	// §6.3: the welcome header shows only the title; the cwd lives on the composer's context strip.
	const cwd = sessionId ? sessionItem?.cwd || config?.recentProjects?.[0] || "" : "";

	const contextUsage = view?.stats?.contextUsage ?? view?.state?.contextUsage;
	const percent = Math.max(0, Math.min(100, contextUsage?.percent ?? 0));
	const ringTone = getContextRingTone(percent);
	const strokeColor =
		ringTone === "red"
			? "var(--red)"
			: ringTone === "orange"
				? "var(--orange)"
				: "var(--ink-3)";
	const dashLen = (percent / 100) * RING_CIRCUMFERENCE;

	const costStr = formatCostUsd(view?.stats?.cost);
	const statusEntries = view ? Array.from(view.statusChips.entries()) : [];

	const startEditTitle = () => {
		if (!sessionId) return;
		setTitleDraft(displayTitle);
		setEditingTitle(true);
	};

	const commitTitle = async () => {
		setEditingTitle(false);
		if (!sessionId) return;
		const next = titleDraft.trim();
		if (!next || next === displayTitle) return;
		updateSessionView(sessionId, v => ({ ...v, title: next }));
		useAppStore.setState(s => ({
			sessions: s.sessions.map(it => (it.id === sessionId ? { ...it, title: next } : it)),
		}));
		try {
			await getBridge().rpc(sessionId, { type: "set_session_name", name: next });
			await loadSessions();
		} catch {
			/* ignore if readonly */
		}
	};

	const handleCopyCwd = async () => {
		if (!cwd) return;
		try {
			await navigator.clipboard.writeText(cwd);
			toast("已复制工作目录路径", "info");
		} catch {
			toast("复制失败", "error");
		}
	};

	const handleCopyLastAnswer = useCallback(async () => {
		if (!sessionId || !view) return;
		try {
			let text: string | null = null;
			if (!view.readonly && view.proc === "ready") {
				const res = await getBridge().rpc(sessionId, { type: "get_last_assistant_text" }).catch(() => null);
				if (res?.text) text = res.text;
			}
			if (!text) {
				text = extractLastAssistantText(view.messages);
			}
			if (!text) {
				toast("当前没有可复制的助手回答", "info");
				return;
			}
			await navigator.clipboard.writeText(text);
			toast("已复制最后回答", "success");
		} catch {
			toast("复制失败", "error");
		}
	}, [sessionId, view]);

	const handleFork = async () => {
		if (!sessionId) return;
		try {
			if (view && (view.readonly || view.proc === "none")) {
				await useAppStore.getState().startSession(sessionId);
			}
			await getBridge().rpc(sessionId, { type: "fork" });
			await loadSessions();
			toast("已分叉为新会话", "success");
		} catch (err) {
			toast(err instanceof Error ? err.message : "分叉失败", "error");
		}
	};

	const handleExportHtml = async () => {
		if (!sessionId) return;
		try {
			if (view && (view.readonly || view.proc === "none")) {
				await useAppStore.getState().startSession(sessionId);
			}
			const res = await getBridge().rpc(sessionId, { type: "export_html" });
			const blob = await getBridge().http.downloadExport(res.path);
			const url = URL.createObjectURL(blob);
			const a = document.createElement("a");
			a.href = url;
			a.download = `${displayTitle.replace(/[^\w\u4e00-\u9fa5-]+/g, "_")}.html`;
			document.body.appendChild(a);
			a.click();
			a.remove();
			URL.revokeObjectURL(url);
			toast("已导出 HTML", "success");
		} catch (err) {
			toast(err instanceof Error ? err.message : "导出失败", "error");
		}
	};

	const handleRestartProcess = async () => {
		if (!sessionId) return;
		try {
			const bridge = getBridge();
			bridge.send({ t: "stop", sessionId });
			updateSessionView(sessionId, v => ({ ...v, proc: "starting" }));
			if (sessionItem) {
				await bridge.start({
					cwd: sessionItem.cwd,
					resume: sessionItem.file,
					model: view?.state?.model ? `${view.state.model.provider}/${view.state.model.id}` : config?.defaultModel,
					thinking: view?.state?.thinkingLevel ?? config?.defaultThinking,
					approvalMode: view?.approvalMode ?? config?.defaultApprovalMode,
				});
				bridge.attach(sessionId);
				await useAppStore.getState().coldStart(sessionId);
			}
			toast("已重启会话进程", "success");
		} catch (err) {
			toast(err instanceof Error ? err.message : "重启进程失败", "error");
		}
	};

	// Global shortcut Ctrl+Shift+C: copy last answer (DESIGN §12)
	useEffect(() => {
		if (viewOverride !== undefined) return;
		const onKeyDown = (e: KeyboardEvent) => {
			if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "c") {
				const sel = window.getSelection()?.toString();
				if (sel) return; // let normal copy work if text is selected
				e.preventDefault();
				void handleCopyLastAnswer();
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [handleCopyLastAnswer, viewOverride]);

	const tokenBreakdownText = view?.stats
		? `输入 ${formatTokensCompact(view.stats.tokens.input)} · 输出 ${formatTokensCompact(view.stats.tokens.output)} · 缓存读 ${formatTokensCompact(view.stats.tokens.cacheRead)} · 缓存写 ${formatTokensCompact(view.stats.tokens.cacheWrite)}` +
			(view.stats.premiumRequests > 0 ? ` · 高级请求 ${view.stats.premiumRequests}` : "")
		: "暂无用量统计";

	return (
		<>
			<header
				className={
					"hdr flex h-11 shrink-0 items-center gap-2 border-b px-4 transition-colors duration-150 " +
					(scrolled ? "scrolled border-line" : "border-transparent")
				}
			>
				{showSidebarToggle && onToggleSidebar && (
					<IconButton label="展开侧边栏" onClick={onToggleSidebar}>
						<PanelLeft size={15} strokeWidth={1.8} className="i" />
					</IconButton>
				)}

				{editingTitle ? (
					<input
						data-bare=""
						autoFocus
						value={titleDraft}
						onChange={e => setTitleDraft(e.target.value)}
						onBlur={() => void commitTitle()}
						onKeyDown={e => {
							if (e.key === "Enter") {
								e.preventDefault();
								void commitTitle();
							} else if (e.key === "Escape") {
								e.preventDefault();
								setEditingTitle(false);
							}
						}}
						aria-label="编辑会话标题"
						className="w-64 max-w-[40%] border-0 border-b border-line-strong bg-transparent text-[13px] font-medium text-ink outline-none"
					/>
				) : (
					<span
						onDoubleClick={startEditTitle}
						title="双击重命名会话"
						className="title max-w-[40%] cursor-text truncate text-[13px] font-medium text-ink"
					>
						{displayTitle}
					</span>
				)}

				{sessionRunning && (
					<span
						role="status"
						className="anim-fade-in inline-flex h-[22px] shrink-0 items-center gap-1.5 rounded-chip bg-field px-1.5 text-[11.5px] font-medium text-ink-2 shadow-hairline"
					>
						<PixelGrid mode="drive" size="sm" />
						运行中
					</span>
				)}

				{cwd && (
					<Tooltip content={`点击复制: ${cwd}`} side="bottom">
						<button
							type="button"
							onClick={() => void handleCopyCwd()}
							className="chip mono inline-flex h-[22px] max-w-[240px] shrink-0 items-center overflow-hidden rounded-chip bg-field px-1.5 font-mono text-[11.5px] whitespace-nowrap text-ink-2 shadow-hairline transition-colors hover:text-ink"
						>
							<CwdChipText cwd={cwd} />
						</button>
					</Tooltip>
				)}

				{cwd && <BranchMenuButton cwd={cwd} running={sessionRunning || Boolean(sessionItem?.running)} />}

				<span className="sp flex-1" />

				{sessionId !== null && (
				<div className="flex items-center gap-1">
					{statusEntries.map(([key, text]) => (
						<span
							key={key}
							className="inline-flex h-[22px] shrink-0 items-center whitespace-nowrap rounded-chip px-1.5 text-[11.5px] text-ink-2"
						>
							{text}
						</span>
					))}

					{/* Context ring + Popover (§6.2) */}
					<Popover>
						<PopoverTrigger asChild>
							<button
								type="button"
								aria-label={`上下文用量 ${Math.round(percent)}%`}
								className="ctx inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-control px-1.5 text-[12px] text-ink-2 transition-colors hover:bg-hover-2"
							>
								<svg width={18} height={18} viewBox="0 0 18 18" aria-hidden="true">
									<circle
										cx={9}
										cy={9}
										r={7}
										fill="none"
										stroke="var(--line)"
										strokeWidth={2}
									/>
									<circle
										cx={9}
										cy={9}
										r={7}
										fill="none"
										stroke={strokeColor}
										strokeWidth={2}
										strokeLinecap="round"
										strokeDasharray={`${dashLen.toFixed(1)} 44`}
										transform="rotate(-90 9 9)"
									/>
								</svg>
								{ringTone === "red" && (
									<span
										key={Math.round(percent)}
										className="anim-pop-in font-mono text-[11.5px] font-medium text-red-ink tnum"
									>
										{Math.round(percent)}%
									</span>
								)}
							</button>
						</PopoverTrigger>
						<PopoverContent side="bottom" align="end" className="w-60 p-3">
							<div className="flex items-center justify-between text-[12px]">
								<span className="font-medium text-ink">上下文窗口</span>
								<span
									className={
										"font-mono font-medium tnum " +
										(ringTone === "red"
											? "text-red-ink"
											: ringTone === "orange"
												? "text-orange-ink"
												: "text-ink-2")
									}
								>
									{Math.round(percent)}%
								</span>
							</div>
							<div className="my-2 h-1 w-full overflow-hidden rounded-pill bg-field">
								<div
									className={
										"h-full rounded-pill transition-[width] duration-300 " +
										(ringTone === "red"
											? "bg-red"
											: ringTone === "orange"
												? "bg-orange"
												: "bg-accent")
									}
									style={{ width: `${percent}%` }}
								/>
							</div>
							<div className="flex items-center justify-between font-mono text-[11.5px] text-ink-2 tnum">
								<span>
									{formatTokensCompact(contextUsage?.tokens ?? 0)} /{" "}
									{formatTokensCompact(contextUsage?.contextWindow ?? 200_000)} tokens
								</span>
							</div>
							<div className="mt-2.5 flex justify-end border-t border-line pt-2">
								<Button
									size="sm"
									variant="secondary"
									disabled={!sessionId}
									icon={<Minimize2 size={11} strokeWidth={2} />}
									onClick={() => setCompactOpen(true)}
								>
									压缩
								</Button>
							</div>
						</PopoverContent>
					</Popover>

					{/* Cost with Tooltip (§6.2) */}
					<Tooltip content={tokenBreakdownText} side="bottom">
						<span
							key={costStr}
							className="anim-pop-in shrink-0 cursor-default px-1 font-mono text-[12px] whitespace-nowrap text-ink-2 tnum"
						>
							{costStr}
						</span>
					</Tooltip>

					{/* ⋯ Menu (§9.6) */}
					<Menu>
						<MenuTrigger asChild>
							<IconButton label="更多">
								<MoreHorizontal size={15} strokeWidth={2.4} className="i" />
							</IconButton>
						</MenuTrigger>
						<MenuContent align="end" width={220}>
							<MenuItem
								disabled={!sessionId}
								icon={<Minimize2 size={15} strokeWidth={1.8} />}
								onSelect={() => setCompactOpen(true)}
							>
								压缩上下文
							</MenuItem>
							<MenuItem
								disabled={!sessionId}
								icon={<ArrowRightLeft size={15} strokeWidth={1.8} />}
								onSelect={() => setHandoffOpen(true)}
							>
								交接到新会话
							</MenuItem>
							<MenuItem
								disabled={!sessionId}
								icon={<GitFork size={15} strokeWidth={1.8} />}
								onSelect={() => void handleFork()}
							>
								分叉为新会话
							</MenuItem>
							<MenuItem
								disabled={!sessionId}
								icon={<GitBranch size={15} strokeWidth={1.8} />}
								onSelect={() => setTreeOpen(true)}
							>
								会话树
							</MenuItem>
							<MenuItem
								disabled={!sessionId}
								icon={<Download size={15} strokeWidth={1.8} />}
								onSelect={() => void handleExportHtml()}
							>
								导出 HTML
							</MenuItem>
							<MenuItem
								disabled={!sessionId}
								icon={<Copy size={15} strokeWidth={1.8} />}
								kbd="Ctrl+Shift+C"
								onSelect={() => void handleCopyLastAnswer()}
							>
								复制最后回答
							</MenuItem>
							<MenuItem
								disabled={!sessionId}
								icon={<MessageSquarePlus size={15} strokeWidth={1.8} />}
								onSelect={() => window.dispatchEvent(new CustomEvent("open-btw"))}
							>
								旁问 (btw)
							</MenuItem>
							<MenuSeparator />
							<MenuItem
								icon={<SlidersHorizontal size={15} strokeWidth={1.8} />}
								onSelect={() => onOpenSettings?.("session")}
							>
								会话设置
							</MenuItem>
							<MenuItem
								disabled={!sessionId}
								icon={<RotateCcw size={15} strokeWidth={1.8} />}
								onSelect={() => void handleRestartProcess()}
							>
								重启进程
							</MenuItem>
							<MenuItem
								icon={<Activity size={15} strokeWidth={1.8} />}
								onSelect={() => {
									if (onOpenDiagnostics) onOpenDiagnostics(sessionId ?? undefined);
									else setDiagOpen(true);
								}}
							>
								诊断
							</MenuItem>
						</MenuContent>
					</Menu>

					{/* Right panel toggle (§6.2) */}
					<IconButton label="右侧面板" onClick={onTogglePanel}>
						<PanelRight size={15} strokeWidth={1.8} className="i" />
					</IconButton>
				</div>
				)}
			</header>

			<CompactDialog sessionId={sessionId} open={compactOpen} onOpenChange={setCompactOpen} />
			<HandoffDialog sessionId={sessionId} open={handoffOpen} onOpenChange={setHandoffOpen} />
			<SessionTreeDialog sessionId={sessionId} open={treeOpen} onOpenChange={setTreeOpen} />
			<DiagnosticsDialog sessionId={sessionId} open={diagOpen} onOpenChange={setDiagOpen} />
		</>
	);
}
