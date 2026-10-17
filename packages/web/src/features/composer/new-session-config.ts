/**
 * Pending new-session config held by the welcome composer (FRONTEND §6.12):
 * `{cwd, model, thinking, approvalMode}`. Only values the user chose are persisted, so everything else
 * keeps following `config` defaults. The last used project is remembered across reloads.
 */
import type { ApprovalMode, ProjectItem, ThinkingLevel, UiConfig } from "@omp-ui/protocol";

export const NEW_SESSION_CONFIG_KEY = "omp-ui:new-session-config";

export interface PendingSessionConfig {
	cwd?: string;
	/** `provider/id` */
	model?: string;
	thinking?: ThinkingLevel;
	approvalMode?: ApprovalMode;
}

export interface ResolvedSessionConfig {
	cwd: string | null;
	model: string | undefined;
	thinking: ThinkingLevel | undefined;
	approvalMode: ApprovalMode;
}

const APPROVAL_MODES: readonly ApprovalMode[] = ["always-ask", "write", "yolo"];
const THINKING_LEVELS: readonly ThinkingLevel[] = ["inherit", "off", "minimal", "low", "medium", "high", "xhigh", "max"];

type ReadableStorage = Pick<Storage, "getItem">;
type WritableStorage = Pick<Storage, "setItem">;

/** Coerce config strings (`auto`, `inherit`, unknown) to a thinking level; `auto` and `inherit` both mean "let omp decide". */
export function normalizeThinking(value: string | undefined): ThinkingLevel | undefined {
	if (value === undefined || value === "" || value === "auto") return "inherit";
	return THINKING_LEVELS.includes(value as ThinkingLevel) ? (value as ThinkingLevel) : undefined;
}

/** The `--thinking` start argument: omitted for "auto" so omp picks the model's own default. */
export function thinkingStartArg(level: string | undefined): string | undefined {
	const normalized = normalizeThinking(level);
	return normalized === undefined || normalized === "inherit" ? undefined : normalized;
}

export function loadPendingConfig(
	storage: ReadableStorage | null = typeof localStorage !== "undefined" ? localStorage : null,
): PendingSessionConfig {
	if (!storage) return {};
	try {
		const raw = storage.getItem(NEW_SESSION_CONFIG_KEY);
		if (!raw) return {};
		const parsed: unknown = JSON.parse(raw);
		if (parsed === null || typeof parsed !== "object") return {};
		const o = parsed as Record<string, unknown>;
		const out: PendingSessionConfig = {};
		if (typeof o.cwd === "string" && o.cwd.length > 0) out.cwd = o.cwd;
		if (typeof o.model === "string" && o.model.length > 0) out.model = o.model;
		if (typeof o.thinking === "string" && THINKING_LEVELS.includes(o.thinking as ThinkingLevel)) out.thinking = o.thinking as ThinkingLevel;
		if (typeof o.approvalMode === "string" && APPROVAL_MODES.includes(o.approvalMode as ApprovalMode)) out.approvalMode = o.approvalMode as ApprovalMode;
		return out;
	} catch {
		return {};
	}
}

export function savePendingConfig(
	config: PendingSessionConfig,
	storage: WritableStorage | null = typeof localStorage !== "undefined" ? localStorage : null,
): void {
	if (!storage) return;
	try {
		storage.setItem(NEW_SESSION_CONFIG_KEY, JSON.stringify(config));
	} catch {
		/* storage quota or private mode */
	}
}

/**
 * Effective values for the next `newSession`: the user's pending choice, else the bridge `config` defaults.
 * The project falls back to the most recently used one so a fresh welcome page is immediately sendable.
 */
export function resolveSessionConfig(
	pending: PendingSessionConfig,
	config: UiConfig | null,
	projects: readonly ProjectItem[],
): ResolvedSessionConfig {
	return {
		cwd: pending.cwd ?? config?.recentProjects?.[0] ?? projects[0]?.cwd ?? null,
		model: pending.model ?? config?.defaultModel,
		thinking: pending.thinking ?? normalizeThinking(config?.defaultThinking),
		approvalMode: pending.approvalMode ?? config?.defaultApprovalMode ?? "write",
	};
}

/** Project name shown on the context strip (last path segment, either separator). */
export function projectDisplayName(cwd: string | null | undefined): string {
	if (!cwd) return "";
	const trimmed = cwd.replace(/[\\/]+$/, "");
	const parts = trimmed.split(/[\\/]/);
	return parts[parts.length - 1] || trimmed;
}

/** Recent projects for the project menu: most recent first, filtered by name/path, capped at 8 (§6.14). */
export function filterRecentProjects(
	projects: readonly ProjectItem[],
	query: string,
	extra?: string | null,
	limit = 8,
): ProjectItem[] {
	const list = [...projects].sort((a, b) => Date.parse(b.lastUsedAt) - Date.parse(a.lastUsedAt));
	// A typed/picked folder that has no session yet still has to show up (and carry the check mark).
	if (extra && !list.some(p => p.cwd === extra)) {
		list.unshift({ cwd: extra, name: projectDisplayName(extra), lastUsedAt: new Date().toISOString(), sessionCount: 0 });
	}
	const q = query.trim().toLowerCase();
	return (q ? list.filter(p => fuzzyIncludes(`${p.name} ${p.cwd}`.toLowerCase(), q)) : list).slice(0, limit);
}

/** Subsequence match, so "ompui" finds "omp-ui". */
function fuzzyIncludes(haystack: string, needle: string): boolean {
	if (haystack.includes(needle)) return true;
	let i = 0;
	for (const ch of haystack) {
		if (ch === needle[i]) i += 1;
		if (i === needle.length) return true;
	}
	return needle.length === 0;
}

export const APPROVAL_MODE_META: Record<ApprovalMode, { label: string; description: string }> = {
	"always-ask": { label: "每次询问", description: "所有需要权限的工具都先问你" },
	write: { label: "仅写操作", description: "读取自动允许，修改文件和执行命令前先问" },
	yolo: { label: "完全访问", description: "所有工具直接执行，不再询问" },
};

export const APPROVAL_MODE_ORDER: readonly ApprovalMode[] = ["always-ask", "write", "yolo"];
