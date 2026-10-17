import type { ConnectionState } from "@/lib/ws";
import type { SessionView } from "@/store/session-reducer";

export const SIDEBAR_WIDTH_MIN = 220;
export const SIDEBAR_WIDTH_MAX = 360;
export const SIDEBAR_WIDTH_DEFAULT = 264;

export const PANEL_WIDTH_MIN = 280;
export const PANEL_WIDTH_MAX = 640;
export const PANEL_WIDTH_DEFAULT = 380;

export const BREAKPOINT_DESKTOP = 1280;
export const BREAKPOINT_MEDIUM = 1024;

export type LayoutMode = "desktop" | "medium" | "compact";

export function clampSidebarWidth(width: number): number {
	if (!Number.isFinite(width)) return SIDEBAR_WIDTH_DEFAULT;
	return Math.max(SIDEBAR_WIDTH_MIN, Math.min(SIDEBAR_WIDTH_MAX, Math.round(width)));
}

export function clampPanelWidth(width: number): number {
	if (!Number.isFinite(width)) return PANEL_WIDTH_DEFAULT;
	return Math.max(PANEL_WIDTH_MIN, Math.min(PANEL_WIDTH_MAX, Math.round(width)));
}

/**
 * FRONTEND §3 breakpoints:
 * - >= 1280: 3-column desktop
 * - 1024–1279: right panel is overlay drawer
 * - < 1024: sidebar and right panel are both overlay drawers, header shows menu button
 */
export function getLayoutMode(viewportWidth: number): LayoutMode {
	if (viewportWidth >= BREAKPOINT_DESKTOP) return "desktop";
	if (viewportWidth >= BREAKPOINT_MEDIUM) return "medium";
	return "compact";
}

export type ConnectionBannerState = "hidden" | "reconnecting" | "recovered";

/**
 * Computes the next visual state for the top 2px connection bar (FRONTEND §6.17).
 * Shows orange while reconnecting (or closed after having connected),
 * flashes green ("recovered") when transitioning back to connected.
 */
export function nextConnectionBannerState(
	prevConnection: ConnectionState,
	nextConnection: ConnectionState,
	everConnected: boolean,
): ConnectionBannerState {
	if (nextConnection === "reconnecting") return "reconnecting";
	if (nextConnection === "closed") return everConnected ? "reconnecting" : "hidden";
	if (nextConnection === "connected" && (prevConnection === "reconnecting" || (prevConnection === "closed" && everConnected))) {
		return "recovered";
	}
	return "hidden";
}

/**
 * DESIGN §12: count sessions needing user attention (pending UI requests, errors, or unread settled runs).
 */
export function countAttentionSessions(
	views: Record<string, SessionView>,
	attention: Record<string, number>,
	lastSeen: Record<string, number>,
	currentSessionId: string | null,
	pageHidden: boolean,
): number {
	const ids = new Set<string>([...Object.keys(views), ...Object.keys(attention)]);
	let count = 0;
	for (const id of ids) {
		const view = views[id];
		const hasPendingUi = (view?.pendingUi.length ?? 0) > 0;
		const hasError =
			(view?.run.kind === "dead" && view.run.crashed) ||
			(view?.banners.some(b => b.kind === "prompt-error" || b.kind === "retry-failed" || b.kind === "compaction-error") ?? false);
		const settledAt = attention[id] ?? 0;
		const seenAt = lastSeen[id] ?? 0;
		const hasUnreadSettled = settledAt > seenAt && (pageHidden || id !== currentSessionId);
		if (hasPendingUi || hasError || hasUnreadSettled) {
			count += 1;
		}
	}
	return count;
}

/** `(n)` = sessions needing attention; leading `● ` = the current session is processing (visible on the browser tab). */
export function formatDocumentTitle(sessionTitle: string | undefined, attentionCount: number, running = false): string {
	const base = sessionTitle?.trim() ? `${sessionTitle.trim()} — omp` : "omp";
	const withCount = attentionCount > 0 ? `(${attentionCount}) ${base}` : base;
	return running ? `● ${withCount}` : withCount;
}
