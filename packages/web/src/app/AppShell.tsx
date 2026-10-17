import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ConnectionBar } from "@/features/shell/ConnectionBar";
import {
	clampPanelWidth,
	clampSidebarWidth,
	getLayoutMode,
	PANEL_WIDTH_DEFAULT,
	SIDEBAR_WIDTH_DEFAULT,
	type LayoutMode,
} from "@/features/shell/shell-state";

const SIDEBAR_WIDTH_KEY = "omp-ui:sidebar-width";
const PANEL_WIDTH_KEY = "omp-ui:panel-width";
const SIDEBAR_OPEN_KEY = "omp-ui:sidebar-open";
const PANEL_OPEN_KEY = "omp-ui:panel-open";

function readNumberStorage(key: string, fallback: number, clamp: (v: number) => number): number {
	try {
		const raw = localStorage.getItem(key);
		if (!raw) return fallback;
		const parsed = Number(raw);
		return Number.isFinite(parsed) ? clamp(parsed) : fallback;
	} catch {
		return fallback;
	}
}

function readBoolStorage(key: string, fallback: boolean): boolean {
	try {
		const raw = localStorage.getItem(key);
		if (raw === "true") return true;
		if (raw === "false") return false;
		return fallback;
	} catch {
		return fallback;
	}
}

export interface AppShellRenderContext {
	sidebarOpen: boolean;
	panelOpen: boolean;
	scrolled: boolean;
	layoutMode: LayoutMode;
	toggleSidebar: () => void;
	togglePanel: () => void;
	openPanel: () => void;
}

export interface AppShellProps {
	sidebar?: ReactNode | ((ctx: AppShellRenderContext) => ReactNode);
	header?: ReactNode | ((ctx: AppShellRenderContext) => ReactNode);
	content?: ReactNode;
	composer?: ReactNode;
	panel?: ReactNode;
	/** Whether content provides its own scroll container (Transcript does). Default true. */
	contentSelfScrolls?: boolean;
}

export function AppShell({
	sidebar,
	header,
	content,
	composer,
	panel,
	contentSelfScrolls = true,
}: AppShellProps) {
	const [layoutMode, setLayoutMode] = useState<LayoutMode>(() =>
		typeof window !== "undefined" ? getLayoutMode(window.innerWidth) : "desktop",
	);

	const [sidebarWidth, setSidebarWidth] = useState<number>(() =>
		readNumberStorage(SIDEBAR_WIDTH_KEY, SIDEBAR_WIDTH_DEFAULT, clampSidebarWidth),
	);
	const [panelWidth, setPanelWidth] = useState<number>(() =>
		readNumberStorage(PANEL_WIDTH_KEY, PANEL_WIDTH_DEFAULT, clampPanelWidth),
	);

	const [sidebarOpen, setSidebarOpen] = useState<boolean>(() => readBoolStorage(SIDEBAR_OPEN_KEY, true));
	const [panelOpen, setPanelOpen] = useState<boolean>(() => readBoolStorage(PANEL_OPEN_KEY, true));

	// Panel enter/exit transition state (§3: translateX(±12px) + opacity 220ms, grid track width animates in step)
	const [sidebarMounted, setSidebarMounted] = useState<boolean>(sidebarOpen);
	const [sidebarVisible, setSidebarVisible] = useState<boolean>(sidebarOpen);
	const [panelMounted, setPanelMounted] = useState<boolean>(panelOpen);
	const [panelVisible, setPanelVisible] = useState<boolean>(panelOpen);

	const [scrolled, setScrolled] = useState(false);
	const [resizing, setResizing] = useState(false);

	useEffect(() => {
		const onResize = () => {
			setLayoutMode(getLayoutMode(window.innerWidth));
		};
		window.addEventListener("resize", onResize);
		return () => window.removeEventListener("resize", onResize);
	}, []);

	// Sync sidebar enter/exit 220ms animation
	useEffect(() => {
		try {
			localStorage.setItem(SIDEBAR_OPEN_KEY, String(sidebarOpen));
		} catch {
			/* ignore */
		}
		if (sidebarOpen) {
			setSidebarMounted(true);
			// Two frames so the collapsed (0px / opacity 0) state is committed before transitioning.
			let id = requestAnimationFrame(() => {
				id = requestAnimationFrame(() => setSidebarVisible(true));
			});
			return () => cancelAnimationFrame(id);
		}
		setSidebarVisible(false);
		const timer = setTimeout(() => setSidebarMounted(false), 220);
		return () => clearTimeout(timer);
	}, [sidebarOpen]);

	// Sync right panel enter/exit 220ms animation
	useEffect(() => {
		try {
			localStorage.setItem(PANEL_OPEN_KEY, String(panelOpen));
		} catch {
			/* ignore */
		}
		if (panelOpen) {
			setPanelMounted(true);
			let id = requestAnimationFrame(() => {
				id = requestAnimationFrame(() => setPanelVisible(true));
			});
			return () => cancelAnimationFrame(id);
		}
		setPanelVisible(false);
		const timer = setTimeout(() => setPanelMounted(false), 220);
		return () => clearTimeout(timer);
	}, [panelOpen]);

	const toggleSidebar = useCallback(() => setSidebarOpen(v => !v), []);
	const togglePanel = useCallback(() => setPanelOpen(v => !v), []);
	const openPanel = useCallback(() => setPanelOpen(true), []);

	// Keyboard shortcuts: Ctrl+B (sidebar) / Ctrl+. (right panel) (FRONTEND §3, DESIGN §12)
	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
			if (e.key.toLowerCase() === "b") {
				e.preventDefault();
				toggleSidebar();
			} else if (e.key === ".") {
				e.preventDefault();
				togglePanel();
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [toggleSidebar, togglePanel]);

	// Custom events from Transcript / Panel ("open-panel", "open-panel-tab")
	useEffect(() => {
		const onOpenPanelEvent = () => setPanelOpen(true);
		const onTranscriptScroll = (e: Event) => {
			if (e instanceof CustomEvent && e.detail && typeof e.detail === "object" && "scrolled" in e.detail && typeof e.detail.scrolled === "boolean") {
				setScrolled(e.detail.scrolled);
			}
		};
		window.addEventListener("open-panel", onOpenPanelEvent);
		window.addEventListener("open-panel-tab", onOpenPanelEvent);
		window.addEventListener("transcript-scroll", onTranscriptScroll);
		return () => {
			window.removeEventListener("open-panel", onOpenPanelEvent);
			window.removeEventListener("open-panel-tab", onOpenPanelEvent);
			window.removeEventListener("transcript-scroll", onTranscriptScroll);
		};
	}, []);

	// Drag resize handlers (6px handle, persisted)
	const startResize = (target: "sidebar" | "panel", e: React.PointerEvent) => {
		e.preventDefault();
		setResizing(true);
		const startX = e.clientX;
		const initialWidth = target === "sidebar" ? sidebarWidth : panelWidth;
		document.body.style.cursor = "col-resize";
		document.body.style.userSelect = "none";

		const onMove = (ev: PointerEvent) => {
			if (target === "sidebar") {
				const next = clampSidebarWidth(initialWidth + (ev.clientX - startX));
				setSidebarWidth(next);
				try {
					localStorage.setItem(SIDEBAR_WIDTH_KEY, String(next));
				} catch {
					/* ignore */
				}
			} else {
				const next = clampPanelWidth(initialWidth - (ev.clientX - startX));
				setPanelWidth(next);
				try {
					localStorage.setItem(PANEL_WIDTH_KEY, String(next));
				} catch {
					/* ignore */
				}
			}
		};

		const onUp = () => {
			setResizing(false);
			document.body.style.cursor = "";
			document.body.style.userSelect = "";
			window.removeEventListener("pointermove", onMove);
			window.removeEventListener("pointerup", onUp);
		};

		window.addEventListener("pointermove", onMove);
		window.addEventListener("pointerup", onUp);
	};

	const handleScrollCapture = useCallback((e: React.UIEvent<HTMLElement>) => {
		const target = e.target;
		if (target instanceof HTMLElement) {
			setScrolled(target.scrollTop > 4);
		}
	}, []);

	const ctx: AppShellRenderContext = {
		sidebarOpen,
		panelOpen,
		scrolled,
		layoutMode,
		toggleSidebar,
		togglePanel,
		openPanel,
	};

	const resolvedSidebar = typeof sidebar === "function" ? sidebar(ctx) : sidebar;
	const resolvedHeader = typeof header === "function" ? header(ctx) : header;

	const inlineSidebar = layoutMode !== "compact" && sidebarMounted;
	const inlinePanel = layoutMode === "desktop" && panelMounted && panel !== undefined;
	const drawerSidebar = layoutMode === "compact" && sidebarMounted;
	const drawerPanel = layoutMode !== "desktop" && panelMounted && panel !== undefined;

	const sidebarTrack = inlineSidebar && sidebarVisible ? `${sidebarWidth}px 1px` : "0px 0px";
	const panelTrack = inlinePanel && panelVisible ? `1px ${panelWidth}px` : "0px 0px";
	const gridCols = `${sidebarTrack} minmax(0, 1fr) ${panelTrack}`;

	return (
		<div
			className="app relative grid h-dvh w-full overflow-hidden bg-app-main"
			style={{
				gridTemplateColumns: gridCols,
				transition: resizing ? "none" : "grid-template-columns 220ms var(--ease-out-strong)",
			}}
		>
			{/* Inline Sidebar (desktop & medium) */}
			{inlineSidebar ? (
				<>
					<div
						className={
							"min-h-0 overflow-hidden bg-app-side transition-[opacity,transform] duration-[220ms] ease-out-strong " +
							(sidebarVisible ? "translate-x-0 opacity-100" : "-translate-x-3 opacity-0")
						}
					>
						{/* Fixed inner width: content doesn't reflow while the track animates */}
						<div className="h-full" style={{ width: sidebarWidth }}>
							{resolvedSidebar}
						</div>
					</div>
					<div className="vsep relative z-20 bg-line">
						<div
							role="separator"
							aria-orientation="vertical"
							aria-label="调整侧边栏宽度"
							onPointerDown={e => startResize("sidebar", e)}
							className="group absolute inset-y-0 -left-[2.5px] w-1.5 cursor-col-resize"
						>
							<span className="mx-auto block h-full w-0.5 bg-transparent transition-colors duration-100 group-hover:bg-line-strong" />
						</div>
					</div>
				</>
			) : (
				<>
					<div />
					<div />
				</>
			)}

			{/* Main Conversation Column */}
			<main
				onScrollCapture={handleScrollCapture}
				className="main relative flex min-h-0 min-w-0 flex-col bg-app-main"
			>
				<ConnectionBar />
				{resolvedHeader}

				{contentSelfScrolls ? (
					<div className="flex min-h-0 flex-1 flex-col overflow-hidden">{content}</div>
				) : (
					<div className="scroll min-h-0 flex-1 overflow-auto">
						<div className="col mx-auto max-w-[820px] px-6 pt-4 pb-44">{content}</div>
					</div>
				)}

				{/* Floating Composer Dock (§3) */}
				{composer !== undefined && (
					<div className="dock pointer-events-none absolute inset-x-0 bottom-0 z-20">
						<div className="pointer-events-none absolute inset-x-0 -top-8 h-8 bg-gradient-to-t from-app-main to-transparent" />
						<div className="pointer-events-auto mx-auto max-w-[820px] px-6 pb-4">{composer}</div>
					</div>
				)}
			</main>

			{/* Inline Right Panel (desktop >= 1280) */}
			{inlinePanel ? (
				<>
					<div className="vsep r relative z-20 bg-line">
						<div
							role="separator"
							aria-orientation="vertical"
							aria-label="调整右侧面板宽度"
							onPointerDown={e => startResize("panel", e)}
							className="group absolute inset-y-0 -left-[2.5px] w-1.5 cursor-col-resize"
						>
							<span className="mx-auto block h-full w-0.5 bg-transparent transition-colors duration-100 group-hover:bg-line-strong" />
						</div>
					</div>
					<aside
						aria-label="面板"
						className={
							"right flex min-h-0 flex-col items-end overflow-hidden bg-app-side transition-[opacity,transform] duration-[220ms] ease-out-strong " +
							(panelVisible ? "translate-x-0 opacity-100" : "translate-x-3 opacity-0")
						}
					>
						<div className="flex min-h-0 min-w-0 flex-1 flex-col" style={{ width: panelWidth }}>
							{panel}
						</div>
					</aside>
				</>
			) : (
				<>
					<div />
					<div />
				</>
			)}

			{/* Overlay Drawer: Sidebar (< 1024) */}
			{drawerSidebar && (
				<div className="fixed inset-0 z-40 flex">
					<div
						onClick={() => setSidebarOpen(false)}
						className={
							"fixed inset-0 bg-scrim transition-opacity duration-180 " +
							(sidebarVisible ? "opacity-100" : "opacity-0")
						}
					/>
					<div
						style={{ width: sidebarWidth }}
						className={
							"relative z-10 flex h-full flex-col bg-app-side shadow-overlay transition-[opacity,transform] duration-[220ms] ease-out-strong " +
							(sidebarVisible ? "translate-x-0 opacity-100" : "-translate-x-3 opacity-0")
						}
					>
						{resolvedSidebar}
					</div>
				</div>
			)}

			{/* Overlay Drawer: Right Panel (1024–1279 and < 1024) */}
			{drawerPanel && (
				<div className="fixed inset-0 z-40 flex justify-end">
					<div
						onClick={() => setPanelOpen(false)}
						className={
							"fixed inset-0 bg-scrim transition-opacity duration-180 " +
							(panelVisible ? "opacity-100" : "opacity-0")
						}
					/>
					<aside
						aria-label="面板"
						style={{ width: panelWidth }}
						className={
							"relative z-10 flex h-full flex-col bg-app-side shadow-overlay transition-[opacity,transform] duration-[220ms] ease-out-strong " +
							(panelVisible ? "translate-x-0 opacity-100" : "translate-x-3 opacity-0")
						}
					>
						{panel}
					</aside>
				</div>
			)}
		</div>
	);
}
