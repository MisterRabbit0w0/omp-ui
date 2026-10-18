import { ChevronDown, ExternalLink, FileText, RefreshCw, WrapText } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { GitChangesResult } from "@omp-ui/protocol";
import { DiffView } from "@/features/tools/DiffView";
import { useAppStore } from "@/store/app-store";
import { getBridge } from "@/store/bridge-access";
import type { SessionView } from "@/store/session-reducer";
import { IconButton } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { Collapsible } from "@/ui/Collapsible";
import {
	groupChangedFiles,
	scrollToToolCall,
	selectLatestTurnChangedFiles,
	splitFilePath,
	type GroupedChangedFile,
} from "./panel-logic";

export interface ChangesTabProps {
	view: SessionView | undefined;
	/** File path requested to expand via `open-panel` / `open-panel-tab` event. */
	focusedFilePath?: string | null;
}

type ChangesScope = "session" | "latest-turn" | "unstaged" | "staged";

const SCOPES: ReadonlyArray<{ id: ChangesScope; label: string; hint: string }> = [
	{ id: "session", label: "本会话", hint: "对话中 edit / write / notebook 的成功调用，按文件合并" },
	{ id: "latest-turn", label: "最近一轮", hint: "最近一次实际改动文件的助手回合" },
	{ id: "unstaged", label: "未暂存", hint: "git 工作区相对暂存区的改动（含未跟踪文件）" },
	{ id: "staged", label: "已暂存", hint: "git 暂存区相对 HEAD 的改动" },
];

function gitGroups(result: GitChangesResult | undefined): GroupedChangedFile[] {
	if (!result || !result.repo) return [];
	return result.files.map(file => {
		const { dir, base } = splitFilePath(file.path);
		return {
			path: file.path,
			dir,
			base,
			calls: [],
			latestToolCallId: "",
			additions: file.additions,
			deletions: file.deletions,
			mergedDiff: file.diff,
			status: file.status,
			...(file.binary ? { binary: true } : {}),
		};
	});
}

interface GitState {
	loading: boolean;
	error?: string;
	result?: GitChangesResult;
	/** cwd the result belongs to, so a stale snapshot never renders under another session. */
	cwd?: string;
}

/**
 * FRONTEND §6.16 变更 tab:
 * - Scopes: the whole conversation, the latest editing turn, and live git
 *   unstaged/staged snapshots (read-only; git scopes need the session cwd).
 * - Each row is h-8: file icon + mono path + `+n −m`; expanding shows a merged DiffView.
 * - Session scopes also dispatch `scroll-to-tool` so clicking a row reveals the tool call.
 */
export function ChangesTab({ view, focusedFilePath }: ChangesTabProps) {
	const cwd = useAppStore(s => s.sessions.find(item => item.id === view?.sessionId)?.cwd);
	const [scope, setScope] = useState<ChangesScope>("session");
	const [expandedPaths, setExpandedPaths] = useState<Record<string, boolean>>({});
	const [wrapLines, setWrapLines] = useState(false);
	const [refreshToken, setRefreshToken] = useState(0);
	const [gitState, setGitState] = useState<GitState>({ loading: false });

	const sessionGroups = useMemo(() => groupChangedFiles(view), [view]);
	const latestTurnGroups = useMemo(
		() => groupChangedFiles(view, selectLatestTurnChangedFiles(view)),
		[view],
	);
	const isGitScope = scope === "unstaged" || scope === "staged";

	// Git snapshots change outside the event stream (the agent, an editor, another shell):
	// refresh on scope/run settles, on an explicit click, and when the working directory changes.
	useEffect(() => {
		if (!isGitScope) return;
		if (!cwd) {
			setGitState({ loading: false });
			return;
		}
		let cancelled = false;
		setGitState(prev => ({ ...prev, loading: true, error: undefined }));
		void getBridge()
			.http.getGitChanges(cwd, scope)
			.then(result => {
				if (!cancelled) setGitState({ loading: false, result, cwd });
			})
			.catch(err => {
				if (!cancelled) {
					setGitState({ loading: false, cwd, error: err instanceof Error ? err.message : "读取 git 变更失败" });
				}
			});
		return () => {
			cancelled = true;
		};
	}, [isGitScope, scope, cwd, refreshToken, view?.run.kind, view?.messages.length]);

	// Ignore a snapshot from another scope/cwd during the frame before the new fetch lands.
	const activeGitResult =
		gitState.cwd === cwd && gitState.result?.scope === scope ? gitState.result : undefined;

	const groups = useMemo(() => {
		if (scope === "session") return sessionGroups;
		if (scope === "latest-turn") return latestTurnGroups;
		return gitGroups(activeGitResult);
	}, [scope, sessionGroups, latestTurnGroups, activeGitResult]);

	useEffect(() => {
		if (!focusedFilePath) return;
		setScope("session");
		setExpandedPaths(prev => ({ ...prev, [focusedFilePath]: true }));
	}, [focusedFilePath]);

	const counts: Record<ChangesScope, number | undefined> = {
		session: sessionGroups.length,
		"latest-turn": latestTurnGroups.length,
		unstaged: activeGitResult?.scope === "unstaged" ? activeGitResult.files.length : undefined,
		staged: activeGitResult?.scope === "staged" ? activeGitResult.files.length : undefined,
	};

	const totalAdditions = groups.reduce((sum, group) => sum + group.additions, 0);
	const totalDeletions = groups.reduce((sum, group) => sum + group.deletions, 0);
	const scopeInfo = SCOPES.find(item => item.id === scope)!;

	const toggleFile = (path: string, latestToolCallId: string) => {
		setExpandedPaths(prev => ({ ...prev, [path]: !prev[path] }));
		if (latestToolCallId) scrollToToolCall(latestToolCallId);
	};

	const emptyText = (() => {
		if (isGitScope) {
			if (!cwd) return "找不到会话的工作目录";
			if (gitState.loading) return "正在读取 git 变更…";
			if (gitState.error) return gitState.error;
			if (!activeGitResult) return "正在读取 git 变更…";
			if (!activeGitResult.repo) return "当前目录不在 Git 仓库中";
			if (activeGitResult.truncated) return "变更过多，仅展示前 200 个文件或部分 diff";
			return scope === "staged" ? "暂存区没有变更" : "工作区没有未暂存变更";
		}
		if (scope === "latest-turn") return "最近一轮没有文件变更";
		return "当前会话暂无文件变更记录";
	})();

	return (
		<div className="flex min-w-0 flex-col gap-2">
			<div className="flex items-center gap-0.5 rounded-control bg-inset p-0.5 shadow-hairline">
				{SCOPES.map(item => {
					const active = item.id === scope;
					const count = counts[item.id];
					return (
						<button
							key={item.id}
							type="button"
							onClick={() => setScope(item.id)}
							className={
								"flex h-7 min-w-0 flex-1 items-center justify-center gap-1 rounded-[6px] px-1 text-[11.5px] transition-colors " +
								(active
									? "bg-surface font-medium text-ink shadow-btn"
									: "text-ink-2 hover:bg-hover hover:text-ink")
							}
						>
							<span className="truncate">{item.label}</span>
							{count !== undefined && (
								<span className="mono shrink-0 text-[10.5px] text-ink-3 tabular-nums">{count}</span>
							)}
						</button>
					);
				})}
			</div>

			<div className="flex min-w-0 items-start justify-between gap-2 px-0.5">
				<div className="min-w-0 flex-1">
					<div className="text-[11.5px] leading-[1.45] text-ink-2">{scopeInfo.hint}</div>
					{groups.length > 0 && (
						<div className="mt-0.5 flex items-center gap-1.5 font-mono text-[11.5px] tabular-nums">
							<span className="text-ink-2">{groups.length} 个文件</span>
							{totalAdditions > 0 && <span className="text-green-ink">+{totalAdditions}</span>}
							{totalDeletions > 0 && <span className="text-red-ink">−{totalDeletions}</span>}
						</div>
					)}
				</div>
				{isGitScope && (
					<IconButton
						size="sm"
						label="刷新 git 变更"
						onClick={() => setRefreshToken(token => token + 1)}
						disabled={gitState.loading}
					>
						<RefreshCw
							size={12}
							strokeWidth={2}
							className={"i" + (gitState.loading ? " animate-spin" : "")}
						/>
					</IconButton>
				)}
			</div>

			{groups.length === 0 ? (
				<Card className="px-3 py-3 text-[12.5px] text-ink-2">{emptyText}</Card>
			) : (
				<>
					{groups.map(group => {
						const isOpen = Boolean(expandedPaths[group.path]);
						const canLocate = Boolean(group.latestToolCallId);
						return (
							<Card key={group.path}>
								<div className="flex h-8 items-center gap-1 pr-1.5">
									<button
										type="button"
										aria-expanded={isOpen}
										onClick={() => toggleFile(group.path, group.latestToolCallId)}
										className="flex h-8 min-w-0 flex-1 items-center gap-2 px-2.5 text-left transition-colors duration-100 hover:bg-hover"
									>
										<FileText size={13} strokeWidth={2} className="shrink-0 text-ink-3" />
										<span className="min-w-0 flex-1 truncate font-mono text-[12px]">
											{group.dir.length > 0 && <span className="text-ink-2">{group.dir}</span>}
											<span className="font-medium text-ink">{group.base}</span>
										</span>
										{group.status && (
											<span className="shrink-0 rounded-[4px] bg-field px-1 font-mono text-[10.5px] text-ink-2 shadow-hairline">
												{group.status}
											</span>
										)}
										<span className="flex shrink-0 items-center gap-1.5 font-mono text-[11.5px] tabular-nums">
											{group.additions > 0 && (
												<span className="text-green-ink">+{group.additions}</span>
											)}
											{group.deletions > 0 && (
												<span className="text-red-ink">−{group.deletions}</span>
											)}
											{group.additions === 0 && group.deletions === 0 && (
												<span className="text-ink-2">
													{group.binary ? "二进制" : group.calls.length > 0 ? `${group.calls.length} 次` : "—"}
												</span>
											)}
										</span>
										<ChevronDown
											size={12}
											strokeWidth={2.2}
											className={
												"shrink-0 text-ink-3 transition-transform duration-200 ease-[var(--ease-out-strong)] " +
												(isOpen ? "rotate-180" : "-rotate-90")
											}
										/>
									</button>
									<IconButton
										size="sm"
										label={wrapLines ? "关闭自动换行" : "开启自动换行"}
										onClick={() => setWrapLines(w => !w)}
										className={wrapLines ? "bg-field text-ink" : undefined}
									>
										<WrapText size={12} strokeWidth={2} />
									</IconButton>
									{canLocate && (
										<IconButton
											size="sm"
											label={`定位到 ${group.base} 的工具调用`}
											onClick={() => scrollToToolCall(group.latestToolCallId)}
										>
											<ExternalLink size={12} strokeWidth={2} />
										</IconButton>
									)}
								</div>

								<Collapsible open={isOpen} duration={300}>
									<div className="min-w-0 border-t border-line">
										{group.binary && !group.mergedDiff ? (
											<div className="px-3 py-2 text-[12px] text-ink-2">二进制文件，无法预览文本差异。</div>
										) : (
											<DiffView
												filePath={group.path}
												diff={group.mergedDiff || undefined}
												oldText={group.mergedDiff ? undefined : group.oldText}
												newText={group.mergedDiff ? undefined : group.newText}
												additions={group.additions}
												deletions={group.deletions}
												wrap={wrapLines}
												showHeader={false}
												className="rounded-none shadow-none"
											/>
										)}
										{group.calls.length > 1 && (
											<div className="flex flex-wrap items-center gap-1.5 border-t border-line bg-surface px-2.5 py-1.5">
												<span className="text-[11px] text-ink-2">修改记录：</span>
												{group.calls.map((c, idx) => (
													<button
														key={c.toolCallId}
														type="button"
														onClick={() => scrollToToolCall(c.toolCallId)}
														className="rounded-chip bg-field px-1.5 py-0.5 font-mono text-[11px] text-ink-2 shadow-hairline transition-colors hover:bg-hover hover:text-ink"
													>
														#{idx + 1} {c.tool}
													</button>
												))}
											</div>
										)}
									</div>
								</Collapsible>
							</Card>
						);
					})}
					{isGitScope && activeGitResult?.truncated && (
						<div className="px-1 text-[11px] text-ink-2">变更较多，已截断部分文件或 diff。</div>
					)}
				</>
			)}
		</div>
	);
}
