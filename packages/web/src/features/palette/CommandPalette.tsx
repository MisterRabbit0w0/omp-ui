import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
	Activity,
	ArrowRightLeft,
	Check,
	Copy,
	Cpu,
	Download,
	GitBranch,
	GitFork,
	MessageSquare,
	MessageSquarePlus,
	Minimize2,
	Moon,
	PanelLeft,
	PanelRight,
	Plus,
	Search,
	Settings,
	X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "@/app/theme";
import { useAppStore } from "@/store/app-store";
import { getBridge, updateSessionView } from "@/store/bridge-access";
import { Kbd } from "@/ui/Chip";
import { toast } from "@/ui/Toast";
import { useSlidingHighlight } from "@/ui/sliding-highlight";
import { extractLastAssistantText } from "@/features/header/header-utils";
import { buildPaletteItems, filterPaletteGroups, type PaletteItem } from "./palette-utils";

function renderItemIcon(item: PaletteItem, isCurrentModel: boolean) {
	if (item.category === "会话") {
		return <MessageSquare size={15} strokeWidth={1.8} className="i shrink-0 text-ink-3" />;
	}
	if (item.category === "模型") {
		return isCurrentModel ? (
			<Check size={15} strokeWidth={2} className="i shrink-0 text-accent" />
		) : (
			<Cpu size={15} strokeWidth={1.8} className="i shrink-0 text-ink-3" />
		);
	}
	switch (item.actionId) {
		case "new-session":
			return <Plus size={15} strokeWidth={2} className="i shrink-0 text-ink-3" />;
		case "compact":
			return <Minimize2 size={15} strokeWidth={1.8} className="i shrink-0 text-ink-3" />;
		case "handoff":
			return <ArrowRightLeft size={15} strokeWidth={1.8} className="i shrink-0 text-ink-3" />;
		case "fork":
			return <GitFork size={15} strokeWidth={1.8} className="i shrink-0 text-ink-3" />;
		case "tree":
			return <GitBranch size={15} strokeWidth={1.8} className="i shrink-0 text-ink-3" />;
		case "export":
			return <Download size={15} strokeWidth={1.8} className="i shrink-0 text-ink-3" />;
		case "copy-last":
			return <Copy size={15} strokeWidth={1.8} className="i shrink-0 text-ink-3" />;
		case "btw":
			return <MessageSquarePlus size={15} strokeWidth={1.8} className="i shrink-0 text-ink-3" />;
		case "toggle-sidebar":
			return <PanelLeft size={15} strokeWidth={1.8} className="i shrink-0 text-ink-3" />;
		case "toggle-panel":
			return <PanelRight size={15} strokeWidth={1.8} className="i shrink-0 text-ink-3" />;
		case "cycle-theme":
			return <Moon size={15} strokeWidth={1.8} className="i shrink-0 text-ink-3" />;
		case "settings":
			return <Settings size={15} strokeWidth={1.8} className="i shrink-0 text-ink-3" />;
		case "diagnostics":
			return <Activity size={15} strokeWidth={1.8} className="i shrink-0 text-ink-3" />;
		default:
			return <Search size={15} strokeWidth={1.8} className="i shrink-0 text-ink-3" />;
	}
}

export function CommandPalette({
	open,
	onOpenChange,
	onToggleSidebar,
	onTogglePanel,
	onOpenSettings,
	onOpenDiagnostics,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onToggleSidebar?: () => void;
	onTogglePanel?: () => void;
	onOpenSettings?: (tab?: string) => void;
	onOpenDiagnostics?: (sessionId?: string) => void;
}) {
	const sessions = useAppStore(s => s.sessions);
	const currentSessionId = useAppStore(s => s.currentSessionId);
	const currentView = useAppStore(s => (s.currentSessionId ? s.views[s.currentSessionId] : undefined));
	const openSession = useAppStore(s => s.openSession);
	const loadSessions = useAppStore(s => s.loadSessions);
	const { cycleTheme } = useTheme();

	const [query, setQuery] = useState("");
	const [activeIndex, setActiveIndex] = useState(0);
	const inputRef = useRef<HTMLInputElement | null>(null);
	const hl = useSlidingHighlight<HTMLDivElement>({ variant: "menu" });

	const allItems = useMemo(
		() => buildPaletteItems(sessions, currentView?.models ?? []),
		[sessions, currentView?.models],
	);

	const groups = useMemo(() => filterPaletteGroups(allItems, query), [allItems, query]);
	const flatItems = useMemo(() => groups.flatMap(g => g.items), [groups]);

	useEffect(() => {
		if (open) {
			setQuery("");
			setActiveIndex(0);
		}
	}, [open]);

	useEffect(() => {
		setActiveIndex(0);
	}, [query]);

	const executeItem = async (item: PaletteItem) => {
		onOpenChange(false);
		if (item.category === "会话" && item.sessionItem) {
			await openSession(item.sessionItem);
			return;
		}
		if (item.category === "模型" && item.modelInfo) {
			if (!currentSessionId) {
				toast("请先打开或创建一个会话", "info");
				return;
			}
			try {
				if (currentView && (currentView.readonly || currentView.proc === "none")) {
					await useAppStore.getState().startSession(currentSessionId);
				}
				const model = await getBridge().rpc(currentSessionId, {
					type: "set_model",
					provider: item.modelInfo.provider,
					modelId: item.modelInfo.id,
				});
				updateSessionView(currentSessionId, v => ({
					...v,
					state: v.state ? { ...v.state, model } : null,
				}));
				toast(`已切换到模型 ${model.name || model.id}`, "success");
			} catch (err) {
				toast(err instanceof Error ? err.message : "切换模型失败", "error");
			}
			return;
		}

		switch (item.actionId) {
			case "new-session":
				useAppStore.getState().startWelcome();
				break;
			case "compact":
			case "handoff":
			case "tree":
				window.dispatchEvent(new CustomEvent("header-action", { detail: { action: item.actionId } }));
				break;
			case "fork":
				if (currentSessionId) {
					try {
						await getBridge().rpc(currentSessionId, { type: "fork" });
						await loadSessions();
						toast("已分叉为新会话", "success");
					} catch (err) {
						toast(err instanceof Error ? err.message : "分叉失败", "error");
					}
				}
				break;
			case "export":
				if (currentSessionId) {
					try {
						const res = await getBridge().rpc(currentSessionId, { type: "export_html" });
						const blob = await getBridge().http.downloadExport(res.path);
						const url = URL.createObjectURL(blob);
						const a = document.createElement("a");
						a.href = url;
						a.download = `${currentSessionId}.html`;
						document.body.appendChild(a);
						a.click();
						a.remove();
						URL.revokeObjectURL(url);
						toast("已导出 HTML", "success");
					} catch (err) {
						toast(err instanceof Error ? err.message : "导出失败", "error");
					}
				}
				break;
			case "copy-last":
				if (currentSessionId && currentView) {
					const text = extractLastAssistantText(currentView.messages);
					if (text) {
						await navigator.clipboard.writeText(text);
						toast("已复制最后回答", "success");
					} else {
						toast("当前没有可复制的回答", "info");
					}
				}
				break;
			case "btw":
				window.dispatchEvent(new CustomEvent("open-btw"));
				break;
			case "toggle-sidebar":
				onToggleSidebar?.();
				break;
			case "toggle-panel":
				onTogglePanel?.();
				break;
			case "cycle-theme":
				cycleTheme();
				break;
			case "settings":
				onOpenSettings?.();
				break;
			case "diagnostics":
				if (onOpenDiagnostics) onOpenDiagnostics(currentSessionId ?? undefined);
				else window.dispatchEvent(new CustomEvent("header-action", { detail: { action: "diagnostics" } }));
				break;
		}
	};

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "ArrowDown") {
			e.preventDefault();
			if (flatItems.length > 0) {
				setActiveIndex(i => (i + 1) % flatItems.length);
			}
		} else if (e.key === "ArrowUp") {
			e.preventDefault();
			if (flatItems.length > 0) {
				setActiveIndex(i => (i - 1 + flatItems.length) % flatItems.length);
			}
		} else if (e.key === "Enter") {
			e.preventDefault();
			const target = flatItems[activeIndex];
			if (target) void executeItem(target);
		}
	};

	const currentModelKey = currentView?.state?.model
		? `${currentView.state.model.provider}/${currentView.state.model.id}`
		: null;

	let runningIdx = 0;

	return (
		<DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
			<DialogPrimitive.Portal>
				<DialogPrimitive.Overlay
					className={
						"fixed inset-0 z-50 bg-scrim " +
						"data-[state=open]:animate-[fade-in_0.18s] " +
						"data-[state=closed]:animate-[fade-in_0.12s_reverse]"
					}
				/>
				<DialogPrimitive.Content
					aria-label="命令面板"
					onKeyDown={handleKeyDown}
					className={
						"fixed top-[18vh] left-1/2 z-50 w-[560px] max-w-[calc(100vw-32px)] -translate-x-1/2 overflow-hidden " +
						"rounded-window bg-surface shadow-overlay outline-none " +
						"data-[state=open]:animate-[pop-in_0.18s_var(--ease-out-strong)] " +
						"data-[state=closed]:scale-[0.98] data-[state=closed]:opacity-0 data-[state=closed]:transition-[opacity,transform] data-[state=closed]:duration-120"
					}
				>
					<DialogPrimitive.Title className="sr-only">命令面板</DialogPrimitive.Title>
					{/* Input bar: height 44px (§6.15) */}
					<div className="flex h-11 items-center gap-2.5 border-b border-line px-3.5">
						<Search size={15} strokeWidth={1.8} className="i shrink-0 text-ink-3" />
						<input
							data-bare=""
							ref={inputRef}
							autoFocus
							value={query}
							onChange={e => setQuery(e.target.value)}
							placeholder="搜索会话、执行操作、切换模型…"
							aria-label="命令面板搜索"
							className="min-w-0 flex-1 border-0 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-3 focus-visible:!shadow-none"
						/>
						{query && (
							<button
								type="button"
								aria-label="清除搜索"
								onClick={() => {
									setQuery("");
									inputRef.current?.focus();
								}}
								className="grid size-5 place-items-center rounded-[5px] text-ink-3 hover:bg-hover hover:text-ink-2"
							>
								<X size={13} strokeWidth={2} className="i" />
							</button>
						)}
						<Kbd>Esc</Kbd>
					</div>

					{/* Results (§6.15) */}
					<div
						ref={hl.containerRef}
						onPointerOver={hl.onPointerOver}
						onFocus={hl.onFocus}
						onPointerLeave={hl.onPointerLeave}
						className="relative max-h-[360px] overflow-auto p-1"
					>
						{hl.highlightBlock}
						{groups.map(group => (
							<div key={group.category} className="mb-1 last:mb-0">
								<div className="px-2 pt-2 pb-1 text-[10.5px] font-medium tracking-[0.08em] text-ink-3 uppercase">
									{group.category}
								</div>
								{group.items.map(item => {
									const idx = runningIdx++;
									const isSelected = idx === activeIndex;
									const isCurrentModel =
										item.modelInfo !== undefined &&
										`${item.modelInfo.provider}/${item.modelInfo.id}` === currentModelKey;
									return (
										<button
											key={item.id}
											type="button"
											data-hl-item=""
											{...(isSelected ? { "data-hl-active": "" } : {})}
											onMouseEnter={() => setActiveIndex(idx)}
											onClick={() => void executeItem(item)}
											className={
												"relative z-10 flex h-8 w-full items-center gap-2.5 rounded-[6px] px-2 text-left text-[12.5px] outline-none " +
												(isSelected ? "bg-hover text-ink" : "text-ink")
											}
										>
											{renderItemIcon(item, isCurrentModel)}
											<span className="truncate font-medium text-ink">{item.label}</span>
											{item.subtitle && (
												<span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-ink-2">
													{item.subtitle}
												</span>
											)}
											{item.kbd && <Kbd className="ml-auto shrink-0">{item.kbd}</Kbd>}
										</button>
									);
								})}
							</div>
						))}

						{/* Beautiful UI Search empty state (§6.15) */}
						{groups.length === 0 && (
							<div className="flex flex-col items-center justify-center py-10 text-center">
								<div className="grid size-8 place-items-center rounded-control bg-inset text-ink-3 shadow-hairline">
									<Search size={15} strokeWidth={1.8} className="i" />
								</div>
								<div className="mt-2.5 text-[13px] font-medium text-ink">没有结果</div>
								<div className="mt-0.5 text-[12px] text-ink-2">换个关键词试试</div>
							</div>
						)}
					</div>

					<div className="flex items-center justify-between border-t border-line px-3.5 py-1.5 text-[11px] text-ink-2">
						<span>↑↓ 选择 · Enter 确认 · Esc 关闭</span>
						<span>Ctrl K</span>
					</div>
				</DialogPrimitive.Content>
			</DialogPrimitive.Portal>
		</DialogPrimitive.Root>
	);
}
