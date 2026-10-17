/**
 * ApprovalCard (FRONTEND §6.7, DESIGN §7.3).
 * Anchored under the matching awaiting tool row (or at end of transcript).
 * Supports countdown bar, always-allow checkbox, Enter/Esc keyboard handling,
 * focus without stealing from Composer, and 400ms grid-rows receipt collapse.
 */
import { DENY, type ApprovalPrompt } from "@omp-ui/protocol";
import { ShieldAlert, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useAppStore } from "../../store/app-store";
import { Button } from "../../ui/Button";
import { Card, CardFooter } from "../../ui/Card";
import { Checkbox } from "../../ui/Checkbox";
import { Chip, Kbd } from "../../ui/Chip";
import { Collapsible } from "../../ui/Collapsible";

export type ApprovalReceiptState = "approved" | "always" | "denied" | "timed_out";

export interface ApprovalCardProps {
	sessionId: string;
	approval: ApprovalPrompt;
	onResolved?: (state: ApprovalReceiptState) => void;
}

const MAX_DETAIL_LINES = 12;

export function ApprovalReceipt({ state }: { state: ApprovalReceiptState }) {
	if (state === "denied" || state === "timed_out") {
		return (
			<div className="anim-fade-up flex items-center gap-1.5 py-0.5 pl-[22px] text-[12px] text-red-ink">
				<span className="inline-flex text-red">
					<X size={12} strokeWidth={2.8} className="i" />
				</span>
				<span>{state === "timed_out" ? "审批已超时" : "已拒绝"}</span>
			</div>
		);
	}
	if (state === "always") {
		return (
			<div className="anim-fade-up flex items-center gap-1.5 py-0.5 pl-[22px] text-[12px] text-ink-3">
				<span className="inline-flex text-green">
					<svg
						width={12}
						height={12}
						viewBox="0 0 24 24"
						className="i"
						strokeWidth={3}
						style={{ strokeDasharray: 24, animation: "check-draw 0.3s var(--ease-out-strong) 80ms both" }}
					>
						<path d="M20 6L9 17l-5-5" />
					</svg>
				</span>
				<span>自动允许</span>
			</div>
		);
	}
	return (
		<div className="anim-fade-up flex items-center gap-1.5 py-0.5 pl-[22px] text-[12px] text-ink-2">
			<span className="inline-flex text-green">
				<svg
					width={12}
					height={12}
					viewBox="0 0 24 24"
					className="i"
					strokeWidth={3}
					style={{ strokeDasharray: 24, animation: "check-draw 0.3s var(--ease-out-strong) 80ms both" }}
				>
					<path d="M20 6L9 17l-5-5" />
				</svg>
			</span>
			<span>已允许</span>
		</div>
	);
}

export function ApprovalCard({ sessionId, approval, onResolved }: ApprovalCardProps) {
	const [always, setAlways] = useState(false);
	const [detailsExpanded, setDetailsExpanded] = useState(false);
	const [collapsing, setCollapsing] = useState(false);
	const [receipt, setReceipt] = useState<ApprovalReceiptState | null>(null);
	const cardRef = useRef<HTMLDivElement | null>(null);
	const headingId = useId();
	const checkboxId = useId();

	const approveAction = useAppStore(s => s.approve);
	const answerUiAction = useAppStore(s => s.answerUi);

	// §6.7: Focus card when mounted unless the user is actively typing in an input/textarea
	useEffect(() => {
		if (typeof document === "undefined") return;
		const active = document.activeElement;
		const isTyping =
			active instanceof HTMLTextAreaElement ||
			active instanceof HTMLInputElement ||
			(active instanceof HTMLElement && active.isContentEditable);
		if (!isTyping && cardRef.current) {
			cardRef.current.focus({ preventScroll: true });
		}
	}, []);

	const triggerResolution = (nextState: ApprovalReceiptState, fireRpc: () => void) => {
		if (collapsing || receipt !== null) return;
		setCollapsing(true);
		setTimeout(() => {
			setReceipt(nextState);
			onResolved?.(nextState);
			fireRpc();
		}, 400);
	};

	const handleApprove = () => {
		const nextState: ApprovalReceiptState = always ? "always" : "approved";
		triggerResolution(nextState, () => {
			approveAction(sessionId, approval.requestId, always);
		});
	};

	const handleDeny = () => {
		triggerResolution("denied", () => {
			answerUiAction(sessionId, {
				type: "extension_ui_response",
				id: approval.requestId,
				value: DENY,
			});
		});
	};

	// §7.2: Timeout handling
	useEffect(() => {
		if (!approval.timeoutMs || approval.timeoutMs <= 0 || collapsing || receipt !== null) return;
		const timer = setTimeout(() => {
			triggerResolution("timed_out", () => {
				answerUiAction(sessionId, {
					type: "extension_ui_response",
					id: approval.requestId,
					cancelled: true,
					timedOut: true,
				});
			});
		}, approval.timeoutMs);
		return () => clearTimeout(timer);
	}, [approval.timeoutMs, approval.requestId, collapsing, receipt]);

	if (receipt !== null) {
		return <ApprovalReceipt state={receipt} />;
	}

	const allDetailLines = approval.details.join("\n").split("\n").filter(l => l.length > 0);
	const hasOverflowDetails = allDetailLines.length > MAX_DETAIL_LINES && !detailsExpanded;
	const visibleDetails = hasOverflowDetails ? allDetailLines.slice(0, MAX_DETAIL_LINES) : allDetailLines;

	return (
		<Collapsible open={!collapsing} duration={400}>
			<div
				ref={cardRef}
				data-bare=""
				role="alertdialog"
				aria-labelledby={headingId}
				tabIndex={-1}
				onKeyDown={e => {
					if (e.key === "Enter") {
						e.preventDefault();
						handleApprove();
					} else if (e.key === "Escape") {
						e.preventDefault();
						handleDeny();
					}
				}}
				className="anim-fade-up my-1 outline-none"
			>
				<Card className="relative">
					{approval.timeoutMs && approval.timeoutMs > 0 ? (
						<div
							aria-hidden="true"
							className="absolute top-0 right-0 left-0 h-[2px] origin-left bg-accent"
							style={{
								animation: `countdown ${approval.timeoutMs}ms linear both`,
							}}
						/>
					) : null}
					<div className="p-3">
						<div id={headingId} className="flex items-center gap-2 text-[13px] font-medium text-ink">
							<ShieldAlert size={14} strokeWidth={2} className="i shrink-0 text-orange" />
							<span className="inline-flex flex-wrap items-center gap-1.5">
								<span>允许运行</span>
								<Chip mono className="text-ink">
									{approval.toolName}
								</Chip>
								<span>？</span>
							</span>
							{approval.mcp && (
								<Chip className="ml-auto">MCP</Chip>
							)}
						</div>
						{approval.reason && (
							<div className="mt-1 text-[12px] text-ink-2">{approval.reason}</div>
						)}
						{visibleDetails.length > 0 && (
							<div className="relative mt-2 overflow-hidden rounded-control bg-inset shadow-hairline">
								<pre className="overflow-x-auto px-2.5 py-2 mono text-[11.5px] leading-[1.6] text-ink whitespace-pre">
									{visibleDetails.join("\n")}
								</pre>
								{hasOverflowDetails && (
									<div className="flex items-end justify-center border-t border-line bg-inset py-1">
										<button
											type="button"
											onClick={() => setDetailsExpanded(true)}
											className="rounded-control px-2 py-0.5 text-[11.5px] font-medium text-accent-ink hover:bg-hover"
										>
											展开（共 {allDetailLines.length} 行）
										</button>
									</div>
								)}
							</div>
						)}
					</div>
					<CardFooter>
						<Checkbox
							id={checkboxId}
							checked={always}
							onCheckedChange={setAlways}
							label={`本会话总是允许 ${approval.toolName}`}
						/>
						<span className="ml-auto flex items-center gap-2">
							<Button variant="secondary" size="md" onClick={handleDeny}>
								<span>拒绝</span>
								<Kbd>Esc</Kbd>
							</Button>
							<Button variant="primary" size="md" onClick={handleApprove}>
								<span>允许</span>
								<Kbd tone="onInk">Enter</Kbd>
							</Button>
						</span>
					</CardFooter>
				</Card>
			</div>
		</Collapsible>
	);
}
