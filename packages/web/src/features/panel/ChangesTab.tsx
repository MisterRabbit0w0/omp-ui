import { ChevronDown, ExternalLink, FileText, WrapText } from "lucide-react";
import { useEffect, useState } from "react";
import { DiffView } from "@/features/tools/DiffView";
import type { SessionView } from "@/store/session-reducer";
import { Card } from "@/ui/Card";
import { Collapsible } from "@/ui/Collapsible";
import { IconButton } from "@/ui/Button";
import { groupChangedFiles, scrollToToolCall } from "./panel-logic";

export interface ChangesTabProps {
	view: SessionView | undefined;
	/** File path requested to expand via `open-panel` / `open-panel-tab` event. */
	focusedFilePath?: string | null;
}

/**
 * FRONTEND §6.16 变更 tab:
 * - Groups `selectChangedFiles(view)` by file path.
 * - Each row is h-8 (32px): file icon + mono 12 path (dir in ink-2, filename in ink) + `+n −m`.
 * - Clicking toggles grid-rows Collapsible with merged `DiffView` AND dispatches
 *   `scroll-to-tool` `{ toolCallId }` so the transcript scrolls to the tool call.
 */
export function ChangesTab({ view, focusedFilePath }: ChangesTabProps) {
	const groups = groupChangedFiles(view);
	const [expandedPaths, setExpandedPaths] = useState<Record<string, boolean>>(() => {
		const first = groups[0]?.path;
		return first ? { [first]: true } : {};
	});
	const [wrapLines, setWrapLines] = useState(false);

	useEffect(() => {
		if (focusedFilePath) {
			setExpandedPaths(prev => ({ ...prev, [focusedFilePath]: true }));
		}
	}, [focusedFilePath]);

	if (groups.length === 0) {
		return (
			<Card className="px-3 py-3 text-[12.5px] text-ink-2">
				当前会话暂无文件变更记录
			</Card>
		);
	}

	const toggleFile = (path: string, latestToolCallId: string) => {
		setExpandedPaths(prev => ({ ...prev, [path]: !prev[path] }));
		scrollToToolCall(latestToolCallId);
	};

	return (
		<div className="flex min-w-0 flex-col gap-2">
			{groups.map(group => {
				const isOpen = Boolean(expandedPaths[group.path]);
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
								<span className="flex shrink-0 items-center gap-1.5 font-mono text-[11.5px] tabular-nums">
									{group.additions > 0 && (
										<span className="text-green-ink">+{group.additions}</span>
									)}
									{group.deletions > 0 && (
										<span className="text-red-ink">−{group.deletions}</span>
									)}
									{group.additions === 0 && group.deletions === 0 && (
										<span className="text-ink-2">{group.calls.length} 次</span>
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
							<IconButton
								size="sm"
								label={`定位到 ${group.base} 的工具调用`}
								onClick={() => scrollToToolCall(group.latestToolCallId)}
							>
								<ExternalLink size={12} strokeWidth={2} />
							</IconButton>
						</div>

						<Collapsible open={isOpen} duration={300}>
							<div className="min-w-0 border-t border-line">
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
		</div>
	);
}
