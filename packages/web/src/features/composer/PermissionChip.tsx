import type { ApprovalMode } from "@omp-ui/protocol";
import { Check, Shield, ShieldAlert, ShieldCheck } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/Popover";
import { Spinner } from "@/ui/Spinner";
import { useSlidingHighlight } from "@/ui/sliding-highlight";
import { APPROVAL_MODE_META, APPROVAL_MODE_ORDER } from "./new-session-config";

const MODE_ICON: Record<ApprovalMode, ReactNode> = {
	"always-ask": <ShieldCheck size={15} strokeWidth={1.8} />,
	write: <Shield size={15} strokeWidth={1.8} />,
	yolo: <ShieldAlert size={15} strokeWidth={1.8} className="text-orange" />,
};

export interface PermissionChipProps {
	mode: ApprovalMode;
	onSelect: (mode: ApprovalMode) => void;
	/** Welcome page: the value becomes the new session's start argument. Live session: picking restarts the process. */
	context: "welcome" | "session";
	/** Process is being restarted: the chip shows a 12px spinner and cannot be opened. */
	restarting?: boolean;
	/** Run in progress: the menu opens but the rows are disabled with a hint. */
	locked?: boolean;
	disabled?: boolean;
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
}

export interface PermissionMenuPanelProps {
	mode: ApprovalMode;
	context: "welcome" | "session";
	locked?: boolean;
	/** Called with the picked mode (never the current one). */
	onPick: (mode: ApprovalMode) => void;
}

/** The three 52px rows plus the footer; rendered inside the chip's popover. */
export function PermissionMenuPanel({ mode, context, locked = false, onPick }: PermissionMenuPanelProps) {
	const hl = useSlidingHighlight<HTMLDivElement>({ variant: "menu" });
	return (
		<>
			<div
				ref={hl.containerRef}
				onPointerOver={hl.onPointerOver}
				onFocus={hl.onFocus}
				onPointerLeave={hl.onPointerLeave}
				role="menu"
				aria-label="权限模式"
				className="relative flex flex-col"
			>
				{hl.highlightBlock}
				{APPROVAL_MODE_ORDER.map(value => {
					const item = APPROVAL_MODE_META[value];
					const selected = value === mode;
					return (
						<button
							key={value}
							type="button"
							role="menuitemradio"
							aria-checked={selected}
							disabled={locked}
							data-hl-item=""
							{...(selected ? { "data-hl-active": "" } : {})}
							onClick={() => onPick(value)}
							className={
								"relative z-10 flex h-[52px] w-full items-center gap-2.5 rounded-control px-2.5 text-left disabled:pointer-events-none disabled:opacity-35 " +
								(selected ? "bg-hover/60" : "")
							}
						>
							<span className="grid shrink-0 place-items-center text-ink-2">{MODE_ICON[value]}</span>
							<span className="flex min-w-0 flex-1 flex-col">
								<span className={"text-[13px] font-medium " + (value === "yolo" ? "text-orange-ink" : "text-ink")}>
									{item.label}
								</span>
								<span className="text-[12px] leading-[1.35] text-ink-2">{item.description}</span>
							</span>
							<span className="inline-flex w-4 shrink-0 items-center justify-end text-ink">
								{selected && <Check size={13} strokeWidth={2.4} />}
							</span>
						</button>
					);
				})}
			</div>
			<div className="mt-1 border-t border-line px-2.5 pt-1.5 pb-1 text-[11.5px] text-ink-2">
				{locked
					? "运行结束后可切换"
					: context === "session"
						? "切换会重启会话进程，历史不受影响"
						: "作用于这次新建的会话"}
			</div>
		</>
	);
}

/**
 * FRONTEND §6.12 / §6.14 permission chip (`--approval-mode`): 28px high, icon 15 + label 13/500,
 * `yolo` in orange-ink. The menu has three 52px rows and a footer explaining what switching does.
 */
export function PermissionChip({
	mode,
	onSelect,
	context,
	restarting = false,
	locked = false,
	disabled = false,
	open,
	onOpenChange,
}: PermissionChipProps) {
	const [internalOpen, setInternalOpen] = useState(false);
	const isOpen = open ?? internalOpen;
	const setOpen = onOpenChange ?? setInternalOpen;
	const meta = APPROVAL_MODE_META[mode];
	const risky = mode === "yolo";

	return (
		<Popover open={isOpen && !restarting} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<button
					type="button"
					disabled={disabled || restarting}
					aria-label={`权限：${meta.label}`}
					aria-busy={restarting}
					className={
						"inline-flex h-7 shrink-0 items-center gap-1.5 rounded-control px-2 text-[13px] font-medium " +
						"transition-[background-color_0.15s,transform_0.2s] hover:bg-hover active:scale-[0.94] " +
						(risky ? "text-orange-ink " : "text-ink-2 ") +
						(disabled ? "pointer-events-none opacity-35" : "")
					}
				>
					{restarting ? <Spinner /> : MODE_ICON[mode]}
					<span>{meta.label}</span>
				</button>
			</PopoverTrigger>
			<PopoverContent side="top" align="start" padding="tight" className="w-[280px] origin-bottom-left">
				<PermissionMenuPanel
					mode={mode}
					context={context}
					locked={locked}
					onPick={value => {
						setOpen(false);
						if (value !== mode) onSelect(value);
					}}
				/>
			</PopoverContent>
		</Popover>
	);
}
