import type { AgentMessage, SubagentMessages } from "@omp-ui/protocol";
import type { SubagentView } from "@/store/session-reducer";

export interface SubagentDetailRow {
	label: string;
	value: string;
}

export interface OpenSubagentEventDetail {
	sessionId?: string | null;
	subagentId: string;
}

export const OPEN_SUBAGENT_EVENT = "open-subagent";

export function openSubagentDrawer(sessionId: string | null | undefined, subagentId: string): void {
	if (typeof window === "undefined") return;
	window.dispatchEvent(
		new CustomEvent<OpenSubagentEventDetail>(OPEN_SUBAGENT_EVENT, {
			detail: { sessionId: sessionId ?? null, subagentId },
		}),
	);
}

/** Format token count compactly (e.g. 34000 -> "34k", 2100 -> "2.1k", 84200 -> "84.2k"). */
export function formatCompactTokens(tokens: number): string {
	if (!Number.isFinite(tokens) || tokens < 0) return "0";
	if (tokens < 1000) return `${Math.round(tokens)}`;
	if (tokens >= 1_000_000) {
		const m = tokens / 1_000_000;
		return `${m % 1 === 0 ? m.toFixed(0) : m.toFixed(1).replace(/\.0$/, "")}M`;
	}
	const k = tokens / 1000;
	return `${k % 1 === 0 ? k.toFixed(0) : k.toFixed(1).replace(/\.0$/, "")}k`;
}

/** Extract right-side summary string (e.g. "12 轮 · 34k") from SubagentView.progress. */
export function extractSubagentMeta(progress?: Record<string, unknown>): string | null {
	if (!progress) return null;
	if (typeof progress.summary === "string" && progress.summary.trim().length > 0) {
		return progress.summary.trim();
	}
	const parts: string[] = [];
	const turns = progress.turns ?? progress.turnCount ?? progress.turn;
	if (typeof turns === "number" && Number.isFinite(turns) && turns > 0) {
		parts.push(`${turns} 轮`);
	}
	const tokens = progress.tokens ?? progress.totalTokens ?? progress.tokenCount;
	if (typeof tokens === "number" && Number.isFinite(tokens) && tokens > 0) {
		parts.push(formatCompactTokens(tokens));
	}
	return parts.length > 0 ? parts.join(" · ") : null;
}

const SKIP_PROGRESS_KEYS: Record<string, true> = {
	summary: true,
	turns: true,
	turnCount: true,
	turn: true,
	tokens: true,
	totalTokens: true,
	tokenCount: true,
	items: true,
	steps: true,
	recentTools: true,
};

/** Extract key-value progress detail rows for expanded SubagentRow (§6.13, DESIGN §10.1). */
export function extractSubagentDetailRows(subagent: SubagentView): SubagentDetailRow[] {
	const rows: SubagentDetailRow[] = [];
	const p = subagent.progress;
	if (p) {
		const listCandidate = p.items ?? p.steps ?? p.recentTools;
		if (Array.isArray(listCandidate)) {
			for (const entry of listCandidate) {
				if (entry && typeof entry === "object") {
					const rec = entry as Record<string, unknown>;
					const label = rec.label ?? rec.text ?? rec.tool ?? rec.action ?? rec.name;
					const val = rec.value ?? rec.detail ?? rec.meta ?? rec.tokens;
					if (typeof label === "string" && label.length > 0) {
						rows.push({
							label,
							value:
								typeof val === "number"
									? formatCompactTokens(val)
									: typeof val === "string"
										? val
										: "",
						});
					}
				} else if (typeof entry === "string") {
					rows.push({ label: entry, value: "" });
				}
			}
		}

		const currentTool = p.currentTool ?? p.tool ?? p.lastTool;
		if (typeof currentTool === "string" && currentTool.length > 0) {
			rows.push({ label: "当前工具", value: currentTool });
		}

		for (const [k, v] of Object.entries(p)) {
			if (SKIP_PROGRESS_KEYS[k] || k === "currentTool" || k === "tool" || k === "lastTool") {
				continue;
			}
			if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
				rows.push({ label: k, value: String(v) });
			}
		}
	}

	if (rows.length === 0 && subagent.task && subagent.task !== subagent.description) {
		rows.push({ label: subagent.task, value: "" });
	}
	return rows;
}

// ── Incremental subagent transcript cursor state machine (DESIGN §10.2) ──

export interface SubagentCursorState {
	fromByte: number;
	sessionFile?: string;
	messages: AgentMessage[];
	entries: Record<string, unknown>[];
}

export function createSubagentCursorState(): SubagentCursorState {
	return {
		fromByte: 0,
		messages: [],
		entries: [],
	};
}

/**
 * Apply an incremental `get_subagent_messages` page (DESIGN §10.2).
 * When `page.reset` is true or `state.fromByte === 0`, replaces accumulated
 * messages/entries from the start; otherwise appends new items and advances
 * `fromByte` to `page.nextByte`.
 */
export function applySubagentMessagesPage(
	state: SubagentCursorState,
	page: SubagentMessages,
): SubagentCursorState {
	const shouldReset = page.reset || state.fromByte === 0;
	if (!shouldReset && page.messages.length === 0 && page.entries.length === 0 && page.nextByte === state.fromByte) {
		return state;
	}
	return {
		fromByte: page.nextByte,
		sessionFile: page.sessionFile || state.sessionFile,
		messages: shouldReset ? [...page.messages] : [...state.messages, ...page.messages],
		entries: shouldReset ? [...page.entries] : [...state.entries, ...page.entries],
	};
}

// ── Subagent tree (omp hierarchical ids: "Anna.Bob" = Bob spawned by Anna) ──

export interface SubagentTreeNode {
	subagent: SubagentView;
	children: SubagentTreeNode[];
	depth: number;
}

function compareSubagents(a: SubagentView, b: SubagentView): number {
	return a.index - b.index || a.id.localeCompare(b.id);
}

/**
 * Resolve the parent id of `id` among `ids`: the longest proper dotted prefix
 * that is itself a known subagent. Missing intermediate ancestors (pruned by omp
 * or never seen) are skipped, so a grandchild attaches to the closest known one.
 */
export function findSubagentParentId(id: string, ids: ReadonlySet<string>): string | null {
	let cut = id.lastIndexOf(".");
	while (cut > 0) {
		const candidate = id.slice(0, cut);
		if (ids.has(candidate)) return candidate;
		cut = candidate.lastIndexOf(".");
	}
	return null;
}

/** Build a forest of subagents from their dotted ids, sorted by index then id. */
export function buildSubagentTree(subagents: Iterable<SubagentView>): SubagentTreeNode[] {
	const list = [...subagents].sort(compareSubagents);
	const ids = new Set(list.map(s => s.id));
	const nodes = new Map<string, SubagentTreeNode>();
	for (const s of list) nodes.set(s.id, { subagent: s, children: [], depth: 0 });
	const roots: SubagentTreeNode[] = [];
	for (const s of list) {
		const node = nodes.get(s.id)!;
		const parentId = findSubagentParentId(s.id, ids);
		const parent = parentId ? nodes.get(parentId) : undefined;
		if (parent) parent.children.push(node);
		else roots.push(node);
	}
	const setDepth = (node: SubagentTreeNode, depth: number) => {
		node.depth = depth;
		for (const c of node.children) setDepth(c, depth + 1);
	};
	for (const r of roots) setDepth(r, 0);
	return roots;
}

/** Depth-first flatten (pre-order) of a subagent forest. */
export function flattenSubagentTree(roots: readonly SubagentTreeNode[]): SubagentTreeNode[] {
	const out: SubagentTreeNode[] = [];
	const walk = (n: SubagentTreeNode) => {
		out.push(n);
		for (const c of n.children) walk(c);
	};
	for (const r of roots) walk(r);
	return out;
}

/** Find the node for `id` in a forest. */
export function findSubagentNode(roots: readonly SubagentTreeNode[], id: string): SubagentTreeNode | undefined {
	for (const r of roots) {
		if (r.subagent.id === id) return r;
		const hit = findSubagentNode(r.children, id);
		if (hit) return hit;
	}
	return undefined;
}

/** Total number of descendants below a node. */
export function countSubagentDescendants(node: SubagentTreeNode): number {
	let n = 0;
	for (const c of node.children) n += 1 + countSubagentDescendants(c);
	return n;
}

/** Number of running/pending descendants below a node. */
export function countActiveSubagentDescendants(node: SubagentTreeNode): number {
	let n = 0;
	for (const c of node.children) {
		if (c.subagent.status === "running" || c.subagent.status === "pending") n += 1;
		n += countActiveSubagentDescendants(c);
	}
	return n;
}

/** Known ancestors of `id` (root first), excluding the subagent itself. */
export function subagentLineage(
	id: string,
	subagents: ReadonlyMap<string, SubagentView>,
): SubagentView[] {
	const ids = new Set(subagents.keys());
	const chain: SubagentView[] = [];
	let cur = findSubagentParentId(id, ids);
	while (cur) {
		const s = subagents.get(cur);
		if (s) chain.unshift(s);
		cur = findSubagentParentId(cur, ids);
	}
	return chain;
}

/** Direct children of `id` among `subagents`, sorted. */
export function subagentChildren(
	id: string,
	subagents: ReadonlyMap<string, SubagentView>,
): SubagentView[] {
	const ids = new Set(subagents.keys());
	return [...subagents.values()]
		.filter(s => s.id !== id && findSubagentParentId(s.id, ids) === id)
		.sort(compareSubagents);
}

/** Display name for a subagent: last dotted segment of its id when it differs from the agent name. */
export function subagentShortName(subagent: SubagentView): string {
	const dot = subagent.id.lastIndexOf(".");
	return dot >= 0 ? subagent.id.slice(dot + 1) : subagent.id;
}
