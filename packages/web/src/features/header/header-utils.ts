import type { AgentMessage } from "@omp-ui/protocol";

export type ContextRingTone = "normal" | "orange" | "red";

/**
 * Normalize home path prefix to `~` and middle-truncate if longer than `maxLen` (FRONTEND §6.2).
 */
export function truncateMiddlePath(cwd: string, maxLen = 36): string {
	if (!cwd) return "";
	const norm = cwd.replace(/\\/g, "/").replace(/^(?:[A-Za-z]:)?\/Users\/[^/]+|^\/home\/[^/]+/, "~");
	if (norm.length <= maxLen) return norm;
	const lastSlash = norm.lastIndexOf("/");
	const tail = lastSlash > 0 ? norm.slice(lastSlash) : norm.slice(-Math.floor(maxLen / 2));
	const headBudget = Math.max(4, maxLen - tail.length - 1);
	if (headBudget + tail.length + 1 >= norm.length) return norm;
	return `${norm.slice(0, headBudget)}…${tail}`;
}

/**
 * FRONTEND §6.2 context ring color threshold:
 * <80% normal (ink-3), >=80% orange, >=95% red (also displays numeric percentage).
 */
export function getContextRingTone(percent: number): ContextRingTone {
	if (percent >= 95) return "red";
	if (percent >= 80) return "orange";
	return "normal";
}

export function formatTokensCompact(tokens: number): string {
	if (!Number.isFinite(tokens) || tokens <= 0) return "0";
	if (tokens < 1000) return String(Math.round(tokens));
	if (tokens < 1_000_000) {
		const k = tokens / 1000;
		return `${(k >= 100 ? Math.round(k).toString() : k.toFixed(1)).replace(/\.0$/, "")}k`;
	}
	const m = tokens / 1_000_000;
	return `${m.toFixed(1).replace(/\.0$/, "")}M`;
}

export function formatCostUsd(cost: number | undefined | null): string {
	if (cost === undefined || cost === null || !Number.isFinite(cost) || cost <= 0) return "$0.00";
	if (cost < 0.01) return `$${cost.toFixed(4)}`;
	return `$${cost.toFixed(2)}`;
}

export function extractLastAssistantText(messages: readonly AgentMessage[]): string | null {
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i];
		if (!m || m.role !== "assistant" || !Array.isArray(m.content)) continue;
		const parts: string[] = [];
		for (const block of m.content) {
			if (block.type === "text" && block.text) parts.push(block.text);
		}
		if (parts.length > 0) return parts.join("\n\n");
	}
	return null;
}

export interface TreeNodeView {
	id: string;
	role: string;
	preview: string;
	timestamp?: number;
	isLeaf: boolean;
	onActiveBranch: boolean;
	children: TreeNodeView[];
}

function extractNodePreview(raw: Record<string, unknown>): { role: string; preview: string; timestamp?: number } {
	const msg = (raw.message && typeof raw.message === "object" ? (raw.message as Record<string, unknown>) : raw);
	const role =
		(typeof msg.role === "string" && msg.role) ||
		(typeof raw.type === "string" && raw.type) ||
		"entry";
	const timestamp = typeof msg.timestamp === "number" ? msg.timestamp : typeof raw.timestamp === "number" ? raw.timestamp : undefined;

	if (typeof raw.text === "string" && raw.text.trim()) {
		return { role, preview: raw.text.trim().slice(0, 80), timestamp };
	}
	if (typeof raw.summary === "string" && raw.summary.trim()) {
		return { role, preview: raw.summary.trim().slice(0, 80), timestamp };
	}
	const content = msg.content;
	if (typeof content === "string" && content.trim()) {
		return { role, preview: content.trim().slice(0, 80), timestamp };
	}
	if (Array.isArray(content)) {
		for (const c of content) {
			if (c && typeof c === "object" && "text" in c && typeof c.text === "string") {
				const t = c.text.trim();
				if (t) return { role, preview: t.slice(0, 80), timestamp };
			}
			if (c && typeof c === "object" && "name" in c && typeof c.name === "string") {
				return { role, preview: `调用 ${c.name}`, timestamp };
			}
		}
	}
	return { role, preview: role, timestamp };
}

/**
 * Normalize raw `get_tree` result (`tree: Record<string, unknown>[]`, `leafId`)
 * into a hierarchy of `TreeNodeView` items, marking `isLeaf` and `onActiveBranch`.
 */
export function buildSessionTree(rawItems: readonly Record<string, unknown>[], leafId: string | null): TreeNodeView[] {
	if (rawItems.length === 0) return [];

	const hasExplicitChildren = rawItems.some(it => Array.isArray(it.children));

	const convertRecursive = (raw: Record<string, unknown>, idx: number): TreeNodeView => {
		const id =
			(typeof raw.id === "string" && raw.id) ||
			(typeof raw.entryId === "string" && raw.entryId) ||
			`node-${idx}`;
		const { role, preview, timestamp } = extractNodePreview(raw);
		const rawChildren = Array.isArray(raw.children) ? (raw.children as Record<string, unknown>[]) : [];
		const children = rawChildren.map((c, ci) => convertRecursive(c, ci));
		const isLeaf = id === leafId;
		const onActiveBranch = isLeaf || children.some(c => c.onActiveBranch);
		return { id, role, preview, timestamp, isLeaf, onActiveBranch, children };
	};

	if (hasExplicitChildren) {
		return rawItems.map((it, i) => convertRecursive(it, i));
	}

	// Flat list with optional parentId
	const byId = new Map<string, TreeNodeView>();
	const parentMap = new Map<string, string | null>();
	const roots: TreeNodeView[] = [];

	rawItems.forEach((raw, idx) => {
		const id =
			(typeof raw.id === "string" && raw.id) ||
			(typeof raw.entryId === "string" && raw.entryId) ||
			`node-${idx}`;
		const { role, preview, timestamp } = extractNodePreview(raw);
		const parentId = typeof raw.parentId === "string" ? raw.parentId : null;
		byId.set(id, {
			id,
			role,
			preview,
			timestamp,
			isLeaf: id === leafId,
			onActiveBranch: id === leafId,
			children: [],
		});
		parentMap.set(id, parentId);
	});

	for (const [id, node] of byId) {
		const pid = parentMap.get(id);
		const parent = pid ? byId.get(pid) : undefined;
		if (parent && parent !== node) {
			parent.children.push(node);
		} else {
			roots.push(node);
		}
	}

	const markActive = (n: TreeNodeView): boolean => {
		let active = n.isLeaf;
		for (const c of n.children) {
			if (markActive(c)) active = true;
		}
		n.onActiveBranch = active;
		return active;
	};
	for (const r of roots) markActive(r);

	return roots;
}
