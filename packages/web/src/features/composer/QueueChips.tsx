import type { WidgetPlacement } from "@omp-ui/protocol";
import { ArrowUp, X } from "lucide-react";
import type { SessionView } from "@/store/session-reducer";
import { Chip } from "@/ui/Chip";
import { buildQueueChipItems, type QueueChipItem } from "./logic";

export interface QueueChipsProps {
	queue: SessionView["queue"];
	onRemove?: (item: QueueChipItem) => void;
	onPromote?: (item: QueueChipItem) => void;
}

/**
 * DESIGN §9.5 / prototype .queue & .qchip:
 * Displays queued steering and follow-up messages above Composer.
 * Leading `liveSteered` items are marked "已送达" and cannot be removed;
 * remaining items have × (`remove_queued_message`, restoring images to attachments),
 * and follow-up items have ↑ (`promote_queued_message`).
 */
export function QueueChips({ queue, onRemove, onPromote }: QueueChipsProps) {
	const items = buildQueueChipItems(queue);
	if (items.length === 0) return null;

	return (
		<div className="mb-2 flex flex-wrap gap-1.5" aria-label="排队消息">
			{items.map(item => (
				<span
					key={item.id}
					className={
						"anim-pop-in inline-flex h-[26px] items-center gap-1.5 rounded-pill " +
						"bg-surface pr-1 pl-2 text-[12px] text-ink shadow-btn"
					}
				>
					<span
						className={
							"shrink-0 text-[11px] font-medium " +
							(item.liveSteered ? "text-green-ink" : "text-accent-ink")
						}
					>
						{item.badgeLabel}
					</span>
					<span className="max-w-[360px] truncate text-ink">{item.text}</span>
					{item.canPromote && (
						<button
							type="button"
							aria-label="提升为插话"
							title="提升为插话"
							onClick={() => onPromote?.(item)}
							className="inline-flex size-[18px] shrink-0 items-center justify-center rounded-[5px] text-ink-3 transition-colors hover:bg-hover-2 hover:text-ink-2 active:scale-[0.94]"
						>
							<ArrowUp size={11} strokeWidth={2.4} />
						</button>
					)}
					{item.canRemove && (
						<button
							type="button"
							aria-label="移除"
							title="移除"
							onClick={() => onRemove?.(item)}
							className="inline-flex size-[18px] shrink-0 items-center justify-center rounded-[5px] text-ink-3 transition-colors hover:bg-hover-2 hover:text-ink-2 active:scale-[0.94]"
						>
							<X size={10} strokeWidth={2.5} />
						</button>
					)}
				</span>
			))}
		</div>
	);
}

export interface EditorWidgetsProps {
	widgets: SessionView["widgets"];
	placement: WidgetPlacement;
}

/**
 * DESIGN §7.1 & §9.1 `setWidget`: monospace text blocks above or below Composer.
 */
export function EditorWidgets({ widgets, placement }: EditorWidgetsProps) {
	const matching: { key: string; lines: string[] }[] = [];
	for (const [key, w] of widgets) {
		if (w.placement === placement && w.lines.length > 0) {
			matching.push({ key, lines: w.lines });
		}
	}
	if (matching.length === 0) return null;

	return (
		<div className={placement === "aboveEditor" ? "mb-2 flex flex-col gap-1.5" : "mt-1.5 flex flex-col gap-1.5"}>
			{matching.map(w => (
				<div
					key={w.key}
					className="rounded-control bg-inset px-2.5 py-1.5 font-mono text-[11.5px] leading-[1.6] whitespace-pre-wrap text-ink-2 shadow-hairline"
				>
					{w.lines.join("\n")}
				</div>
			))}
		</div>
	);
}

export interface ComposerStatusChipsProps {
	statusChips: SessionView["statusChips"];
}

/**
 * DESIGN §9.1 status chips row below Composer (when present).
 */
export function ComposerStatusChips({ statusChips }: ComposerStatusChipsProps) {
	if (statusChips.size === 0) return null;
	const entries = Array.from(statusChips.entries()).filter(([, text]) => text.trim().length > 0);
	if (entries.length === 0) return null;

	return (
		<div className="mt-1.5 flex flex-wrap items-center gap-1.5">
			{entries.map(([key, text]) => (
				<Chip key={key} mono>
					{text}
				</Chip>
			))}
		</div>
	);
}
