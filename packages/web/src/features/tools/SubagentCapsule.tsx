/**
 * Subagent capsule row embedded inside `task` tool details (FRONTEND §6.13, DESIGN §10.2).
 * Clicking opens the subagent drawer by dispatching `open-subagent` with `{ sessionId, subagentId }`.
 */
import { ChevronDown } from "lucide-react";
import { useState } from "react";
import type { SubagentView } from "../../store/session-reducer";
import { Pill, StatusBadge } from "../../ui/Chip";
import { Collapsible } from "../../ui/Collapsible";
import { SpinnerRing } from "../../ui/Spinner";
import {
	countActiveSubagentDescendants,
	countSubagentDescendants,
	type SubagentTreeNode,
} from "../subagents/subagent-utils";

export interface SubagentCapsuleProps {
	subagent: SubagentView;
	sessionId?: string;
	defaultOpen?: boolean;
	/** Nested subagents spawned by this one (rendered recursively when expanded). */
	childNodes?: SubagentTreeNode[];
	/** Nesting depth; nested capsules use a flatter style. */
	depth?: number;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function formatProgressMeta(progress?: Record<string, unknown>): string {
	if (!progress) return "";
	const parts: string[] = [];
	const turns = progress.turns ?? progress.turnCount ?? progress.step;
	if (typeof turns === "number" && turns > 0) {
		parts.push(`${turns} 轮`);
	}
	const tokens = progress.tokens ?? progress.totalTokens ?? progress.tokensUsed;
	if (typeof tokens === "number" && tokens > 0) {
		parts.push(tokens >= 1000 ? `${(tokens / 1000).toFixed(1).replace(/\.0$/, "")}k` : `${tokens}`);
	} else if (typeof tokens === "string" && tokens.length > 0) {
		parts.push(tokens);
	}
	return parts.join(" · ");
}

function extractProgressEntries(progress?: Record<string, unknown>): Array<{ label: string; value: string }> {
	if (!progress) return [];
	const rows: Array<{ label: string; value: string }> = [];
	if (Array.isArray(progress.steps)) {
		for (const item of progress.steps) {
			if (isPlainRecord(item)) {
				const label = typeof item.label === "string" ? item.label : typeof item.tool === "string" ? item.tool : "";
				const value = typeof item.value === "string" ? item.value : typeof item.meta === "string" ? item.meta : "";
				if (label) rows.push({ label, value });
			}
		}
	}
	if (rows.length > 0) return rows;
	if (typeof progress.currentTool === "string" && progress.currentTool.length > 0) {
		rows.push({
			label: `正在运行 ${progress.currentTool}`,
			value: typeof progress.currentTarget === "string" ? progress.currentTarget : "",
		});
	}
	for (const [k, v] of Object.entries(progress)) {
		if (k === "turns" || k === "turnCount" || k === "tokens" || k === "totalTokens" || k === "currentTool" || k === "currentTarget" || k === "steps") {
			continue;
		}
		if (typeof v === "string" || typeof v === "number") {
			rows.push({ label: k, value: String(v) });
		}
	}
	return rows.slice(0, 6);
}

export function dispatchOpenSubagent(sessionId: string | undefined, subagentId: string): void {
	if (typeof window === "undefined") return;
	window.dispatchEvent(
		new CustomEvent("open-subagent", {
			detail: { sessionId: sessionId ?? "", subagentId },
			bubbles: true,
		}),
	);
}

export function SubagentCapsule({ subagent, sessionId, defaultOpen, childNodes, depth = 0 }: SubagentCapsuleProps) {
	const [open, setOpen] = useState(defaultOpen ?? subagent.status === "running");
	const children = childNodes ?? [];
	const self: SubagentTreeNode = { subagent, children, depth };
	const descendantCount = countSubagentDescendants(self);
	const activeDescendants = countActiveSubagentDescendants(self);
	const metaText = formatProgressMeta(subagent.progress);
	const detailRows = extractProgressEntries(subagent.progress);
	const desc = subagent.description ?? subagent.task ?? subagent.assignment ?? "";

	const renderBadge = () => {
		if (subagent.status === "completed") return <StatusBadge status="success" />;
		if (subagent.status === "failed") return <StatusBadge status="error" />;
		if (subagent.status === "aborted") return <StatusBadge status="aborted" />;
		return <SpinnerRing active={subagent.status === "running"} index={subagent.index} />;
	};

	const renderPill = () => {
		if (subagent.status === "completed") return <Pill tone="green">完成</Pill>;
		if (subagent.status === "failed") return <Pill tone="red">失败</Pill>;
		if (subagent.status === "aborted") return <Pill tone="neutral">中止</Pill>;
		return null;
	};

	return (
		<div
			data-subagent-id={subagent.id}
			data-subagent-depth={depth}
			className={
				depth > 0
					? "rounded-[12px] bg-inset"
					: "bg-surface shadow-card transition-[border-radius] duration-300 " +
						(open ? "rounded-[14px]" : "rounded-[22px]")
			}
		>
			<div className="flex h-[44px] w-full items-center gap-2.5 px-2.5 text-left">
				<button
					type="button"
					onClick={() => {
						dispatchOpenSubagent(sessionId, subagent.id);
						setOpen(o => !o);
					}}
					className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
				>
					{renderBadge()}
					<span className="shrink-0 text-[13px] font-medium text-ink">{subagent.agent}</span>
					{desc && <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-2">{desc}</span>}
					{metaText && <span className="mono shrink-0 text-[11.5px] text-ink-2 tabular-nums">{metaText}</span>}
					{descendantCount > 0 && (
						<span
							className="shrink-0 rounded-full bg-hover px-1.5 text-[11px] leading-[18px] text-ink-2 tabular-nums"
							title={activeDescendants > 0 ? `${activeDescendants} 个子代理运行中` : undefined}
							data-testid="subagent-descendants"
						>
							+{descendantCount} 子代理
						</span>
					)}
					{renderPill()}
				</button>
				<button
					type="button"
					aria-label={open ? "收起子代理详情" : "展开子代理详情"}
					aria-expanded={open}
					onClick={() => setOpen(o => !o)}
					className="inline-flex size-6 shrink-0 items-center justify-center rounded-control text-ink-3 transition-colors hover:bg-hover hover:text-ink-2"
				>
					<ChevronDown
						size={14}
						strokeWidth={2.2}
						className={"i transition-transform duration-200 " + (open ? "rotate-180" : "")}
					/>
				</button>
			</div>
			<Collapsible open={open} duration={300}>
				<div className="grid grid-cols-[22px_1fr] gap-2.5 px-2.5 pb-2.5">
					<span className="mx-auto w-px bg-line" />
					<div className="flex min-w-0 flex-col gap-0.5">
						{detailRows.map((row, idx) => (
							<div
								key={idx}
								style={{ animationDelay: `${Math.min(idx, 5) * 100}ms` }}
								className="anim-fade-up flex items-center justify-between text-[12px] leading-[22px] text-ink-2"
							>
								<span className="truncate">{row.label}</span>
								{row.value && <span className="mono shrink-0 text-[11.5px] tabular-nums">{row.value}</span>}
							</div>
						))}
						<div className="flex items-center justify-between text-[12px] leading-[22px]">
							<button
								type="button"
								onClick={() => dispatchOpenSubagent(sessionId, subagent.id)}
								className="text-accent-ink hover:underline"
							>
								查看完整记录 →
							</button>
						</div>
						{children.length > 0 && (
							<div className="mt-1.5 flex flex-col gap-1.5" data-testid="subagent-children">
								{children.map(child => (
									<SubagentCapsule
										key={child.subagent.id}
										subagent={child.subagent}
										sessionId={sessionId}
										childNodes={child.children}
										depth={depth + 1}
									/>
								))}
							</div>
						)}
					</div>
				</div>
			</Collapsible>
		</div>
	);
}
