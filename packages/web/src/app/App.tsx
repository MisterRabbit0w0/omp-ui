import { useCallback, useEffect, useRef, useState } from "react";
import { Composer, UiRequestLayer } from "@/features/composer";
import { DiagnosticsDialog, SessionHeader } from "@/features/header";
import { CommandPalette } from "@/features/palette";
import { PanelOverlays, SidePanel } from "@/features/panel";
import { applyAppearancePrefs, loadAppearancePrefs, SettingsDialog, type SettingsTab } from "@/features/settings";
import { countAttentionSessions, formatDocumentTitle } from "@/features/shell";
import { Sidebar } from "@/features/sidebar";
import { stripPrivateUse } from "@/features/sidebar/sidebar-utils";
import { EmptySession, Transcript } from "@/features/transcript";
import { GalleryPage } from "@/gallery/GalleryPage";
import { resolveBridgeToken } from "@/lib/ws";
import { useAppStore } from "@/store/app-store";
import { Toaster, toast } from "@/ui/Toast";
import { AppShell } from "./AppShell";

export function App() {
	if (typeof window !== "undefined" && window.location.pathname === "/gallery") {
		return <GalleryPage />;
	}
	return <WorkspaceApp />;
}

function WorkspaceApp() {
	const currentSessionId = useAppStore(s => s.currentSessionId);
	const sessions = useAppStore(s => s.sessions);
	const views = useAppStore(s => s.views);
	const attention = useAppStore(s => s.attention);
	const config = useAppStore(s => s.config);
	const storeToasts = useAppStore(s => s.toasts);
	const dismissStoreToast = useAppStore(s => s.dismissToast);

	const [paletteOpen, setPaletteOpen] = useState(false);
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [settingsTab, setSettingsTab] = useState<SettingsTab>("defaults");
	const [diagSessionId, setDiagSessionId] = useState<string | null>(null);
	const [diagOpen, setDiagOpen] = useState(false);
	const [lastSeen, setLastSeen] = useState<Record<string, number>>({});
	const [pageHidden, setPageHidden] = useState<boolean>(() =>
		typeof document !== "undefined" ? document.hidden : false,
	);

	const prevAttentionRef = useRef<Record<string, number>>({});
	const prevPendingUiCountRef = useRef<Record<string, number>>({});

	// Bootstrap token, appearance prefs, and app store once on mount
	useEffect(() => {
		resolveBridgeToken();
		applyAppearancePrefs(loadAppearancePrefs());
		useAppStore.getState().init();
	}, []);

	// Bridge store toast queue into UI Toaster (§6.17)
	useEffect(() => {
		for (const t of storeToasts) {
			const kind = t.level === "error" ? "error" : "info";
			toast(t.message, kind);
			dismissStoreToast(t.id);
		}
	}, [storeToasts, dismissStoreToast]);

	// Track page visibility for desktop notifications and (n) document title prefix (DESIGN §12)
	useEffect(() => {
		const onVisChange = () => {
			const hidden = document.hidden;
			setPageHidden(hidden);
			if (!hidden && currentSessionId) {
				setLastSeen(prev => ({ ...prev, [currentSessionId]: Date.now() }));
			}
		};
		document.addEventListener("visibilitychange", onVisChange);
		return () => document.removeEventListener("visibilitychange", onVisChange);
	}, [currentSessionId]);

	// Mark active session seen when viewed while page is visible
	useEffect(() => {
		if (!pageHidden && currentSessionId) {
			setLastSeen(prev => ({ ...prev, [currentSessionId]: Date.now() }));
		}
	}, [currentSessionId, pageHidden]);

	// Desktop notifications when page is hidden and session settles or awaits UI (DESIGN §12)
	useEffect(() => {
		const canNotify =
			pageHidden &&
			(config?.notifications ?? true) &&
			typeof Notification !== "undefined" &&
			Notification.permission === "granted";

		for (const [sid, ts] of Object.entries(attention)) {
			const prevTs = prevAttentionRef.current[sid] ?? 0;
			if (ts > prevTs && canNotify) {
				const title =
					views[sid]?.title ||
					sessions.find(s => s.id === sid)?.title ||
					"omp 会话已完成";
				try {
					new Notification(title, { body: "当前回合已完成，点击返回查看。" });
				} catch {
					/* ignore notification errors in headless/restricted environments */
				}
			}
		}
		prevAttentionRef.current = { ...attention };

		for (const [sid, v] of Object.entries(views)) {
			const prevCount = prevPendingUiCountRef.current[sid] ?? 0;
			const nextCount = v.pendingUi.length;
			if (nextCount > prevCount && canNotify) {
				const title = v.title || sessions.find(s => s.id === sid)?.title || "omp 等待你的回应";
				try {
					new Notification(title, { body: "有工具权限或问题需要你确认。" });
				} catch {
					/* ignore */
				}
			}
			prevPendingUiCountRef.current[sid] = nextCount;
		}
	}, [attention, views, sessions, pageHidden, config?.notifications]);

	// Document title with `(n)` attention badge prefix (DESIGN §12)
	useEffect(() => {
		const currentView = currentSessionId ? views[currentSessionId] : undefined;
		const currentItem = sessions.find(s => s.id === currentSessionId);
		const sessionTitle = stripPrivateUse(currentView?.title || currentView?.state?.sessionName || currentItem?.title || "");
		const count = countAttentionSessions(views, attention, lastSeen, currentSessionId, pageHidden);
		const runKind = currentView?.run.kind;
		const running = runKind === "running" || runKind === "settling" || runKind === "compacting" || runKind === "retrying";
		document.title = formatDocumentTitle(sessionTitle, count, running);
	}, [views, attention, lastSeen, currentSessionId, pageHidden, sessions]);

	// Global keyboard shortcuts: Ctrl+K (command palette), Ctrl+N (new session) (DESIGN §12)
	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
			const key = e.key.toLowerCase();
			if (key === "k") {
				e.preventDefault();
				setPaletteOpen(v => !v);
			} else if (key === "n") {
				e.preventDefault();
				useAppStore.getState().startWelcome();
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, []);

	const openSettings = useCallback((tab?: string) => {
		if (
			tab === "accounts" ||
			tab === "defaults" ||
			tab === "session" ||
			tab === "appearance" ||
			tab === "notifications" ||
			tab === "shortcuts"
		) {
			setSettingsTab(tab);
		} else {
			setSettingsTab("defaults");
		}
		setSettingsOpen(true);
	}, []);

	const openDiagnostics = useCallback(
		(sid?: string) => {
			setDiagSessionId(sid ?? currentSessionId);
			setDiagOpen(true);
		},
		[currentSessionId],
	);

	const currentItem = sessions.find(s => s.id === currentSessionId);
	const currentCwd = currentSessionId ? (currentItem?.cwd ?? config?.recentProjects?.[0] ?? null) : null;
	const currentView = currentSessionId ? views[currentSessionId] : undefined;
	const isEmptyWelcome =
		currentSessionId === null ||
		(currentView !== undefined && currentView.messages.length === 0 && currentView.drafts.size === 0);

	const composerNode = <Composer sessionId={currentSessionId} cwd={currentCwd} />;

	return (
		<>
			<AppShell
				sidebar={ctx => (
					<Sidebar
						onCollapse={ctx.toggleSidebar}
						onOpenPalette={() => setPaletteOpen(true)}
						onOpenSettings={() => openSettings("defaults")}
						onOpenDiagnostics={openDiagnostics}
					/>
				)}
				header={ctx => (
					<SessionHeader
						sessionId={currentSessionId}
						scrolled={ctx.scrolled}
						showSidebarToggle={ctx.layoutMode === "compact" || !ctx.sidebarOpen}
						onToggleSidebar={ctx.toggleSidebar}
						onTogglePanel={ctx.togglePanel}
						onOpenSettings={openSettings}
						onOpenDiagnostics={openDiagnostics}
					/>
				)}
				content={
					isEmptyWelcome ? (
						<div className="scroll h-full overflow-auto">
							<EmptySession
								sessionId={currentSessionId}
								cwd={currentCwd}
							>
								{composerNode}
							</EmptySession>
						</div>
					) : (
						// Keyed: each session gets fresh virtualizer measurements and scroll state.
						<Transcript key={currentSessionId} sessionId={currentSessionId} />
					)
				}
				composer={isEmptyWelcome ? undefined : composerNode}
				panel={currentSessionId ? <SidePanel sessionId={currentSessionId} /> : undefined}
			/>

			{currentSessionId && <UiRequestLayer sessionId={currentSessionId} suppressOAuthInput={settingsOpen} />}
			<PanelOverlays sessionId={currentSessionId} />

			<CommandPalette
				open={paletteOpen}
				onOpenChange={setPaletteOpen}
				onOpenSettings={openSettings}
				onOpenDiagnostics={openDiagnostics}
			/>

			<SettingsDialog
				open={settingsOpen}
				onOpenChange={setSettingsOpen}
				initialTab={settingsTab}
			/>

			<DiagnosticsDialog
				sessionId={diagSessionId ?? currentSessionId}
				open={diagOpen}
				onOpenChange={setDiagOpen}
			/>

			<Toaster />
		</>
	);
}
