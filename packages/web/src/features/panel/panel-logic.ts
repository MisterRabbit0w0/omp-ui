import type { Goal, TodoItem, TodoPhase, ToolCall, ToolResultMessage } from "@omp-ui/protocol";
import { formatCompactTokens } from "@/features/subagents/subagent-utils";
import { selectChangedFiles, selectTurns, type ChangedFile, type SessionView } from "@/store/session-reducer";

export type PanelTabId = "todo" | "subagents" | "changes" | "goal" | "info";

export const PANEL_TABS: ReadonlyArray<{ id: PanelTabId; label: string }> = [
	{ id: "todo", label: "待办" },
	{ id: "subagents", label: "子代理" },
	{ id: "changes", label: "变更" },
	{ id: "goal", label: "目标" },
	{ id: "info", label: "信息" },
];

const TAB_ALIASES: Record<string, PanelTabId> = {
	todo: "todo",
	todos: "todo",
	subagent: "subagents",
	subagents: "subagents",
	change: "changes",
	changes: "changes",
	diff: "changes",
	goal: "goal",
	info: "info",
	stats: "info",
};

export function normalizePanelTabId(raw: string | undefined | null): PanelTabId | null {
	if (!raw) return null;
	return TAB_ALIASES[raw.toLowerCase()] ?? null;
}

// ── 1. Todo mutations (`set_todos` payload builders) ──────────────────

/**
 * Toggle a todo item between `"completed"` and `"pending"`.
 * Preserves all other phases and fields immutably.
 */
export function toggleTodoTask(
	phases: readonly TodoPhase[],
	phaseIndex: number,
	taskIndex: number,
): TodoPhase[] {
	return phases.map((phase, pIdx) => {
		if (pIdx !== phaseIndex) return phase;
		return {
			...phase,
			tasks: phase.tasks.map((task, tIdx): TodoItem => {
				if (tIdx !== taskIndex) return task;
				const nextStatus = task.status === "completed" ? "pending" : "completed";
				return {
					...task,
					status: nextStatus,
				};
			}),
		};
	});
}

/**
 * Edit the content of a todo item inline.
 * If the trimmed content is empty, keeps the existing content unchanged.
 */
export function editTodoTaskContent(
	phases: readonly TodoPhase[],
	phaseIndex: number,
	taskIndex: number,
	newContent: string,
): TodoPhase[] {
	const trimmed = newContent.trim();
	if (trimmed.length === 0) return [...phases];
	return phases.map((phase, pIdx) => {
		if (pIdx !== phaseIndex) return phase;
		return {
			...phase,
			tasks: phase.tasks.map((task, tIdx): TodoItem => {
				if (tIdx !== taskIndex) return task;
				return { ...task, content: trimmed };
			}),
		};
	});
}

/**
 * Add a new `"pending"` task to `phases[phaseIndex]`, or create a default phase
 * when `phases` is empty.
 */
export function addTodoTask(
	phases: readonly TodoPhase[],
	phaseIndex: number,
	content: string,
	defaultPhaseName = "待办",
): TodoPhase[] {
	const trimmed = content.trim();
	if (trimmed.length === 0) return [...phases];
	const newItem: TodoItem = { content: trimmed, status: "pending" };
	if (phases.length === 0) {
		return [{ name: defaultPhaseName, tasks: [newItem] }];
	}
	const targetIdx =
		phaseIndex >= 0 && phaseIndex < phases.length ? phaseIndex : phases.length - 1;
	return phases.map((phase, idx) =>
		idx === targetIdx ? { ...phase, tasks: [...phase.tasks, newItem] } : phase,
	);
}

/** Remove a task from a phase; drops the phase only if it becomes empty and is not the sole phase. */
export function removeTodoTask(
	phases: readonly TodoPhase[],
	phaseIndex: number,
	taskIndex: number,
): TodoPhase[] {
	return phases
		.map((phase, pIdx) => {
			if (pIdx !== phaseIndex) return phase;
			return {
				...phase,
				tasks: phase.tasks.filter((_, tIdx) => tIdx !== taskIndex),
			};
		})
		.filter((phase, _, arr) => phase.tasks.length > 0 || arr.length === 1);
}

// ── 2. Tab new-content dot tracking (FRONTEND §6.16) ──────────────────

export type TabSignatures = Record<PanelTabId, string>;
export type TabDots = Record<PanelTabId, boolean>;

export function createEmptySeenSignatures(): TabSignatures {
	return {
		todo: "",
		subagents: "",
		changes: "",
		goal: "",
		info: "",
	};
}

/** Compute a deterministic content signature per tab from `SessionView`. */
export function computeTabSignatures(
	view: SessionView | undefined,
	todoFlashAt?: number,
): TabSignatures {
	if (!view) return createEmptySeenSignatures();

	// 1. Todo signature
	const phases = view.state?.todoPhases ?? [];
	const totalTasks = phases.reduce((acc, p) => acc + p.tasks.length, 0);
	const todoSig =
		totalTasks > 0 || (todoFlashAt !== undefined && todoFlashAt > 0)
			? `${phases.map(p => `${p.name}:${p.tasks.map(t => `${t.status}:${t.content}`).join(",")}`).join("|")}#${todoFlashAt ?? 0}`
			: "";

	// 2. Subagents signature
	const subagentEntries = [...view.subagents.values()];
	const subagentsSig =
		subagentEntries.length > 0
			? subagentEntries
					.map(s => `${s.id}:${s.status}:${s.lastUpdate}`)
					.sort()
					.join("|")
			: "";

	// 3. Changes signature
	const changes = selectChangedFiles(view);
	const changesSig =
		changes.length > 0 ? changes.map(c => `${c.toolCallId}:${c.path}`).join("|") : "";

	// 4. Goal signature
	const goal = view.state?.goal?.goal ?? null;
	const goalSig = goal
		? `${goal.id}:${goal.status}:${goal.tokensUsed}:${goal.updatedAt}`
		: "";

	return {
		todo: todoSig,
		subagents: subagentsSig,
		changes: changesSig,
		goal: goalSig,
		info: "",
	};
}

/** Record that `activeTab` has been seen at its current signature. */
export function markTabSeen(
	seen: TabSignatures,
	current: TabSignatures,
	activeTab: PanelTabId,
): TabSignatures {
	if (seen[activeTab] === current[activeTab]) return seen;
	return {
		...seen,
		[activeTab]: current[activeTab],
	};
}

/**
 * Determine which tabs display the 6px accent new-content dot:
 * - Active tab never shows a dot.
 * - Any other tab shows a dot when it is non-empty (`current[tab] !== ""`)
 *   and differs from `seen[tab]`.
 */
export function computeTabDots(
	seen: TabSignatures,
	current: TabSignatures,
	activeTab: PanelTabId,
): TabDots {
	const synced = markTabSeen(seen, current, activeTab);
	return {
		todo: activeTab !== "todo" && current.todo !== "" && current.todo !== synced.todo,
		subagents:
			activeTab !== "subagents" &&
			current.subagents !== "" &&
			current.subagents !== synced.subagents,
		changes:
			activeTab !== "changes" && current.changes !== "" && current.changes !== synced.changes,
		goal: activeTab !== "goal" && current.goal !== "" && current.goal !== synced.goal,
		info: activeTab !== "info" && current.info !== "" && current.info !== synced.info,
	};
}

// ── 3. Goal budget meter thresholds & formatting (FRONTEND §6.16) ─────

export interface GoalBudgetMeter {
	hasBudget: boolean;
	rawPercent: number;
	widthPercent: number;
	/** "orange" when rawPercent >= 90, otherwise "accent" (§6.16) */
	tone: "accent" | "orange";
	isWarning: boolean;
	isExceeded: boolean;
}

export const GOAL_WARNING_THRESHOLD_PERCENT = 90;

export function computeGoalBudgetMeter(
	tokensUsed: number,
	tokenBudget?: number | null,
): GoalBudgetMeter {
	if (tokenBudget === undefined || tokenBudget === null || tokenBudget <= 0 || !Number.isFinite(tokenBudget)) {
		return {
			hasBudget: false,
			rawPercent: 0,
			widthPercent: 0,
			tone: "accent",
			isWarning: false,
			isExceeded: false,
		};
	}
	const safeUsed = Number.isFinite(tokensUsed) && tokensUsed > 0 ? tokensUsed : 0;
	const rawPercent = (safeUsed / tokenBudget) * 100;
	const widthPercent = Math.min(100, Math.max(0, rawPercent));
	const isWarning = rawPercent >= GOAL_WARNING_THRESHOLD_PERCENT;
	return {
		hasBudget: true,
		rawPercent,
		widthPercent,
		tone: isWarning ? "orange" : "accent",
		isWarning,
		isExceeded: rawPercent >= 100,
	};
}

export function formatGoalDuration(timeUsedSeconds: number): string {
	const sec = Math.max(0, Math.floor(Number.isFinite(timeUsedSeconds) ? timeUsedSeconds : 0));
	if (sec < 60) return `${sec} 秒`;
	const minutes = Math.floor(sec / 60);
	if (minutes < 60) return `${minutes} 分钟`;
	const hours = Math.floor(minutes / 60);
	const remMinutes = minutes % 60;
	return remMinutes > 0 ? `${hours} 小时 ${remMinutes} 分钟` : `${hours} 小时`;
}

/** Format "已用 34k / 100k · 12 分钟" per FRONTEND §6.16. */
export function formatGoalUsageSummary(
	goal: Pick<Goal, "tokensUsed" | "tokenBudget" | "timeUsedSeconds">,
): string {
	const usedStr = formatCompactTokens(goal.tokensUsed);
	const tokenPart =
		goal.tokenBudget !== undefined && goal.tokenBudget > 0
			? `已用 ${usedStr} / ${formatCompactTokens(goal.tokenBudget)}`
			: `已用 ${usedStr}`;
	return `${tokenPart} · ${formatGoalDuration(goal.timeUsedSeconds)}`;
}

// ── 4. Changed files grouping & diff extraction (FRONTEND §6.16, §6.9) ──

export interface GroupedChangedFile {
	path: string;
	dir: string;
	base: string;
	calls: ChangedFile[];
	latestToolCallId: string;
	additions: number;
	deletions: number;
	mergedDiff: string;
	oldText?: string;
	newText?: string;
	/** Git scopes only: M/A/D/R/C or "?" for untracked. */
	status?: string;
	binary?: boolean;
}

export function splitFilePath(fullPath: string): { dir: string; base: string } {
	const normalized = fullPath.replace(/\\/g, "/");
	const lastSlash = normalized.lastIndexOf("/");
	if (lastSlash < 0) return { dir: "", base: normalized };
	return {
		dir: normalized.slice(0, lastSlash + 1),
		base: normalized.slice(lastSlash + 1),
	};
}

export interface DiffLineItem {
	kind: "hunk" | "add" | "del" | "ctx";
	oldLine?: number;
	newLine?: number;
	text: string;
}

/**
 * Parse a diff string (either unified diff OR omp's `+123|content` / `-123|content`
 * / ` 123|content` format) into renderable lines with old/new line numbers (§6.9).
 */
export function parseUnifiedDiffLines(diffText: string): DiffLineItem[] {
	if (!diffText.trim()) return [];
	const rawLines = diffText.replace(/\r\n/g, "\n").split("\n");
	const out: DiffLineItem[] = [];
	let oldLine = 1;
	let newLine = 1;

	for (const line of rawLines) {
		if (line.startsWith("--- ") || line.startsWith("+++ ") || line.startsWith("Index:") || line.startsWith("===")) {
			continue;
		}
		if (line.startsWith("@@")) {
			const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
			if (match) {
				oldLine = Number.parseInt(match[1]!, 10);
				newLine = Number.parseInt(match[2]!, 10);
			}
			out.push({ kind: "hunk", text: line });
			continue;
		}
		// omp edit tool details.diff format: `+123|content`, `-123|content`, ` 123|content`
		const ompMatch = /^([+\-− ])\s*(\d+)\|(.*)$/.exec(line);
		if (ompMatch) {
			const prefix = ompMatch[1]!;
			const ln = Number.parseInt(ompMatch[2]!, 10);
			const content = ompMatch[3]!;
			if (prefix === "+") {
				newLine = ln;
				out.push({ kind: "add", newLine: newLine++, text: content });
			} else if (prefix === "-" || prefix === "−") {
				oldLine = ln;
				out.push({ kind: "del", oldLine: oldLine++, text: content });
			} else {
				oldLine = ln;
				newLine = ln;
				out.push({ kind: "ctx", oldLine: oldLine++, newLine: newLine++, text: content });
			}
			continue;
		}
		if (line.startsWith("+")) {
			out.push({ kind: "add", newLine: newLine++, text: line.slice(1) });
		} else if (line.startsWith("-") || line.startsWith("−")) {
			out.push({ kind: "del", oldLine: oldLine++, text: line.slice(1) });
		} else {
			const text = line.startsWith(" ") ? line.slice(1) : line;
			out.push({ kind: "ctx", oldLine: oldLine++, newLine: newLine++, text });
		}
	}
	return out;
}

interface ExtractedCallChange {
	path?: string;
	diff: string;
	oldText?: string;
	newText?: string;
	added: number;
	removed: number;
}

function extractFromDetailsRecord(det: Record<string, unknown>): ExtractedCallChange | null {
	const path =
		typeof det.path === "string"
			? det.path
			: typeof det.file === "string"
				? det.file
				: typeof det.filePath === "string"
					? det.filePath
					: undefined;
	const rawDiff = det.diff ?? det.patch ?? det.unifiedDiff;
	const oldText = typeof det.oldText === "string" ? det.oldText : undefined;
	const newText = typeof det.newText === "string" ? det.newText : undefined;
	if (typeof rawDiff === "string" && rawDiff.trim().length > 0) {
		const parsed = parseUnifiedDiffLines(rawDiff);
		return {
			path,
			diff: rawDiff.trim(),
			oldText,
			newText,
			added:
				typeof det.additions === "number"
					? det.additions
					: parsed.filter(l => l.kind === "add").length,
			removed:
				typeof det.deletions === "number"
					? det.deletions
					: parsed.filter(l => l.kind === "del").length,
		};
	}
	if (oldText !== undefined && newText !== undefined) {
		const oldLines = oldText.length > 0 ? oldText.split("\n") : [];
		const newLines = newText.length > 0 ? newText.split("\n") : [];
		return {
			path,
			diff: "",
			oldText,
			newText,
			added: typeof det.additions === "number" ? det.additions : newLines.length,
			removed: typeof det.deletions === "number" ? det.deletions : oldLines.length,
		};
	}
	return null;
}

function extractCallDiffSnippet(
	call: ToolCall | undefined,
	result: ToolResultMessage | undefined,
	targetPath?: string,
): ExtractedCallChange {
	// 1. Check result.details (including perFileResults[])
	if (result?.details && typeof result.details === "object") {
		const det = result.details as Record<string, unknown>;
		if (Array.isArray(det.perFileResults)) {
			for (const entry of det.perFileResults) {
				if (entry && typeof entry === "object") {
					const sub = extractFromDetailsRecord(entry as Record<string, unknown>);
					if (sub && (!targetPath || !sub.path || sub.path === targetPath)) {
						return sub;
					}
				}
			}
		}
		const direct = extractFromDetailsRecord(det);
		if (direct) return direct;
	}

	// 2. Check result text if it looks like a diff
	if (result) {
		const txt = result.content
			.filter((c): c is { type: "text"; text: string } => c.type === "text")
			.map(c => c.text)
			.join("\n")
			.trim();
		if (txt.includes("@@ ") || /^[+\-−]\d*\|/m.test(txt)) {
			const parsed = parseUnifiedDiffLines(txt);
			return {
				diff: txt,
				added: parsed.filter(l => l.kind === "add").length,
				removed: parsed.filter(l => l.kind === "del").length,
			};
		}
	}

	// 3. Reconstruct from ToolCall arguments (`edit` oldText/newText/input or `write` content)
	const args = call?.arguments ?? {};
	const oldText = args.oldText ?? args.old_text ?? args.old_str ?? args.old_string;
	const newText = args.newText ?? args.new_text ?? args.new_str ?? args.new_string;
	if (typeof oldText === "string" || typeof newText === "string") {
		const oldStr = typeof oldText === "string" ? oldText : "";
		const newStr = typeof newText === "string" ? newText : "";
		const oldLines = oldStr.length > 0 ? oldStr.split("\n") : [];
		const newLines = newStr.length > 0 ? newStr.split("\n") : [];
		const body = [
			`@@ -1,${oldLines.length} +1,${newLines.length} @@`,
			...oldLines.map(l => `-${l}`),
			...newLines.map(l => `+${l}`),
		].join("\n");
		return {
			diff: body,
			oldText: oldStr,
			newText: newStr,
			added: newLines.length,
			removed: oldLines.length,
		};
	}

	if (typeof args.content === "string" && args.content.length > 0) {
		const lines = args.content.split("\n");
		const preview = lines.slice(0, 60);
		const body = [
			`@@ -0,0 +1,${lines.length} @@`,
			...preview.map(l => `+${l}`),
			...(lines.length > 60 ? [`+… (${lines.length - 60} more lines)`] : []),
		].join("\n");
		return {
			diff: body,
			oldText: "",
			newText: args.content,
			added: lines.length,
			removed: 0,
		};
	}

	if (typeof args.input === "string" && args.input.length > 0) {
		const rawLines = args.input.split("\n");
		const added = rawLines.filter(l => l.startsWith("+")).length;
		return { diff: args.input, added, removed: 0 };
	}

	return { diff: "", added: 0, removed: 0 };
}

/** Changed files touched by the most recent turn/draft that edited anything ("最近一轮"). */
export function selectLatestTurnChangedFiles(view: SessionView | undefined): ChangedFile[] {
	if (!view) return [];
	const changed = selectChangedFiles(view);
	if (changed.length === 0) return [];
	const items = selectTurns(view);
	for (let i = items.length - 1; i >= 0; i--) {
		const item = items[i]!;
		const ids = new Set<string>();
		if (item.kind === "turn") {
			for (const tool of item.turn.tools) ids.add(tool.call.id);
		} else if (item.kind === "draft") {
			for (const block of item.draft.content) {
				if (block?.type === "toolCall" && block.id) ids.add(block.id);
			}
		} else {
			continue;
		}
		const subset = changed.filter(entry => ids.has(entry.toolCallId));
		if (subset.length > 0) return subset;
	}
	return [];
}

/** Group `selectChangedFiles(view)` by file path and build merged diffs (§6.16). */
export function groupChangedFiles(
	view: SessionView | undefined,
	changedOverride?: readonly ChangedFile[],
): GroupedChangedFile[] {
	if (!view) return [];
	const changed = changedOverride ?? selectChangedFiles(view);
	if (changed.length === 0) return [];

	const callsById = new Map<string, ToolCall>();
	const resultsById = new Map<string, ToolResultMessage>();
	for (const m of view.messages) {
		if (m.role === "assistant") {
			for (const b of m.content) {
				if (b.type === "toolCall") callsById.set(b.id, b);
			}
		} else if (m.role === "toolResult") {
			resultsById.set(m.toolCallId, m);
		}
	}

	const groups = new Map<string, GroupedChangedFile>();
	for (const item of changed) {
		const snippet = extractCallDiffSnippet(
			callsById.get(item.toolCallId),
			resultsById.get(item.toolCallId),
			item.path,
		);
		const addCount = item.additions ?? snippet.added;
		const delCount = item.deletions ?? snippet.removed;

		const existing = groups.get(item.path);
		if (!existing) {
			const { dir, base } = splitFilePath(item.path);
			groups.set(item.path, {
				path: item.path,
				dir,
				base,
				calls: [item],
				latestToolCallId: item.toolCallId,
				additions: addCount,
				deletions: delCount,
				mergedDiff: snippet.diff,
				oldText: snippet.oldText,
				newText: snippet.newText,
			});
		} else {
			existing.calls.push(item);
			existing.latestToolCallId = item.toolCallId;
			existing.additions += addCount;
			existing.deletions += delCount;
			if (snippet.diff.length > 0) {
				existing.mergedDiff = existing.mergedDiff
					? `${existing.mergedDiff}\n${snippet.diff}`
					: snippet.diff;
			}
			if (snippet.oldText !== undefined && existing.oldText === undefined) {
				existing.oldText = snippet.oldText;
			}
			if (snippet.newText !== undefined) {
				existing.newText = snippet.newText;
			}
		}
	}

	return [...groups.values()];
}

export const SCROLL_TO_TOOL_EVENT = "scroll-to-tool";

export function scrollToToolCall(toolCallId: string): void {
	if (typeof window === "undefined") return;
	window.dispatchEvent(
		new CustomEvent<{ toolCallId: string }>(SCROLL_TO_TOOL_EVENT, {
			detail: { toolCallId },
		}),
	);
}
