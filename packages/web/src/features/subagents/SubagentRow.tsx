import { ChevronDown } from "lucide-react";
import { useState } from "react";
import type { SubagentView } from "@/store/session-reducer";
import { Pill, StatusBadge } from "@/ui/Chip";
import { Collapsible } from "@/ui/Collapsible";
import { SpinnerRing } from "@/ui/Spinner";
import {
	extractSubagentDetailRows,
	extractSubagentMeta,
	openSubagentDrawer,
} from "./subagent-utils";

export interface SubagentRowProps {
	subagent: SubagentView;
	sessionId?: string | null;
	/** "capsule" (default, for task tool detail §6.13) or "list" (for SidePanel §6.13) */
	variant?: "capsule" | "list";
	defaultOpen?: boolean;
	onOpenTranscript?: (subagentId: string) => void;
	/** Nesting depth in the subagent tree ("list" variant indents by depth). */
	depth?: number;
	/** Number of nested subagents below this one (shown as a count chip). */
	descendantCount?: number;
}

function SubagentStatusGlyph({ subagent }: { subagent: SubagentView }) {
	switch (subagent.status) {
		case "running":
			return <SpinnerRing active index={subagent.index} />;
		case "pending":
			return <SpinnerRing active={false} index={subagent.index} />;
		case "completed":
			return (
				<span className="grid size-6 shrink-0 place-items-center">
					<StatusBadge status="success" />
				</span>
			);
		case "failed":
			return (
				<span className="grid size-6 shrink-0 place-items-center">
					<StatusBadge status="error" />
				</span>
			);
		case "aborted":
			return (
				<span className="grid size-6 shrink-0 place-items-center">
					<StatusBadge status="aborted" />
				</span>
			);
	}
}

function SubagentStatusPill({ status }: { status: SubagentView["status"] }) {
	switch (status) {
		case "completed":
			return <Pill tone="green">完成</Pill>;
		case "failed":
			return <Pill tone="red">失败</Pill>;
		case "aborted":
			return <Pill tone="neutral">已中止</Pill>;
		default:
			return null;
	}
}

/**
 * §6.13 SubagentRow:
 * - "capsule" variant: card with shadow-card, h44, radius 22 collapsed -> 14 expanded (300ms).
 * - "list" variant: row inside a Card in SidePanel, border-b line between rows, no capsule radius.
 */
export function SubagentRow({
	subagent,
	sessionId,
	variant = "capsule",
	defaultOpen = false,
	onOpenTranscript,
	depth = 0,
	descendantCount = 0,
}: SubagentRowProps) {
	const indent = variant === "list" ? Math.min(depth, 6) * 16 : 0;
	const [open, setOpen] = useState(defaultOpen);
	const meta = extractSubagentMeta(subagent.progress);
	const detailRows = extractSubagentDetailRows(subagent);
	const description = subagent.description ?? subagent.task ?? subagent.assignment ?? "";

	const handleOpenDrawer = () => {
		onOpenTranscript?.(subagent.id);
		openSubagentDrawer(sessionId, subagent.id);
	};

	const outerClass =
		variant === "capsule"
			? "bg-surface shadow-card transition-[border-radius] duration-300 ease-[var(--ease-out-strong)] " +
				(open ? "rounded-[14px]" : "rounded-[22px]")
			: "border-b border-line last:border-b-0";

	return (
		<div
			className={outerClass}
			data-subagent-id={subagent.id}
			data-subagent-depth={depth}
			style={indent > 0 ? { paddingLeft: indent } : undefined}
		>
			<button
				type="button"
				aria-expanded={open}
				onClick={() => setOpen(v => !v)}
				className="flex h-11 w-full items-center gap-2.5 px-2.5 text-left transition-colors duration-100 hover:bg-hover/60"
			>
				{depth > 0 && (
					<span className="-ml-1 shrink-0 text-[12px] text-ink-3" aria-hidden="true">
						└
					</span>
				)}
				<SubagentStatusGlyph subagent={subagent} />
				<span className="shrink-0 text-[13px] font-medium text-ink">{subagent.agent}</span>
				<span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-2">{description}</span>
				{meta !== null && (
					<span className="shrink-0 font-mono text-[11.5px] text-ink-2 tabular-nums">{meta}</span>
				)}
				{descendantCount > 0 && (
					<span
						className="shrink-0 rounded-full bg-hover px-1.5 text-[11px] leading-[18px] text-ink-2 tabular-nums"
						data-testid="subagent-descendants"
					>
						+{descendantCount}
					</span>
				)}
				<SubagentStatusPill status={subagent.status} />
				<ChevronDown
					size={14}
					strokeWidth={2.2}
					className={
						"shrink-0 text-ink-3 transition-transform duration-200 ease-[var(--ease-out-strong)] " +
						(open ? "rotate-180" : "")
					}
					aria-hidden="true"
				/>
			</button>
			<Collapsible open={open} duration={300}>
				<div className="grid grid-cols-[24px_1fr] gap-2.5 px-2.5 pb-2.5">
					<span className="mx-auto w-px bg-line" aria-hidden="true" />
					<div className="min-w-0">
						{detailRows.map((row, idx) => (
							<div
								key={`${row.label}-${idx}`}
								style={{ animationDelay: `${Math.min(idx, 4) * 100}ms` }}
								className="anim-fade-up flex items-center justify-between gap-2 text-[12px] leading-[22px] text-ink-2"
							>
								<span className="min-w-0 truncate">{row.label}</span>
								{row.value.length > 0 && (
									<span className="shrink-0 font-mono text-[11.5px] tabular-nums">{row.value}</span>
								)}
							</div>
						))}
						<div className="flex items-center justify-between text-[12px] leading-[22px]">
							<button
								type="button"
								onClick={handleOpenDrawer}
								className="text-accent-ink hover:underline"
							>
								查看完整记录 →
							</button>
						</div>
					</div>
				</div>
			</Collapsible>
		</div>
	);
}
