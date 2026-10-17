/**
 * ThinkingBlock component (FRONTEND §6.5.1, DESIGN §9.3).
 * - Streaming: auto-expands, shows last 3 lines with top 24px fade mask, label is shimmer "思考中".
 * - Completed: auto-collapses after 400ms (unless user manually toggled), label is "思考了 Ns".
 * - Redacted: renders "已隐藏的思考", non-expandable.
 */
import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Collapsible } from "../../ui/Collapsible";
import { SparkleIcon } from "../../ui/Icon";
import { ShimmerText } from "../../ui/ShimmerText";

export interface ThinkingBlockProps {
	thinking: string;
	redacted?: boolean;
	streaming?: boolean;
	durationSeconds?: number;
	defaultOpen?: boolean;
}

function estimateThinkingSeconds(text: string, durationSeconds?: number): number {
	if (typeof durationSeconds === "number" && durationSeconds > 0) {
		return Math.max(1, Math.round(durationSeconds));
	}
	// Estimate from thinking length when server didn't attach separate thinking duration
	return Math.max(1, Math.min(60, Math.round(text.length / 45) || 3));
}

export function ThinkingBlock({
	thinking,
	redacted = false,
	streaming = false,
	durationSeconds,
	defaultOpen,
}: ThinkingBlockProps) {
	const [open, setOpen] = useState<boolean>(() => defaultOpen ?? streaming);
	const userToggledRef = useRef(false);
	const prevStreamingRef = useRef(streaming);

	useEffect(() => {
		if (userToggledRef.current) {
			prevStreamingRef.current = streaming;
			return;
		}
		if (streaming && !open) {
			setOpen(true);
		} else if (prevStreamingRef.current && !streaming) {
			// §6.5.1: Auto-collapse 400ms after streaming finishes
			const timer = setTimeout(() => {
				if (!userToggledRef.current) {
					setOpen(false);
				}
			}, 400);
			prevStreamingRef.current = streaming;
			return () => clearTimeout(timer);
		}
		prevStreamingRef.current = streaming;
	}, [streaming, open]);

	if (redacted) {
		return (
			<div className="-ml-1.5 inline-flex w-fit items-center gap-2 rounded-control px-1.5 py-1 text-[13px] font-medium text-ink-3 select-none">
				<SparkleIcon size={16} className="shrink-0 text-ink-3" />
				<span>已隐藏的思考</span>
			</div>
		);
	}

	const seconds = estimateThinkingSeconds(thinking, durationSeconds);
	const lines = thinking.split("\n");
	const displayThinking = streaming && !userToggledRef.current && lines.length > 3
		? lines.slice(-3).join("\n")
		: thinking;

	return (
		<div>
			<button
				type="button"
				aria-expanded={open}
				onClick={() => {
					userToggledRef.current = true;
					setOpen(o => !o);
				}}
				className="-ml-1.5 inline-flex w-fit items-center gap-2 rounded-control px-1.5 py-1 transition-colors duration-100 hover:bg-hover-2"
			>
				<SparkleIcon
					size={16}
					className={"shrink-0 " + (streaming ? "text-ink-2" : "text-ink-3")}
				/>
				{streaming ? (
					<ShimmerText active className="text-[13px] font-medium">
						思考中
					</ShimmerText>
				) : (
					<span className="anim-fade-in text-[13px] font-medium text-ink-2 tabular-nums">
						思考了 {seconds} 秒
					</span>
				)}
				<ChevronDown
					size={14}
					strokeWidth={2.2}
					className={
						"i text-ink-3 transition-transform duration-200 " +
						(open ? "rotate-180" : "")
					}
				/>
			</button>

			<Collapsible open={open} duration={400}>
				<div
					style={
						streaming && lines.length > 3 && !userToggledRef.current
							? {
									WebkitMaskImage: "linear-gradient(to bottom, transparent, #000 24px)",
									maskImage: "linear-gradient(to bottom, transparent, #000 24px)",
								}
							: undefined
					}
					className="relative mt-1 ml-[5px] py-1 pl-4 text-[12.5px] leading-[1.65] text-ink-2 whitespace-pre-wrap before:absolute before:top-[-4px] before:bottom-0.5 before:left-[3px] before:w-px before:bg-line before:transition-[height] before:duration-500"
				>
					{displayThinking}
				</div>
			</Collapsible>
		</div>
	);
}
