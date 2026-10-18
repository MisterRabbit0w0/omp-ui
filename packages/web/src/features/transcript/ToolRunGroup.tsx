/**
 * ToolRunGroup component (FRONTEND §6.5.3, DESIGN §8).
 * Renders a group of tool calls within an assistant turn:
 * - Collapsible group header ("N 个工具调用 · M 个文件"), auto-collapses >4 rows after turn ends
 * - Merged read-only groups (≥3 consecutive read/grep/glob/find/lsp → "查看了 N 个文件")
 * - Tool rows with states: running / success / error (auto-open) / denied / awaiting approval
 * - Anchored ApprovalCard directly below the awaiting tool row
 * - File change chips at bottom of group (up to 4 + "+N 个文件", clicking opens 变更 tab in SidePanel)
 */
import type { ApprovalPrompt } from "@omp-ui/protocol";
import { Ban, ChevronDown, Search, ShieldAlert, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useAppStore } from "../../store/app-store";
import { approvalReceiptKind, askSummaryLines, type SubagentView, type ToolExec, type ToolGroup, type TurnTool } from "../../store/session-reducer";
import { Collapsible } from "../../ui/Collapsible";
import { Icon, toolIcon } from "../../ui/Icon";
import { ShimmerText } from "../../ui/ShimmerText";
import { Spinner } from "../../ui/Spinner";
import { computeDiffFromOldNew, extractDiffSource, parseUnifiedDiffText } from "../tools/DiffView";
import { getToolRowSummary, renderToolDetail, resolveToolRenderer, stripLineSelector } from "../tools/registry";
import { ApprovalCard, ApprovalReceipt, type ApprovalReceiptState } from "./ApprovalCard";
import { AskCard, AskSummary } from "./AskCard";
import type { AnchoredAsk } from "./ask-anchor";

export interface ToolRunGroupProps {
	sessionId: string;
	tools: TurnTool[];
	groups: ToolGroup[];
	toolExec: Map<string, ToolExec>;
	subagents: Map<string, SubagentView>;
	anchoredApprovals: Map<string, ApprovalPrompt[]>;
	anchoredAsks: Map<string, AnchoredAsk[]>;
	isTurnRunning: boolean;
	focusedToolCallId?: string | null;
}

interface FileDiffChipItem {
	path: string;
	shortName: string;
	toolCallId: string;
	additions: number;
	deletions: number;
}

const CHANGE_TOOL_SET: Record<string, true> = {
	edit: true,
	write: true,
	notebook: true,
};

function isPlainRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isDeniedToolResult(t: TurnTool, receiptState?: ApprovalReceiptState): boolean {
	if (receiptState === "denied") return true;
	if (!t.result?.isError) return false;
	for (const block of t.result.content) {
		if (block.type === "text") {
			const lower = block.text.toLowerCase();
			if (
				lower.includes("denied") ||
				lower.includes("rejected") ||
				lower.includes("permission") ||
				lower.includes("拒绝")
			) {
				return true;
			}
		}
	}
	return false;
}

function collectTouchedFileCount(tools: TurnTool[]): number {
	const files = new Set<string>();
	for (const t of tools) {
		const args = isPlainRecord(t.call.arguments) ? t.call.arguments : {};
		const rawPath = args.path ?? args.file ?? args.filePath ?? args.notebookPath;
		if (typeof rawPath === "string" && rawPath.length > 0) {
			files.add(stripLineSelector(rawPath));
		}
		if (t.result && isPlainRecord(t.result.details) && Array.isArray(t.result.details.perFileResults)) {
			for (const item of t.result.details.perFileResults) {
				if (isPlainRecord(item) && typeof item.path === "string") {
					files.add(item.path);
				}
			}
		}
	}
	return files.size;
}

function collectChangedFileChips(tools: TurnTool[], toolExec: Map<string, ToolExec>): FileDiffChipItem[] {
	const byPath = new Map<string, FileDiffChipItem>();

	const addFileStats = (rawPath: string, toolCallId: string, add: number, del: number) => {
		const cleanPath = stripLineSelector(rawPath);
		const shortName = cleanPath.split(/[/\\]/).pop() ?? cleanPath;
		const prev = byPath.get(cleanPath);
		if (prev) {
			prev.additions += add;
			prev.deletions += del;
			prev.toolCallId = toolCallId;
		} else {
			byPath.set(cleanPath, {
				path: cleanPath,
				shortName,
				toolCallId,
				additions: add,
				deletions: del,
			});
		}
	};

	for (const t of tools) {
		if (!CHANGE_TOOL_SET[t.call.name]) continue;
		const exec = t.exec ?? toolExec.get(t.call.id);
		const isDone = t.result ? !t.result.isError : exec?.status === "done";
		if (!isDone) continue;

		const src = extractDiffSource(t.call.arguments, t.result?.details);
		if (src.perFileResults && src.perFileResults.length > 0) {
			for (const pf of src.perFileResults) {
				if (!pf.filePath) continue;
				let add = pf.additions ?? 0;
				let del = pf.deletions ?? 0;
				if (add === 0 && del === 0) {
					if (pf.oldText !== undefined || pf.newText !== undefined) {
						const p = computeDiffFromOldNew(pf.oldText ?? "", pf.newText ?? "");
						add = p.additions;
						del = p.deletions;
					} else if (pf.diff) {
						const p = parseUnifiedDiffText(pf.diff);
						add = p.additions;
						del = p.deletions;
					}
				}
				addFileStats(pf.filePath, t.call.id, add, del);
			}
			continue;
		}

		if (!src.filePath) continue;
		let add = src.additions ?? 0;
		let del = src.deletions ?? 0;
		if (add === 0 && del === 0) {
			if (src.oldText !== undefined || src.newText !== undefined) {
				const p = computeDiffFromOldNew(src.oldText ?? "", src.newText ?? "");
				add = p.additions;
				del = p.deletions;
			} else if (src.diff) {
				const p = parseUnifiedDiffText(src.diff);
				add = p.additions;
				del = p.deletions;
			}
		}
		addFileStats(src.filePath, t.call.id, add, del);
	}

	return Array.from(byPath.values());
}

function ReadOnlyMergedRow({
	group,
	sessionId,
	toolExec,
	subagents,
}: {
	group: ToolGroup;
	sessionId: string;
	toolExec: Map<string, ToolExec>;
	subagents: Map<string, SubagentView>;
}) {
	const [open, setOpen] = useState(false);
	const [expandedSubId, setExpandedSubId] = useState<string | null>(null);

	const fileLabels: string[] = [];
	let totalMs = 0;
	for (const t of group.tools) {
		const sum = getToolRowSummary(t.call, t.result, t.exec ?? toolExec.get(t.call.id));
		const short = sum.chipText.split(/[/\\]/).pop() ?? sum.chipText;
		if (short) fileLabels.push(short);
		const ex = t.exec ?? toolExec.get(t.call.id);
		if (ex?.startedAt && ex?.endedAt && ex.endedAt >= ex.startedAt) {
			totalMs += ex.endedAt - ex.startedAt;
		}
	}
	const durationStr = totalMs > 0 ? `${(totalMs / 1000).toFixed(1)}s` : undefined;

	return (
		<div className={"tool " + (open ? "open" : "")}>
			<button
				type="button"
				aria-expanded={open}
				onClick={() => setOpen(o => !o)}
				className="group/trow -ml-[3px] flex h-7 w-[calc(100%+6px)] items-center gap-2 rounded-control px-[3px] text-left transition-colors duration-100 hover:bg-hover-2"
			>
				<span className="relative grid size-4 shrink-0 place-items-center text-ink-3">
					<Icon
						icon={Search}
						preset="inline"
						className={
							"col-start-1 row-start-1 transition-[opacity,transform] duration-150 group-hover/trow:opacity-0 " +
							(open ? "opacity-0" : "opacity-100")
						}
					/>
					<ChevronDown
						size={12}
						strokeWidth={2.2}
						className={
							"i col-start-1 row-start-1 transition-[opacity,transform] duration-150 group-hover/trow:opacity-100 " +
							(open ? "rotate-0 opacity-100" : "-rotate-90 opacity-0")
						}
					/>
				</span>
				<span className="shrink-0 text-[12.5px] font-medium text-ink">
					查看了 {group.tools.length} 个文件
				</span>
				<span className="mono min-w-0 flex-1 truncate rounded-chip bg-hover-2 px-1.5 text-[11.5px] leading-[22px] h-[22px] text-ink-2 shadow-hairline dark:bg-field">
					{fileLabels.join(", ")}
				</span>
				{durationStr && (
					<span className="mono shrink-0 text-[11.5px] text-ink-2 tabular-nums">{durationStr}</span>
				)}
			</button>

			<Collapsible open={open} duration={300}>
				<div className="my-0.5 ml-2 border-l border-line py-0.5 pl-3.5">
					<div className="flex flex-col gap-0.5">
						{group.tools.map(t => {
							const ex = t.exec ?? toolExec.get(t.call.id);
							const sum = getToolRowSummary(t.call, t.result, ex);
							const isSubOpen = expandedSubId === t.call.id;
							return (
								<div key={t.call.id}>
									<button
										type="button"
										onClick={() => setExpandedSubId(prev => (prev === t.call.id ? null : t.call.id))}
										className="flex h-6 w-full items-center gap-2 rounded-chip px-1.5 text-left mono text-[11.5px] text-ink-2 transition-colors hover:bg-hover-2 hover:text-ink"
									>
										<span className="truncate">{sum.chipText || t.call.name}</span>
										{sum.durationText && <span className="ml-auto shrink-0 tabular-nums">{sum.durationText}</span>}
									</button>
									{isSubOpen && (
										<div className="my-1">
											{renderToolDetail({
												callId: t.call.id,
												toolName: t.call.name,
												args: t.call.arguments ?? ex?.args,
												result: t.result,
												exec: ex,
												subagents,
												sessionId,
											})}
										</div>
									)}
								</div>
							);
						})}
					</div>
				</div>
			</Collapsible>
		</div>
	);
}

function SingleToolRow({
	tool,
	sessionId,
	toolExec,
	subagents,
	approvals,
	asks,
	focused,
}: {
	tool: TurnTool;
	sessionId: string;
	toolExec: Map<string, ToolExec>;
	subagents: Map<string, SubagentView>;
	approvals: ApprovalPrompt[];
	asks: AnchoredAsk[];
	focused: boolean;
}) {
	const exec = tool.exec ?? toolExec.get(tool.call.id);
	const renderer = resolveToolRenderer(tool.call.name);
	const isError = Boolean(tool.result?.isError || exec?.status === "error");
	const [localReceipt, setReceiptState] = useState<ApprovalReceiptState | undefined>(undefined);
	// Durable receipt: survives remounts (virtualization), other-tab answers and reload replay.
	const answered = useAppStore(s => s.views[sessionId]?.answeredUi);
	const answeredEntry = answered?.findLast(a => a.toolCallId === tool.call.id);
	const durableReceipt = answeredEntry ? approvalReceiptKind(answeredEntry, tool.result) : undefined;
	const receiptState: ApprovalReceiptState | undefined = localReceipt ?? durableReceipt;
	const isDenied = isDeniedToolResult(tool, receiptState);
	const isAwaitingApproval = approvals.length > 0 && receiptState === undefined;
	const isRunning = !isAwaitingApproval && !tool.result && exec?.status === "running";

	const [open, setOpen] = useState<boolean>(() => Boolean(renderer.defaultOpen || isError || focused));
	const rowRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		if (isError && !isDenied) {
			setOpen(true);
		}
	}, [isError, isDenied]);

	useEffect(() => {
		if (focused) {
			setOpen(true);
			rowRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
		}
	}, [focused]);

	const summary = getToolRowSummary(tool.call, tool.result, exec);
	const BaseIcon = toolIcon(tool.call.name);

	const renderIconSlot = () => {
		if (isAwaitingApproval) {
			return (
				<span className="relative grid size-4 shrink-0 place-items-center text-orange">
					<ShieldAlert
						size={13}
						strokeWidth={2}
						className="i animate-[pulse-dot_1.6s_infinite]"
					/>
				</span>
			);
		}
		if (isRunning) {
			return (
				<span className="relative grid size-4 shrink-0 place-items-center">
					<Spinner />
				</span>
			);
		}
		if (isDenied) {
			return (
				<span className="relative grid size-4 shrink-0 place-items-center text-ink-3">
					<Ban size={13} strokeWidth={2} className="i" />
				</span>
			);
		}
		if (isError) {
			return (
				<span className="relative grid size-4 shrink-0 place-items-center text-red">
					<X size={13} strokeWidth={2.2} className="i" />
				</span>
			);
		}
		return (
			<span className="relative grid size-4 shrink-0 place-items-center text-ink-3">
				<Icon
					icon={BaseIcon}
					preset="inline"
					className={
						"col-start-1 row-start-1 transition-[opacity,transform] duration-150 group-hover/trow:opacity-0 " +
						(open ? "opacity-0" : "opacity-100")
					}
				/>
				<ChevronDown
					size={12}
					strokeWidth={2.2}
					className={
						"i col-start-1 row-start-1 transition-[opacity,transform] duration-150 group-hover/trow:opacity-100 " +
						(open ? "rotate-0 opacity-100" : "-rotate-90 opacity-0")
					}
				/>
			</span>
		);
	};

	const renderLabel = () => {
		if (isRunning) {
			return (
				<ShimmerText active className="shrink-0 text-[12.5px] font-medium">
					{summary.verb}
				</ShimmerText>
			);
		}
		if (isDenied) {
			return (
				<span className="shrink-0 text-[12.5px] font-medium text-ink-2 line-through">
					{summary.verb}
				</span>
			);
		}
		if (isError) {
			return (
				<span className="shrink-0 text-[12.5px] font-medium text-red-ink">
					{summary.verb}
				</span>
			);
		}
		return (
			<span className="shrink-0 text-[12.5px] font-medium text-ink">
				{summary.verb}
			</span>
		);
	};

	const renderRightMeta = () => {
		if (summary.additions !== undefined || summary.deletions !== undefined) {
			const add = summary.additions ?? 0;
			const del = summary.deletions ?? 0;
			if (add > 0 || del > 0) {
				return (
					<span className="mono shrink-0 text-[11.5px] tabular-nums">
						{add > 0 && <span className="text-green-ink">+{add}</span>}
						{add > 0 && del > 0 && " "}
						{del > 0 && <span className="text-red-ink">−{del}</span>}
					</span>
				);
			}
		}
		if (summary.durationText) {
			return <span className="mono shrink-0 text-[11.5px] text-ink-2 tabular-nums">{summary.durationText}</span>;
		}
		return null;
	};

	return (
		<div ref={rowRef} data-tool-call-id={tool.call.id} className={"tool " + (open ? "open" : "")}>
			<button
				type="button"
				aria-expanded={open}
				onClick={() => setOpen(o => !o)}
				className="group/trow -ml-[3px] flex h-7 w-[calc(100%+6px)] items-center gap-2 rounded-control px-[3px] text-left transition-colors duration-100 hover:bg-hover-2"
			>
				{renderIconSlot()}
				{renderLabel()}
				{summary.chipText && (
					<span
						className={
							"min-w-0 flex-1 truncate rounded-chip bg-hover-2 px-1.5 text-[11.5px] leading-[22px] h-[22px] text-ink-2 shadow-hairline dark:bg-field " +
							(summary.monoChip ? "mono " : "") +
							(isDenied ? "opacity-55 " : "")
						}
					>
						{summary.chipText}
					</span>
				)}
				{renderRightMeta()}
			</button>

			{approvals.map(appr => (
				<ApprovalCard
					key={appr.requestId}
					sessionId={sessionId}
					approval={appr}
					onResolved={state => setReceiptState(state)}
				/>
			))}
			{approvals.length === 0 && receiptState !== undefined && <ApprovalReceipt state={receiptState} />}

			{asks.map(ask =>
				ask.entry ? (
					<AskSummary key={ask.request.id} lines={askSummaryLines(ask.entry)} />
				) : (
					<AskCard key={ask.request.id} sessionId={sessionId} request={ask.request} />
				),
			)}

			<Collapsible open={open} duration={300}>
				<div className="my-0.5 ml-2 border-l border-line py-0.5 pl-3.5">
					{renderToolDetail({
						callId: tool.call.id,
						toolName: tool.call.name,
						args: tool.call.arguments ?? exec?.args,
						result: tool.result,
						exec,
						subagents,
						sessionId,
					})}
				</div>
			</Collapsible>
		</div>
	);
}

export function ToolRunGroup({
	sessionId,
	tools,
	groups,
	toolExec,
	subagents,
	anchoredApprovals,
	anchoredAsks,
	isTurnRunning,
	focusedToolCallId,
}: ToolRunGroupProps) {
	const hasAnyError = tools.some(t => t.result?.isError || (t.exec ?? toolExec.get(t.call.id))?.status === "error");
	const hasAnyApproval = tools.some(t => (anchoredApprovals.get(t.call.id)?.length ?? 0) > 0);
	const hasPendingAsk = tools.some(t => (anchoredAsks.get(t.call.id) ?? []).some(a => !a.entry));
	const rowCount = groups.length;

	const [open, setOpen] = useState<boolean>(() => isTurnRunning || rowCount <= 4 || hasAnyError || hasAnyApproval || hasPendingAsk);
	const [showAllDiffChips, setShowAllDiffChips] = useState(false);
	const userToggledRef = useRef(false);
	const prevTurnRunningRef = useRef(isTurnRunning);

	// §6.5.3: Running defaults to open; when turn finishes, groups with > 4 rows auto-collapse
	useEffect(() => {
		if (userToggledRef.current) {
			prevTurnRunningRef.current = isTurnRunning;
			return;
		}
		if (isTurnRunning || hasAnyApproval || hasAnyError || hasPendingAsk) {
			setOpen(true);
		} else if (prevTurnRunningRef.current && !isTurnRunning && rowCount > 4) {
			setOpen(false);
		}
		prevTurnRunningRef.current = isTurnRunning;
	}, [isTurnRunning, rowCount, hasAnyApproval, hasAnyError, hasPendingAsk]);

	useEffect(() => {
		if (focusedToolCallId && tools.some(t => t.call.id === focusedToolCallId)) {
			setOpen(true);
		}
	}, [focusedToolCallId, tools]);

	if (tools.length === 0) return null;

	const fileCount = collectTouchedFileCount(tools);
	const changedChips = !isTurnRunning ? collectChangedFileChips(tools, toolExec) : [];
	const visibleChips = showAllDiffChips ? changedChips : changedChips.slice(0, 4);
	const extraChipsCount = changedChips.length - visibleChips.length;

	const handleClickDiffChip = (chip: FileDiffChipItem) => {
		if (typeof window === "undefined") return;
		const detail = {
			tab: "changes",
			file: chip.path,
			filePath: chip.path,
			path: chip.path,
			toolCallId: chip.toolCallId,
			sessionId,
		};
		window.dispatchEvent(new CustomEvent("open-panel", { detail, bubbles: true }));
		window.dispatchEvent(new CustomEvent("open-panel-tab", { detail, bubbles: true }));
		window.dispatchEvent(new CustomEvent("select-changed-file", { detail, bubbles: true }));
	};

	return (
		<div>
			<button
				type="button"
				aria-expanded={open}
				onClick={() => {
					userToggledRef.current = true;
					setOpen(o => !o);
				}}
				className="-ml-1.5 inline-flex w-fit items-center gap-1.5 rounded-control px-1.5 py-1 text-[12.5px] text-ink-2 transition-colors duration-100 hover:bg-hover-2"
			>
				<ChevronDown
					size={12}
					strokeWidth={2.2}
					className={"i transition-transform duration-200 " + (open ? "rotate-0" : "-rotate-90")}
				/>
				<span className="tabular-nums">
					{tools.length} 个工具调用
					{fileCount > 0 ? ` · ${fileCount} 个文件` : ""}
				</span>
			</button>

			<Collapsible open={open} duration={300}>
				<div className="-mx-1.5 px-1.5 pb-1">
					<div className="mt-1 flex flex-col gap-1">
						{groups.map((grp, idx) => {
							if (grp.readOnlyCollapsed) {
								return (
									<ReadOnlyMergedRow
										key={`ro-${grp.tools[0]?.call.id ?? idx}`}
										group={grp}
										sessionId={sessionId}
										toolExec={toolExec}
										subagents={subagents}
									/>
								);
							}
							const single = grp.tools[0];
							if (!single) return null;
							return (
								<SingleToolRow
									key={single.call.id || `tool-${idx}`}
									tool={single}
									sessionId={sessionId}
									toolExec={toolExec}
									subagents={subagents}
									approvals={anchoredApprovals.get(single.call.id) ?? []}
									asks={anchoredAsks.get(single.call.id) ?? []}
									focused={focusedToolCallId === single.call.id}
								/>
							);
						})}
					</div>

					{changedChips.length > 0 && (
						<div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-line pt-2.5">
							{visibleChips.map((chip, idx) => (
								<button
									key={chip.path}
									type="button"
									onClick={() => handleClickDiffChip(chip)}
									style={{ animationDelay: `${Math.min(idx, 5) * 80}ms` }}
									className="anim-pop-in inline-flex h-7 items-center gap-1.5 rounded-chip bg-surface px-2 shadow-btn mono text-[11.5px] text-ink transition-colors hover:bg-hover"
								>
									<span>{chip.shortName}</span>
									{chip.additions > 0 && <span className="text-green-ink">+{chip.additions}</span>}
									{chip.deletions > 0 && <span className="text-red-ink">−{chip.deletions}</span>}
								</button>
							))}
							{extraChipsCount > 0 && (
								<button
									type="button"
									onClick={() => setShowAllDiffChips(true)}
									className="px-1.5 text-[11.5px] text-ink-3 hover:underline"
								>
									+{extraChipsCount} 个文件
								</button>
							)}
						</div>
					)}
				</div>
			</Collapsible>
		</div>
	);
}
