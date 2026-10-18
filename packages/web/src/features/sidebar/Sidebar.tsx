import {
	Activity,
	Archive,
	ArchiveRestore,
	ChevronDown,
	Copy,
	Download,
	GitFork,
	MoreHorizontal,
	PanelLeft,
	PenLine,
	Plus,
	Search,
	Settings,
	Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SessionListItem } from "@omp-ui/protocol";
import type { ConnectionState } from "@/lib/ws";
import { useAppStore } from "@/store/app-store";
import { getBridge, updateSessionView } from "@/store/bridge-access";
import type { SessionView } from "@/store/session-reducer";
import { IconButton } from "@/ui/Button";
import { Kbd } from "@/ui/Chip";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
	Menu,
	MenuContent,
	MenuItem,
	MenuSeparator,
	MenuTrigger,
} from "@/ui/Menu";
import { PixelGrid } from "@/ui/PixelGrid";
import { toast } from "@/ui/Toast";
import { useSlidingHighlight } from "@/ui/sliding-highlight";
import { DeleteSessionDialog } from "./DeleteSessionDialog";
import {
	filterSessions,
	formatRelativeTime,
	getAdjacentSessionId,
	getSessionRowStatus,
	groupSessionsByCwd,
	previewGroupSessions,
	SESSION_GROUP_PREVIEW_LIMIT,
	stripPrivateUse,
	type SessionRowStatus,
} from "./sidebar-utils";

const COLLAPSED_GROUPS_KEY = "omp-ui:collapsed-groups";

function loadCollapsedGroups(): Record<string, boolean> {
	try {
		const raw = localStorage.getItem(COLLAPSED_GROUPS_KEY);
		if (!raw) return {};
		const parsed: unknown = JSON.parse(raw);
		return parsed && typeof parsed === "object" ? (parsed as Record<string, boolean>) : {};
	} catch {
		return {};
	}
}

function extractFirstUserPreview(messages: readonly { role: string; content?: unknown }[]): string | null {
	for (const m of messages) {
		if (m.role !== "user") continue;
		if (typeof m.content === "string" && m.content.trim()) {
			return m.content.trim().slice(0, 40);
		}
		if (Array.isArray(m.content)) {
			for (const part of m.content) {
				if (
					part &&
					typeof part === "object" &&
					"type" in part &&
					part.type === "text" &&
					"text" in part &&
					typeof part.text === "string" &&
					part.text.trim()
				) {
					return part.text.trim().slice(0, 40);
				}
			}
		}
	}
	return null;
}

function StatusSlot({ status }: { status: SessionRowStatus }) {
	return (
		<span className="st relative grid w-3.5 shrink-0 place-items-center">
			<span
				className={
					"col-start-1 row-start-1 grid place-items-center transition-opacity duration-150 " +
					(status === "running" ? "opacity-100" : "opacity-0 pointer-events-none")
				}
			>
				{status === "running" && <PixelGrid mode="drive" size="sm" />}
			</span>
			<span
				className={
					"col-start-1 row-start-1 size-1.5 rounded-full bg-orange transition-opacity duration-150 " +
					(status === "waiting" ? "opacity-100 animate-[pulse-dot_1.6s_infinite]" : "opacity-0 pointer-events-none")
				}
			/>
			<span
				className={
					"col-start-1 row-start-1 size-1.5 rounded-full bg-red transition-opacity duration-150 " +
					(status === "error" ? "opacity-100" : "opacity-0 pointer-events-none")
				}
			/>
			<span
				className={
					"col-start-1 row-start-1 size-1.5 rounded-full bg-accent transition-opacity duration-150 " +
					(status === "unread" ? "opacity-100" : "opacity-0 pointer-events-none")
				}
			/>
		</span>
	);
}

export interface SidebarProps {
	onCollapse?: () => void;
	onOpenPalette?: () => void;
	onOpenSettings?: () => void;
	onOpenDiagnostics?: (sessionId?: string) => void;
	/** Optional overrides for gallery/testing */
	sessionsOverride?: readonly SessionListItem[];
	viewsOverride?: Readonly<Record<string, SessionView>>;
	currentSessionIdOverride?: string | null;
	attentionOverride?: Readonly<Record<string, number>>;
	connectionOverride?: ConnectionState;
	ompVersionOverride?: string | null;
	nowMs?: number;
}

export function Sidebar({
	onCollapse,
	onOpenPalette,
	onOpenSettings,
	onOpenDiagnostics,
	sessionsOverride,
	viewsOverride,
	currentSessionIdOverride,
	attentionOverride,
	connectionOverride,
	ompVersionOverride,
	nowMs,
}: SidebarProps = {}) {
	const storeSessions = useAppStore(s => s.sessions);
	const storeViews = useAppStore(s => s.views);
	const storeCurrentId = useAppStore(s => s.currentSessionId);
	const storeAttention = useAppStore(s => s.attention);
	const storeConnection = useAppStore(s => s.connection);
	const storeOmpVersion = useAppStore(s => s.ompVersion);
	const openSession = useAppStore(s => s.openSession);
	const startWelcome = useAppStore(s => s.startWelcome);
	const loadSessions = useAppStore(s => s.loadSessions);

	const sessions = sessionsOverride ?? storeSessions;
	const views = viewsOverride ?? storeViews;
	const currentSessionId = currentSessionIdOverride !== undefined ? currentSessionIdOverride : storeCurrentId;
	const attention = attentionOverride ?? storeAttention;
	const connection = connectionOverride ?? storeConnection;
	const ompVersion = ompVersionOverride !== undefined ? ompVersionOverride : storeOmpVersion;

	const [query, setQuery] = useState("");
	const [showArchived, setShowArchived] = useState(false);
	const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>(loadCollapsedGroups);
	const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
	const [lastSeen, setLastSeen] = useState<Record<string, number>>({});
	const [fallbackTitles, setFallbackTitles] = useState<Record<string, string>>({});
	const [renamingId, setRenamingId] = useState<string | null>(null);
	const [renameText, setRenameText] = useState("");
	const [deleteTarget, setDeleteTarget] = useState<SessionListItem | null>(null);
	const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
	const fetchedPreviewIdsRef = useRef<Record<string, true>>({});

	const hl = useSlidingHighlight<HTMLElement>({ variant: "list", activeKey: `${currentSessionId}:${sessions.length}:${query}` });

	useEffect(() => {
		if (currentSessionId) {
			setLastSeen(prev => ({ ...prev, [currentSessionId]: Date.now() }));
		}
	}, [currentSessionId, attention]);


	// Async fallback title from first user message for untitled sessions (DESIGN §9.2)
	useEffect(() => {
		if (sessionsOverride !== undefined) return;
		for (const s of sessions) {
			if (s.title?.trim() || views[s.id]?.title?.trim() || fallbackTitles[s.id] || fetchedPreviewIdsRef.current[s.id]) {
				continue;
			}
			const localView = views[s.id];
			if (localView && localView.messages.length > 0) {
				const preview = extractFirstUserPreview(localView.messages);
				if (preview) {
					setFallbackTitles(prev => ({ ...prev, [s.id]: preview }));
					continue;
				}
			}
			// Live placeholder (not on disk yet, sizeBytes 0): nothing to fetch; retried once the server lists it.
			if (s.sizeBytes === 0) continue;
			fetchedPreviewIdsRef.current[s.id] = true;
			void getBridge()
				.http.getTranscript(s.id)
				.then(msgs => {
					const preview = extractFirstUserPreview(msgs);
					if (preview) {
						setFallbackTitles(prev => ({ ...prev, [s.id]: preview }));
					}
				})
				.catch(() => undefined);
		}
	}, [sessions, views, fallbackTitles, sessionsOverride]);

	const filtered = useMemo(
		() => filterSessions(sessions, query, { includeArchived: showArchived, fallbackTitles }),
		[sessions, query, showArchived, fallbackTitles],
	);

	const groups = useMemo(() => groupSessionsByCwd(filtered), [filtered]);

	const handleSelectSession = useCallback(
		(item: SessionListItem) => {
			setLastSeen(prev => ({ ...prev, [item.id]: Date.now() }));
			if (sessionsOverride === undefined) {
				void openSession(item);
			}
		},
		[openSession, sessionsOverride],
	);

	// Alt+↑ / Alt+↓ session switcher (DESIGN §12)
	useEffect(() => {
		if (sessionsOverride !== undefined) return;
		const onKeyDown = (e: KeyboardEvent) => {
			if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
			if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
			e.preventDefault();
			const nextId = getAdjacentSessionId(
				groups,
				collapsedGroups,
				currentSessionId,
				e.key === "ArrowUp" ? -1 : 1,
			);
			if (!nextId) return;
			const target = sessions.find(s => s.id === nextId);
			if (target) handleSelectSession(target);
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [groups, collapsedGroups, currentSessionId, sessions, handleSelectSession, sessionsOverride]);

	const toggleGroup = (cwd: string) => {
		setCollapsedGroups(prev => {
			const next = { ...prev, [cwd]: !prev[cwd] };
			// Reopening a workspace starts from the default short list again.
			if (next[cwd]) {
				setExpandedGroups(expanded => {
					if (!expanded[cwd]) return expanded;
					const nextExpanded = { ...expanded };
					delete nextExpanded[cwd];
					return nextExpanded;
				});
			}
			try {
				localStorage.setItem(COLLAPSED_GROUPS_KEY, JSON.stringify(next));
			} catch {
				/* ignore */
			}
			return next;
		});
	};

	const startRename = (item: SessionListItem) => {
		const currentTitle = views[item.id]?.title || item.title || fallbackTitles[item.id] || "";
		setRenamingId(item.id);
		setRenameText(currentTitle);
	};

	const commitRename = async (item: SessionListItem) => {
		const nextName = renameText.trim();
		setRenamingId(null);
		if (!nextName || nextName === item.title) return;
		updateSessionView(item.id, v => ({ ...v, title: nextName }));
		useAppStore.setState(s => ({
			sessions: s.sessions.map(it => (it.id === item.id ? { ...it, title: nextName } : it)),
		}));
		try {
			await getBridge().rpc(item.id, { type: "set_session_name", name: nextName });
			await loadSessions();
		} catch {
			/* session may not be live yet; local state updated */
		}
	};

	const handleForkSession = async (item: SessionListItem) => {
		try {
			await openSession(item);
			const view = useAppStore.getState().views[item.id];
			if (view && (view.readonly || view.proc === "none")) {
				await useAppStore.getState().startSession(item.id);
			}
			await getBridge().rpc(item.id, { type: "fork" });
			await loadSessions();
			toast("已分叉为新会话", "success");
		} catch (err) {
			toast(err instanceof Error ? err.message : "分叉失败", "error");
		}
	};

	const handleExportHtml = async (item: SessionListItem) => {
		try {
			await openSession(item);
			const view = useAppStore.getState().views[item.id];
			if (view && (view.readonly || view.proc === "none")) {
				await useAppStore.getState().startSession(item.id);
			}
			const res = await getBridge().rpc(item.id, { type: "export_html" });
			const blob = await getBridge().http.downloadExport(res.path);
			const url = URL.createObjectURL(blob);
			const a = document.createElement("a");
			a.href = url;
			a.download = `${(item.title || item.id).replace(/[^\w\u4e00-\u9fa5-]+/g, "_")}.html`;
			document.body.appendChild(a);
			a.click();
			a.remove();
			URL.revokeObjectURL(url);
			toast("已导出 HTML", "success");
		} catch (err) {
			toast(err instanceof Error ? err.message : "导出失败", "error");
		}
	};

	const handleArchiveToggle = async (item: SessionListItem) => {
		try {
			if (item.archived) {
				await getBridge().http.unarchiveSession(item.id);
				toast("已取消归档", "info");
			} else {
				await getBridge().http.archiveSession(item.id);
				toast("已归档会话", "info");
			}
			await loadSessions();
		} catch (err) {
			toast(err instanceof Error ? err.message : "操作失败", "error");
		}
	};

	const handleCopyPath = async (item: SessionListItem) => {
		try {
			await navigator.clipboard.writeText(item.file || item.cwd);
			toast("已复制会话路径", "success");
		} catch {
			toast("复制失败", "error");
		}
	};

	const handleConfirmDelete = async (item: SessionListItem) => {
		try {
			await getBridge().http.deleteSession(item.id);
			if (currentSessionId === item.id) {
				useAppStore.setState({ currentSessionId: null });
			}
			await loadSessions();
			toast("会话已移入回收站", "info");
		} catch (err) {
			toast(err instanceof Error ? err.message : "删除失败", "error");
		}
	};


	const renderRowMenuItems = (item: SessionListItem, isRunning: boolean, isContext: boolean) => {
		const ItemComp = isContext ? ContextMenuItem : MenuItem;
		return (
			<>
				<ItemComp icon={<PenLine size={15} strokeWidth={1.8} />} onSelect={() => startRename(item)}>
					重命名
				</ItemComp>
				<ItemComp icon={<GitFork size={15} strokeWidth={1.8} />} onSelect={() => void handleForkSession(item)}>
					分叉为新会话
				</ItemComp>
				<ItemComp icon={<Download size={15} strokeWidth={1.8} />} onSelect={() => void handleExportHtml(item)}>
					导出 HTML
				</ItemComp>
				<ItemComp icon={<Copy size={15} strokeWidth={1.8} />} onSelect={() => void handleCopyPath(item)}>
					复制路径
				</ItemComp>
				<ItemComp
					icon={
						item.archived ? (
							<ArchiveRestore size={15} strokeWidth={1.8} />
						) : (
							<Archive size={15} strokeWidth={1.8} />
						)
					}
					onSelect={() => void handleArchiveToggle(item)}
				>
					{item.archived ? "取消归档" : "归档"}
				</ItemComp>
				<MenuSeparator />
				<ItemComp
					danger
					disabled={isRunning}
					icon={<Trash2 size={15} strokeWidth={1.8} />}
					onSelect={() => setDeleteTarget(item)}
				>
					删除
				</ItemComp>
			</>
		);
	};

	return (
		<aside aria-label="会话" className="side flex h-full min-h-0 flex-col bg-app-side p-2 select-none">
			{/* Top brand row (§6.1) */}
			<div className="flex h-11 shrink-0 items-center gap-2.5 px-1.5">
				<div className="grid size-7 shrink-0 place-items-center rounded-[8px] bg-ink text-[14px] font-semibold text-surface">
					π
				</div>
				<div className="min-w-0">
					<div className="text-[13px] font-medium leading-tight text-ink">omp</div>
					<div className="text-[11.5px] leading-tight text-ink-2">{ompVersion ?? "18.11.1"}</div>
				</div>
				{onCollapse && (
					<IconButton className="ml-auto" label="折叠侧边栏" onClick={onCollapse}>
						<PanelLeft size={15} strokeWidth={1.8} className="i" />
					</IconButton>
				)}
			</div>

			{/* 新对话 button (§6.1) */}
			<button
				type="button"
				onClick={() => startWelcome()}
				className="group my-1 mb-1.5 flex h-8 w-full shrink-0 items-center rounded-control px-2 text-[13px] font-medium text-accent transition-[background-color_0.1s,transform_0.1s] hover:bg-accent-tint active:scale-96"
			>
				<span>新对话</span>
				<Kbd className="ml-auto mr-2 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
					Ctrl N
				</Kbd>
				<span
					className={
						"grid size-4 shrink-0 place-items-center rounded-full bg-accent text-white " +
						"ml-auto group-hover:ml-0"
					}
				>
					<Plus size={9} strokeWidth={3} className="i" />
				</span>
			</button>

			{/* Search (§6.1) */}
			<label className="flex h-8 shrink-0 items-center gap-2 rounded-control bg-inset px-2.5 text-ink-3 shadow-hairline focus-within:ring-1 focus-within:ring-line-strong">
				<Search size={12} strokeWidth={2} className="i shrink-0" />
				<input
					data-bare=""
					value={query}
					onChange={e => setQuery(e.target.value)}
					placeholder="搜索会话"
					aria-label="搜索会话"
					className="min-w-0 flex-1 border-0 bg-transparent text-[12.5px] text-ink outline-none placeholder:text-ink-3 focus-visible:!shadow-none"
				/>
				<button
					type="button"
					onClick={e => {
						e.preventDefault();
						onOpenPalette?.();
					}}
					aria-label="打开命令面板"
					className="shrink-0"
				>
					<Kbd>Ctrl K</Kbd>
				</button>
			</label>

			{/* Session groups & rows (§6.1) */}
			<nav
				ref={hl.containerRef}
				onPointerOver={hl.onPointerOver}
				onFocus={hl.onFocus}
				onPointerLeave={hl.onPointerLeave}
				className="relative mt-1.5 min-h-0 flex-1 overflow-auto"
			>
				{hl.highlightBlock}
				{groups.map(group => {
					const collapsed = Boolean(collapsedGroups[group.cwd]);
					const searching = query.trim().length > 0;
					const expanded = searching || Boolean(expandedGroups[group.cwd]);
					const preview = previewGroupSessions(group.sessions, {
						expanded,
						currentSessionId,
					});
					const showToggle =
						!searching && group.sessions.length > SESSION_GROUP_PREVIEW_LIMIT;
					return (
						<div key={group.cwd}>
							<div
								title={group.cwd}
								className="group/g flex items-center gap-1 px-2 pt-3 pb-1 text-[10.5px] font-medium tracking-[0.08em] text-ink-3 uppercase"
							>
								<button
									type="button"
									onClick={() => toggleGroup(group.cwd)}
									className="truncate text-left hover:text-ink-2"
								>
									{group.label}
								</button>
								<span className="ml-auto flex gap-0.5 opacity-0 transition-opacity duration-100 group-hover/g:opacity-100">
									<button
										type="button"
										aria-label="折叠分组"
										onClick={() => toggleGroup(group.cwd)}
										className="grid size-[18px] place-items-center rounded-[5px] text-ink-3 hover:bg-hover-2 hover:text-ink-2"
									>
										<ChevronDown
											size={10}
											strokeWidth={2.4}
											className={
												"i transition-transform duration-200 " + (collapsed ? "-rotate-90" : "")
											}
										/>
									</button>
									<button
										type="button"
										aria-label="在此项目新建会话"
										onClick={() => startWelcome(group.cwd)}
										className="grid size-[18px] place-items-center rounded-[5px] text-ink-3 hover:bg-hover-2 hover:text-ink-2"
									>
										<Plus size={10} strokeWidth={2.5} className="i" />
									</button>
								</span>
							</div>

							<div className={"grid-collapse " + (collapsed ? "" : "open")}>
								<div>
									{group.sessions.map(item => {
										const isCurrent = item.id === currentSessionId;
										const view = views[item.id];
										const status = getSessionRowStatus(
											view,
											attention[item.id],
											lastSeen[item.id],
											isCurrent,
											item.running,
										);
										const isRunning = status === "running" || status === "waiting";
										const displayTitle =
											stripPrivateUse(
												view?.title ||
													view?.state?.sessionName ||
													item.title ||
													fallbackTitles[item.id] ||
													"",
											) || "新对话";
										const relTime = formatRelativeTime(item.updatedAt, nowMs);

										if (renamingId === item.id) {
											return (
												<div
													key={item.id}
													className="relative z-10 flex h-8 w-full items-center gap-2 rounded-[7px] bg-hover-2 px-2"
												>
													<StatusSlot status={status} />
													<input
														autoFocus
														value={renameText}
														onChange={e => setRenameText(e.target.value)}
														onBlur={() => void commitRename(item)}
														onKeyDown={e => {
															if (e.key === "Enter") {
																e.preventDefault();
																void commitRename(item);
															} else if (e.key === "Escape") {
																e.preventDefault();
																setRenamingId(null);
															}
														}}
														aria-label="会话名称"
														className="min-w-0 flex-1 border-0 border-b border-line-strong bg-transparent text-[13px] font-medium text-ink outline-none"
													/>
												</div>
											);
										}

										const isMenuOpen = menuOpenId === item.id;
										return (
											<ContextMenu
												key={item.id}
												onOpenChange={open =>
													setMenuOpenId(prev => (open ? item.id : prev === item.id ? null : prev))
												}
											>
												<ContextMenuTrigger asChild>
													<div
														data-hl-item=""
														{...(isCurrent ? { "data-hl-active": "" } : {})}
														className={
															"group/row relative z-10 flex h-8 w-full items-center gap-2 rounded-[7px] px-2 transition-colors duration-100 " +
															(isCurrent || isMenuOpen ? "bg-hover-2" : "")
														}
													>
														<button
															type="button"
															aria-current={isCurrent ? "page" : undefined}
															onClick={() => handleSelectSession(item)}
															onDoubleClick={() => startRename(item)}
															className="flex min-w-0 flex-1 items-center gap-2 text-left outline-none transition-transform duration-150 active:scale-[0.98]"
														>
															<StatusSlot status={status} />
															<span
																className={
																	"min-w-0 flex-1 truncate text-[13px] " +
																	(isCurrent ? "font-medium text-ink" : "text-ink-2")
																}
															>
																{displayTitle}
															</span>
														</button>

														<span
															className={
																"shrink-0 text-[11.5px] text-ink-2 group-hover/row:hidden " +
																(isMenuOpen ? "hidden" : "")
															}
														>
															{relTime}
														</span>

														<Menu
															onOpenChange={open =>
																setMenuOpenId(prev => (open ? item.id : prev === item.id ? null : prev))
															}
														>
															<MenuTrigger asChild>
																<button
																	type="button"
																	aria-label="会话操作"
																	onClick={e => e.stopPropagation()}
																	className="hidden size-5 shrink-0 place-items-center rounded-[5px] text-ink-3 hover:text-ink-2 group-hover/row:grid data-[state=open]:grid"
																>
																	<MoreHorizontal size={13} strokeWidth={2.4} className="i" />
																</button>
															</MenuTrigger>
															<MenuContent align="end" width={220}>
																{renderRowMenuItems(item, isRunning, false)}
															</MenuContent>
														</Menu>
													</div>
												</ContextMenuTrigger>
												<ContextMenuContent width={220}>
													{renderRowMenuItems(item, isRunning, true)}
												</ContextMenuContent>
											</ContextMenu>
										);
									})}
									{showToggle && (
										<button
											type="button"
											onClick={() =>
												setExpandedGroups(prev => ({
													...prev,
													[group.cwd]: !prev[group.cwd],
												}))
											}
											className="mt-0.5 flex h-7 w-full items-center rounded-[7px] px-2 text-left text-[12px] text-ink-2 transition-colors hover:bg-hover-2 hover:text-ink"
										>
											{expanded
												? "收起"
												: `展开显示更多${preview.hiddenCount > 0 ? `（还有 ${preview.hiddenCount} 条）` : ""}`}
										</button>
									)}
								</div>
							</div>
						</div>
					);
				})}

				{groups.length === 0 && (
					<div className="px-2 py-8 text-center text-[12px] text-ink-2">
						{query.trim() ? "没有匹配的会话" : "暂无会话"}
					</div>
				)}
			</nav>

			{/* Footer (§6.1) */}
			<div className="mt-auto flex shrink-0 items-center gap-0.5 border-t border-line pt-1.5">
				<IconButton label="设置" onClick={onOpenSettings}>
					<Settings size={15} strokeWidth={1.8} className="i" />
				</IconButton>
				<IconButton
					label="诊断"
					onClick={() => onOpenDiagnostics?.(currentSessionId ?? undefined)}
				>
					<Activity size={15} strokeWidth={1.8} className="i" />
				</IconButton>
				{sessions.some(s => s.archived) && (
					<button
						type="button"
						onClick={() => setShowArchived(v => !v)}
						className={
							"ml-1 rounded-chip px-1.5 py-0.5 text-[11px] transition-colors " +
							(showArchived ? "bg-field text-ink" : "text-ink-2 hover:text-ink")
						}
					>
						{showArchived ? "隐藏归档" : "含归档"}
					</button>
				)}
				<span className="ml-auto flex items-center gap-1.5 pr-1 text-[11.5px] text-ink-2">
					<span
						className={
							"size-1.5 rounded-full " +
							(connection === "connected"
								? "bg-green"
								: connection === "reconnecting"
									? "bg-orange animate-[pulse-dot_1.6s_infinite]"
									: "bg-ink-3")
						}
						aria-hidden="true"
					/>
					<span>
						{connection === "connected"
							? "已连接"
							: connection === "reconnecting"
								? "重连中"
								: "未连接"}
					</span>
				</span>
			</div>

			<DeleteSessionDialog
				session={deleteTarget}
				open={deleteTarget !== null}
				onOpenChange={open => {
					if (!open) setDeleteTarget(null);
				}}
				onConfirm={handleConfirmDelete}
			/>

		</aside>
	);
}
