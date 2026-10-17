import { Check, ChevronDown, Copy, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { formatCompactTokens } from "@/features/subagents/subagent-utils";
import { getBridge, updateSessionView } from "@/store/bridge-access";
import { useAppStore } from "@/store/app-store";
import type { SessionView } from "@/store/session-reducer";
import { IconButton } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { Collapsible } from "@/ui/Collapsible";

export interface InfoTabProps {
	sessionId: string;
	view: SessionView | undefined;
}

function CopyableKvRow({
	label,
	value,
	copyValue,
}: {
	label: string;
	value: string;
	copyValue?: string;
}) {
	const [copied, setCopied] = useState(false);
	const rawToCopy = copyValue ?? value;

	const handleCopy = () => {
		if (typeof navigator !== "undefined" && navigator.clipboard) {
			void navigator.clipboard.writeText(rawToCopy);
		}
		setCopied(true);
		setTimeout(() => setCopied(false), 1500);
	};

	return (
		<div className="group flex h-7 items-center justify-between gap-2 border-b border-line px-3 last:border-b-0">
			<span className="shrink-0 text-[12px] text-ink-2">{label}</span>
			<div className="flex min-w-0 items-center gap-1">
				<span
					title={rawToCopy}
					className="min-w-0 truncate font-mono text-[12px] text-ink tabular-nums"
				>
					{value}
				</span>
				<button
					type="button"
					onClick={handleCopy}
					aria-label={`复制 ${label}`}
					title={`复制 ${label}`}
					className="inline-flex size-5 shrink-0 items-center justify-center rounded-[5px] text-ink-3 opacity-0 transition-opacity duration-150 group-hover:opacity-100 hover:bg-hover hover:text-ink-2 focus-visible:opacity-100"
				>
					{copied ? (
						<Check size={11} strokeWidth={2.5} className="text-green" />
					) : (
						<Copy size={11} strokeWidth={2} />
					)}
				</button>
			</div>
		</div>
	);
}

/**
 * FRONTEND §6.16 & DESIGN §9.7 信息 tab:
 * - Refreshes `get_session_stats` on open and when `view.statsStale` is true.
 * - Key-value rows (h-7 / 28px, key 12 ink-2, value mono 12 ink, copyable):
 *   sessionId, sessionFile, model, context usage meter, cost, message counts,
 *   token breakdown, routedModels.
 * - Collapsible sections for systemPrompt (`state.systemPrompt`) and tools (`state.dumpTools`).
 */
export function InfoTab({ sessionId, view }: InfoTabProps) {
	const [promptOpen, setPromptOpen] = useState(false);
	const [toolsOpen, setToolsOpen] = useState(false);
	const [refreshing, setRefreshing] = useState(false);

	const statsStale = view?.statsStale ?? false;

	const refreshStats = async () => {
		const currentView = useAppStore.getState().views[sessionId];
		if (!currentView || currentView.readonly || currentView.proc !== "ready") return;
		setRefreshing(true);
		try {
			const stats = await getBridge().rpc(sessionId, { type: "get_session_stats" });
			updateSessionView(sessionId, curr => ({
				...curr,
				stats,
				statsStale: false,
			}));
		} catch {
			/* session may not be active */
		} finally {
			setRefreshing(false);
		}
	};

	useEffect(() => {
		void refreshStats();
	}, [sessionId, statsStale]);

	const state = view?.state;
	const stats = view?.stats;
	const ctxUsage = stats?.contextUsage ?? state?.contextUsage;
	const sessionFile = stats?.sessionFile ?? state?.sessionFile;
	const modelStr = state?.model ? `${state.model.provider}/${state.model.id}` : "—";
	const routedEntries = stats?.routedModels ? Object.entries(stats.routedModels) : [];
	const systemPrompt = state?.systemPrompt ?? [];
	const dumpTools = state?.dumpTools ?? [];

	return (
		<div className="flex flex-col gap-2">
			{/* Session & Context Usage */}
			<div className="flex items-center justify-between px-0.5 pt-1 pb-0.5">
				<span className="text-[10.5px] font-medium tracking-[0.08em] text-ink-3 uppercase">
					会话概览
				</span>
				<IconButton
					size="sm"
					label="刷新统计信息"
					disabled={refreshing}
					onClick={() => void refreshStats()}
				>
					<RefreshCw
						size={12}
						strokeWidth={2}
						className={refreshing ? "animate-[spin_0.7s_linear_infinite]" : ""}
					/>
				</IconButton>
			</div>

			<Card>
				<CopyableKvRow label="会话 ID" value={stats?.sessionId ?? state?.sessionId ?? sessionId} />
				{sessionFile && (
					<CopyableKvRow
						label="会话文件"
						value={sessionFile.split(/[\\/]/).slice(-2).join("/")}
						copyValue={sessionFile}
					/>
				)}
				<CopyableKvRow label="当前模型" value={modelStr} />
				{state?.thinkingLevel && (
					<CopyableKvRow label="思考级别" value={String(state.thinkingLevel)} />
				)}
				{ctxUsage && (
					<div className="border-b border-line px-3 py-2 last:border-b-0">
						<div className="flex items-center justify-between text-[12px] text-ink-2">
							<span>上下文用量</span>
							<span className="font-mono text-[12px] text-ink tabular-nums">
								{formatCompactTokens(ctxUsage.tokens)} /{" "}
								{formatCompactTokens(ctxUsage.contextWindow)} ({Math.round(ctxUsage.percent)}%)
							</span>
						</div>
						<div className="mt-1.5 h-1 overflow-hidden rounded-pill bg-field">
							<div
								style={{ width: `${Math.min(100, Math.max(0, ctxUsage.percent))}%` }}
								className={
									"h-full rounded-pill transition-[width] duration-400 ease-[var(--ease-out-strong)] " +
									(ctxUsage.percent >= 95
										? "bg-red"
										: ctxUsage.percent >= 80
											? "bg-orange"
											: "bg-accent")
								}
							/>
						</div>
					</div>
				)}
			</Card>

			{/* Session Stats */}
			{stats && (
				<>
					<div className="px-0.5 pt-1 pb-0.5 text-[10.5px] font-medium tracking-[0.08em] text-ink-3 uppercase">
						统计与用量
					</div>
					<Card>
						<CopyableKvRow label="总花费" value={`$${stats.cost.toFixed(4)}`} />
						<CopyableKvRow
							label="消息总数"
							value={`${stats.totalMessages} (用户 ${stats.userMessages} · 助手 ${stats.assistantMessages})`}
						/>
						<CopyableKvRow
							label="工具调用"
							value={`${stats.toolCalls} 次 (结果 ${stats.toolResults})`}
						/>
						<CopyableKvRow
							label="总 Tokens"
							value={stats.tokens.total.toLocaleString("en-US")}
						/>
						<CopyableKvRow
							label="输入 / 输出"
							value={`${formatCompactTokens(stats.tokens.input)} / ${formatCompactTokens(stats.tokens.output)}`}
						/>
						<CopyableKvRow
							label="缓存读 / 写"
							value={`${formatCompactTokens(stats.tokens.cacheRead)} / ${formatCompactTokens(stats.tokens.cacheWrite)}`}
						/>
						{stats.tokens.reasoning !== undefined && (
							<CopyableKvRow
								label="思考 Tokens"
								value={formatCompactTokens(stats.tokens.reasoning)}
							/>
						)}
						{stats.premiumRequests > 0 && (
							<CopyableKvRow label="高级请求" value={`${stats.premiumRequests}`} />
						)}
					</Card>
				</>
			)}

			{/* Routed models */}
			{routedEntries.length > 0 && (
				<>
					<div className="px-0.5 pt-1 pb-0.5 text-[10.5px] font-medium tracking-[0.08em] text-ink-3 uppercase">
						路由模型 (routedModels)
					</div>
					<Card>
						{routedEntries.map(([model, count]) => (
							<CopyableKvRow key={model} label={model} value={`${count} 次`} copyValue={model} />
						))}
					</Card>
				</>
			)}

			{/* Collapsible System Prompt */}
			<Card>
				<button
					type="button"
					aria-expanded={promptOpen}
					onClick={() => setPromptOpen(v => !v)}
					className="flex h-9 w-full items-center justify-between px-3 text-left text-[12.5px] font-medium text-ink transition-colors duration-100 hover:bg-hover"
				>
					<span>系统提示词 ({systemPrompt.length} 段)</span>
					<ChevronDown
						size={13}
						strokeWidth={2.2}
						className={
							"text-ink-3 transition-transform duration-200 ease-[var(--ease-out-strong)] " +
							(promptOpen ? "rotate-180" : "")
						}
					/>
				</button>
				<Collapsible open={promptOpen} duration={300}>
					<div className="border-t border-line p-2.5">
						{systemPrompt.length === 0 ? (
							<div className="text-[12px] text-ink-2">未提供系统提示词快照</div>
						) : (
							<div className="flex max-h-60 flex-col gap-2 overflow-auto">
								{systemPrompt.map((section, idx) => (
									<pre
										key={`sp-${idx}`}
										className="rounded-control bg-inset p-2 font-mono text-[11px] leading-[1.55] whitespace-pre-wrap text-ink-2 shadow-hairline"
									>
										{section}
									</pre>
								))}
							</div>
						)}
					</div>
				</Collapsible>
			</Card>

			{/* Collapsible Tools */}
			<Card>
				<button
					type="button"
					aria-expanded={toolsOpen}
					onClick={() => setToolsOpen(v => !v)}
					className="flex h-9 w-full items-center justify-between px-3 text-left text-[12.5px] font-medium text-ink transition-colors duration-100 hover:bg-hover"
				>
					<span>可用工具 ({dumpTools.length})</span>
					<ChevronDown
						size={13}
						strokeWidth={2.2}
						className={
							"text-ink-3 transition-transform duration-200 ease-[var(--ease-out-strong)] " +
							(toolsOpen ? "rotate-180" : "")
						}
					/>
				</button>
				<Collapsible open={toolsOpen} duration={300}>
					<div className="max-h-64 overflow-auto border-t border-line">
						{dumpTools.length === 0 ? (
							<div className="p-2.5 text-[12px] text-ink-2">未提供工具列表</div>
						) : (
							dumpTools.map(tool => (
								<div
									key={tool.name}
									className="border-b border-line px-3 py-2 last:border-b-0"
								>
									<div className="font-mono text-[12px] font-medium text-ink">{tool.name}</div>
									{tool.description && (
										<div className="mt-0.5 line-clamp-2 text-[11.5px] text-ink-2">
											{tool.description}
										</div>
									)}
								</div>
							))
						)}
					</div>
				</Collapsible>
			</Card>
		</div>
	);
}
