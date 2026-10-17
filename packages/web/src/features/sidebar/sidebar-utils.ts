import type { SessionListItem } from "@omp-ui/protocol";
import type { SessionView } from "@/store/session-reducer";

/**
 * Strip Private-Use-Area code points (U+E000–U+F8FF, U+F0000–U+10FFFF), e.g. Nerd Font glyphs that omp
 * puts in titles; without the icon font they render as tofu boxes. Display only, never written back.
 */
export function stripPrivateUse(text: string): string {
	return text.replace(/[\uE000-\uF8FF\u{F0000}-\u{10FFFF}]/gu, "").trim();
}

export type SessionRowStatus = "waiting" | "running" | "error" | "unread" | "idle";

export interface SessionGroup {
	cwd: string;
	label: string;
	sessions: SessionListItem[];
	latestUpdatedAt: number;
}

/** Extract the last path segment from a cwd for group header display (DESIGN §9.2). */
export function cwdGroupLabel(cwd: string): string {
	const normalized = cwd.replace(/[\\/]+$/, "");
	if (!normalized) return cwd || "/";
	const parts = normalized.split(/[\\/]/);
	return parts[parts.length - 1] || normalized;
}

/**
 * Client-side case-insensitive subsequence / substring fuzzy match (DESIGN §9.2).
 * Returns a positive score when matched (higher = tighter match), or 0 when unmatched.
 */
export function fuzzyScore(query: string, target: string): number {
	const q = query.trim().toLowerCase();
	if (!q) return 1;
	const t = target.toLowerCase();
	const exactIdx = t.indexOf(q);
	if (exactIdx !== -1) {
		return 100 - Math.min(exactIdx, 50);
	}
	let qi = 0;
	let consecutive = 0;
	let gap = 0;
	let score = 0;
	for (let ti = 0; ti < t.length && qi < q.length; ti++) {
		if (t[ti] === q[qi]) {
			if (qi > 0 && gap > 5) return 0;
			qi += 1;
			consecutive += 1;
			score += 3 + consecutive * 2 - Math.min(gap, 3);
			gap = 0;
		} else if (qi > 0) {
			gap += 1;
			consecutive = 0;
		}
	}
	return qi === q.length && score > 0 ? score : 0;
}

export function filterSessions(
	sessions: readonly SessionListItem[],
	query: string,
	opts?: { includeArchived?: boolean; fallbackTitles?: Record<string, string> },
): SessionListItem[] {
	const q = query.trim();
	const includeArchived = opts?.includeArchived ?? false;
	const fallbacks = opts?.fallbackTitles ?? {};
	const matched: { item: SessionListItem; score: number }[] = [];

	for (const item of sessions) {
		if (!includeArchived && item.archived) continue;
		if (!q) {
			matched.push({ item, score: 1 });
			continue;
		}
		const title = item.title || fallbacks[item.id] || "";
		const sTitle = fuzzyScore(q, title);
		const sCwd = fuzzyScore(q, item.cwd);
		const best = Math.max(sTitle * 1.2, sCwd);
		if (best > 0) {
			matched.push({ item, score: best });
		}
	}

	return matched.map(m => m.item);
}

/**
 * Group sessions by `cwd`, sorting sessions within each group by `updatedAt` desc
 * and sorting groups by their most recent session's `updatedAt` desc (DESIGN §9.2).
 */
export function groupSessionsByCwd(sessions: readonly SessionListItem[]): SessionGroup[] {
	const byCwd = new Map<string, SessionListItem[]>();
	for (const s of sessions) {
		const list = byCwd.get(s.cwd);
		if (list) list.push(s);
		else byCwd.set(s.cwd, [s]);
	}

	const groups: SessionGroup[] = [];
	for (const [cwd, list] of byCwd) {
		const sorted = [...list].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
		const latestUpdatedAt = sorted.length > 0 ? Date.parse(sorted[0]!.updatedAt) || 0 : 0;
		groups.push({
			cwd,
			label: cwdGroupLabel(cwd),
			sessions: sorted,
			latestUpdatedAt,
		});
	}

	groups.sort((a, b) => b.latestUpdatedAt - a.latestUpdatedAt);
	return groups;
}

/**
 * Derive sidebar row status indicator (FRONTEND §6.1):
 * - waiting: pendingUi non-empty (orange pulse dot)
 * - running: run is running / settling / compacting / retrying, or — for sessions this tab has
 *   not attached — the bridge reports the process mid-run (`SessionListItem.running`) (PixelGrid sm)
 * - error: run is dead(crashed) or error banner present (red dot)
 * - unread: settled attention newer than lastSeen and not current session (accent dot)
 * - idle: none
 */
export function getSessionRowStatus(
	view: SessionView | undefined,
	attentionTs: number | undefined,
	lastSeenTs: number | undefined,
	isCurrent: boolean,
	listedRunning = false,
): SessionRowStatus {
	if (view && !view.readonly) {
		if (view.pendingUi.length > 0) return "waiting";
		const runKind = view.run.kind;
		if (runKind === "running" || runKind === "settling" || runKind === "compacting" || runKind === "retrying") {
			return "running";
		}
		if (
			(runKind === "dead" && view.run.crashed) ||
			view.banners.some(b => b.kind === "prompt-error" || b.kind === "retry-failed" || b.kind === "compaction-error")
		) {
			return "error";
		}
	} else if (listedRunning) {
		return "running";
	}
	if (!isCurrent && attentionTs !== undefined && attentionTs > (lastSeenTs ?? 0)) {
		return "unread";
	}
	return "idle";
}

const WEEKDAYS_ZH = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"] as const;

/**
 * Format relative timestamp matching `prototype/index.html` ("刚刚", "12 分钟", "2 小时", "昨天", "周一", "9月28日").
 */
export function formatRelativeTime(isoOrMs: string | number, nowMs: number = Date.now()): string {
	const ts = typeof isoOrMs === "number" ? isoOrMs : Date.parse(isoOrMs);
	if (!Number.isFinite(ts)) return "";
	const diffSec = Math.max(0, Math.floor((nowMs - ts) / 1000));
	if (diffSec < 60) return "刚刚";
	const diffMin = Math.floor(diffSec / 60);
	if (diffMin < 60) return `${diffMin} 分钟`;
	const diffHr = Math.floor(diffMin / 60);
	if (diffHr < 24) return `${diffHr} 小时`;
	const diffDays = Math.floor(diffHr / 24);
	if (diffDays === 1) return "昨天";
	const date = new Date(ts);
	if (diffDays < 7) {
		return WEEKDAYS_ZH[date.getDay()] ?? "昨天";
	}
	return `${date.getMonth() + 1}月${date.getDate()}日`;
}

/**
 * Compute next/previous session ID in visual group order for `Alt+↑` / `Alt+↓` (DESIGN §12).
 */
export function getAdjacentSessionId(
	groups: readonly SessionGroup[],
	collapsedCwds: Readonly<Record<string, boolean>>,
	currentSessionId: string | null,
	direction: -1 | 1,
): string | null {
	const flat: string[] = [];
	for (const g of groups) {
		if (collapsedCwds[g.cwd]) continue;
		for (const s of g.sessions) flat.push(s.id);
	}
	if (flat.length === 0) return null;
	if (!currentSessionId) return direction === 1 ? flat[0]! : flat[flat.length - 1]!;
	const idx = flat.indexOf(currentSessionId);
	if (idx === -1) return flat[0]!;
	const nextIdx = (idx + direction + flat.length) % flat.length;
	return flat[nextIdx] ?? null;
}
