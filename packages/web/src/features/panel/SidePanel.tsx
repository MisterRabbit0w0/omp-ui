import { useEffect, useState } from "react";
import { useAppStore } from "@/store/app-store";
import { useSessionView } from "@/store/hooks";
import type { SessionView } from "@/store/session-reducer";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/Tabs";
import { ChangesTab, type FileFocusRequest } from "./ChangesTab";
import { GoalTab } from "./GoalTab";
import { InfoTab } from "./InfoTab";
import {
	computeTabDots,
	computeTabSignatures,
	createEmptySeenSignatures,
	markTabSeen,
	normalizePanelTabId,
	PANEL_TABS,
	type PanelTabId,
	type TabSignatures,
} from "./panel-logic";
import { PanelOverlays } from "./PanelOverlays";
import { SubagentsTab } from "./SubagentsTab";
import { TodoTab } from "./TodoTab";

export interface SidePanelProps {
	sessionId: string;
	/** Optional initial tab (defaults to "todo"). */
	defaultTab?: PanelTabId;
	/** Optional explicit view override (for gallery/isolated tests). */
	view?: SessionView;
	/** Mount portal drawers inside SidePanel (defaults to true; deduplicated with root PanelOverlays). */
	includeOverlays?: boolean;
	className?: string;
}

export interface OpenPanelEventDetail {
	tab?: string;
	file?: string;
	filePath?: string;
	path?: string;
	toolCallId?: string;
	sessionId?: string | null;
}

/**
 * FRONTEND §6.16 Right-side panel (`SidePanel`):
 * - Tabs: 待办 / 子代理 / 变更 / 目标 / 信息 with 6px accent new-content dot.
 * - Content padding 12 (`p-3 pt-1`), cards gap 8 (`gap-2`).
 * - Flashes header on `todoFlash[sessionId]`.
 */
export function SidePanel({
	sessionId,
	defaultTab = "todo",
	view: propView,
	includeOverlays = true,
	className,
}: SidePanelProps) {
	const storeView = useSessionView(sessionId);
	const view = propView ?? storeView;
	const todoFlashAt = useAppStore(s => s.todoFlash[sessionId]);

	const [activeTab, setActiveTab] = useState<PanelTabId>(defaultTab);
	const [seenBySession, setSeenBySession] = useState<Record<string, TabSignatures>>({});
	const [focusRequest, setFocusRequest] = useState<FileFocusRequest | null>(null);
	const [todoHeaderFlash, setTodoHeaderFlash] = useState(false);

	const currentSignatures = computeTabSignatures(view, todoFlashAt);
	const sessionSeen = seenBySession[sessionId] ?? createEmptySeenSignatures();
	const dots = computeTabDots(sessionSeen, currentSignatures, activeTab);

	// Keep the currently active tab's signature marked as seen.
	useEffect(() => {
		setSeenBySession(prev => {
			const existing = prev[sessionId] ?? createEmptySeenSignatures();
			const updated = markTabSeen(existing, currentSignatures, activeTab);
			if (updated === existing && prev[sessionId] !== undefined) return prev;
			return { ...prev, [sessionId]: updated };
		});
	}, [
		sessionId,
		activeTab,
		currentSignatures.todo,
		currentSignatures.subagents,
		currentSignatures.changes,
		currentSignatures.goal,
		currentSignatures.info,
	]);

	// Flash the header when `todo_reminder` updates `todoFlash[sessionId]` (FRONTEND §6.16, DESIGN §9.7).
	useEffect(() => {
		if (!todoFlashAt) return;
		setTodoHeaderFlash(true);
		const timer = setTimeout(() => setTodoHeaderFlash(false), 900);
		return () => clearTimeout(timer);
	}, [todoFlashAt]);

	// Listen for `open-panel` / `open-panel-tab` events from Transcript (e.g. clicking diff chip or todo summary).
	useEffect(() => {
		const handleOpenPanel = (ev: Event) => {
			const detail = (ev as CustomEvent<OpenPanelEventDetail | undefined>).detail;
			if (!detail) return;
			if (detail.sessionId && detail.sessionId !== sessionId) return;
			const targetTab = normalizePanelTabId(detail.tab);
			if (targetTab) {
				setActiveTab(targetTab);
			}
			const fileTarget = detail.filePath ?? detail.file ?? detail.path;
			if (fileTarget) {
				setFocusRequest(prev => ({ path: fileTarget, nonce: (prev?.nonce ?? 0) + 1 }));
				if (!targetTab) setActiveTab("changes");
			}
		};
		window.addEventListener("open-panel", handleOpenPanel);
		window.addEventListener("open-panel-tab", handleOpenPanel);
		return () => {
			window.removeEventListener("open-panel", handleOpenPanel);
			window.removeEventListener("open-panel-tab", handleOpenPanel);
		};
	}, [sessionId]);

	return (
		<aside
			aria-label="面板"
			className={"flex h-full min-h-0 min-w-0 flex-col bg-app-side " + (className ?? "")}
		>
			<Tabs
				value={activeTab}
				onValueChange={val => {
					const normalized = normalizePanelTabId(val);
					if (normalized) setActiveTab(normalized);
				}}
				className="flex min-h-0 min-w-0 flex-1 flex-col"
			>
				<TabsList
					className={
						"transition-colors duration-200 " +
						(todoHeaderFlash ? "bg-orange-tint animate-[pulse-dot_0.45s_ease-in-out_2]" : "")
					}
				>
					{PANEL_TABS.map(tab => (
						<TabsTrigger key={tab.id} value={tab.id} dot={dots[tab.id]}>
							<span
								className={
									tab.id === "todo" && todoHeaderFlash ? "font-medium text-orange-ink" : undefined
								}
							>
								{tab.label}
							</span>
						</TabsTrigger>
					))}
				</TabsList>

				<div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-auto px-3 pt-1 pb-3">
					<TabsContent value="todo" className="m-0 min-w-0 outline-none">
						<TodoTab sessionId={sessionId} view={view} />
					</TabsContent>
					<TabsContent value="subagents" className="m-0 min-w-0 outline-none">
						<SubagentsTab sessionId={sessionId} view={view} />
					</TabsContent>
					<TabsContent value="changes" className="m-0 min-w-0 outline-none">
						<ChangesTab view={view} focusRequest={focusRequest} />
					</TabsContent>
					<TabsContent value="goal" className="m-0 min-w-0 outline-none">
						<GoalTab sessionId={sessionId} view={view} />
					</TabsContent>
					<TabsContent value="info" className="m-0 min-w-0 outline-none">
						<InfoTab sessionId={sessionId} view={view} />
					</TabsContent>
				</div>
			</Tabs>

			{includeOverlays && <PanelOverlays sessionId={sessionId} />}
		</aside>
	);
}
