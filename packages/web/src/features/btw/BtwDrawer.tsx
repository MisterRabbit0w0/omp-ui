import type { BtwHistoryRecord, BtwHistoryTurn, BtwStatus } from "@omp-ui/protocol";
import { CornerDownRight, MessageCircleQuestion, Plus, Send, Square, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { getBridge, updateSessionView } from "@/store/bridge-access";
import { useAppStore } from "@/store/app-store";
import type { SessionView } from "@/store/session-reducer";
import { Button, IconButton } from "@/ui/Button";
import { Chip, Pill } from "@/ui/Chip";
import { Card } from "@/ui/Card";
import { ShimmerText } from "@/ui/ShimmerText";
import { Spinner } from "@/ui/Spinner";

export const OPEN_BTW_EVENT = "open-btw";

export interface OpenBtwEventDetail {
	sessionId?: string | null;
	recordId?: string;
}

export function openBtwDrawer(sessionId?: string | null, recordId?: string): void {
	if (typeof window === "undefined") return;
	window.dispatchEvent(
		new CustomEvent<OpenBtwEventDetail>(OPEN_BTW_EVENT, {
			detail: { sessionId: sessionId ?? null, ...(recordId ? { recordId } : {}) },
		}),
	);
}

export interface BtwDrawerProps {
	sessionId: string | null;
	/** Optional explicit SessionView fallback (for gallery/isolated rendering). */
	view?: SessionView;
	/** Controlled initial open state (for gallery/tests). */
	defaultOpen?: boolean;
	/** Render inline instead of fixed portal (for gallery). */
	inline?: boolean;
	onClose?: () => void;
}

export interface NormalizedBtwTurn {
	question: string;
	answer: string;
	status: BtwStatus;
	error?: string;
	isStreaming: boolean;
}

/** Combine a `BtwHistoryRecord`, its `followUps`, and live `btwDeltas` into display turns. */
export function buildBtwTurns(record: BtwHistoryRecord, liveDelta?: string): NormalizedBtwTurn[] {
	const followUps: BtwHistoryTurn[] = record.followUps ?? [];
	const hasFollowUps = followUps.length > 0;
	const hasDelta = typeof liveDelta === "string" && liveDelta.length > 0;

	const firstIsLatest = !hasFollowUps;
	const firstAnswer =
		firstIsLatest && hasDelta ? `${record.answer}${liveDelta}` : record.answer;
	const firstStatus: BtwStatus = firstIsLatest ? record.status : "complete";

	const turns: NormalizedBtwTurn[] = [
		{
			question: record.question,
			answer: firstAnswer,
			status: firstStatus,
			error: firstIsLatest ? record.error : undefined,
			isStreaming: firstIsLatest && (firstStatus === "running" || hasDelta),
		},
	];

	for (let i = 0; i < followUps.length; i++) {
		const f = followUps[i]!;
		const isLast = i === followUps.length - 1;
		const ans = isLast && hasDelta ? `${f.answer}${liveDelta}` : f.answer;
		turns.push({
			question: f.question,
			answer: ans,
			status: f.status,
			error: f.error,
			isStreaming: isLast && (f.status === "running" || hasDelta),
		});
	}

	return turns;
}

function BtwStatusPill({ status }: { status: BtwStatus }) {
	switch (status) {
		case "running":
			return (
				<Pill tone="accent">
					<Spinner className="size-2.5" />
					<span>回答中</span>
				</Pill>
			);
		case "complete":
			return <Pill tone="green">已完成</Pill>;
		case "cancelled":
			return <Pill tone="neutral">已取消</Pill>;
		case "interrupted":
			return <Pill tone="orange">已中断</Pill>;
		case "error":
			return <Pill tone="red">出错</Pill>;
	}
}

/**
 * Right-side overlay drawer for side questions (`btw`, DESIGN §9.8).
 * Opened by custom DOM event `open-btw` `{ sessionId }`.
 */
export function BtwDrawer({
	sessionId: propSessionId,
	view: propView,
	defaultOpen = false,
	inline = false,
	onClose,
}: BtwDrawerProps) {
	const [open, setOpen] = useState(defaultOpen);
	const [overrideSessionId, setOverrideSessionId] = useState<string | null>(null);
	const [followUpRecordId, setFollowUpRecordId] = useState<string | null>(null);
	const [questionText, setQuestionText] = useState("");
	const [sending, setSending] = useState(false);

	const activeSessionId = overrideSessionId ?? propSessionId;
	const storeView = useAppStore(s => {
		const sid = activeSessionId ?? s.currentSessionId;
		return sid ? s.views[sid] : undefined;
	});
	const view = storeView ?? propView;
	// Listen for `open-btw` custom DOM event.
	useEffect(() => {
		if (inline) return;
		const handler = (ev: Event) => {
			const detail = (ev as CustomEvent<OpenBtwEventDetail | undefined>).detail;
			const sid = detail?.sessionId ?? propSessionId ?? useAppStore.getState().currentSessionId;
			setOverrideSessionId(sid ?? null);
			if (detail?.recordId) setFollowUpRecordId(detail.recordId);
			setOpen(true);
		};
		window.addEventListener(OPEN_BTW_EVENT, handler);
		return () => window.removeEventListener(OPEN_BTW_EVENT, handler);
	}, [inline, propSessionId]);

	// Refresh `get_btw_history` when drawer opens.
	useEffect(() => {
		const sid = activeSessionId ?? useAppStore.getState().currentSessionId;
		if (inline || !open || !sid) return;
		const v = useAppStore.getState().views[sid];
		if (!v || v.readonly || v.proc !== "ready") return;
		void getBridge()
			.rpc(sid, { type: "get_btw_history" })
			.then(res => {
				updateSessionView(sid, curr => {
					const merged = new Map(curr.btw);
					for (const r of res.records) merged.set(r.id, r);
					return { ...curr, btw: merged };
				});
			})
			.catch(() => undefined);
	}, [inline, open, activeSessionId]);

	if (!open) return null;

	const records: BtwHistoryRecord[] = view
		? [...view.btw.values()].sort((a, b) => a.createdAt - b.createdAt)
		: [];
	const deltas = view?.btwDeltas ?? new Map<string, string>();
	const activeFollowUpRecord = followUpRecordId ? view?.btw.get(followUpRecordId) : undefined;

	const handleClose = () => {
		setOpen(false);
		onClose?.();
	};

	const handleAsk = async () => {
		const q = questionText.trim();
		const sid = activeSessionId ?? useAppStore.getState().currentSessionId;
		if (!q || !sid || sending) return;
		setSending(true);
		try {
			const res = await getBridge().rpc(sid, {
				type: "btw",
				question: q,
				...(followUpRecordId ? { recordId: followUpRecordId } : {}),
			});
			setQuestionText("");
			updateSessionView(sid, curr => {
				const nextBtw = new Map(curr.btw);
				nextBtw.set(res.record.id, res.record);
				return { ...curr, btw: nextBtw };
			});
			setFollowUpRecordId(res.record.id);
		} catch (err) {
			useAppStore
				.getState()
				.pushToast("error", err instanceof Error ? err.message : "旁问发送失败");
		} finally {
			setSending(false);
		}
	};

	const handleCancel = async (recordId?: string) => {
		const sid = activeSessionId ?? useAppStore.getState().currentSessionId;
		if (!sid) return;
		try {
			await getBridge().rpc(sid, {
				type: "btw_cancel",
				...(recordId ? { recordId } : {}),
			});
		} catch (err) {
			useAppStore
				.getState()
				.pushToast("error", err instanceof Error ? err.message : "取消旁问失败");
		}
	};

	const panel = (
		<aside
			role="dialog"
			aria-label="旁问 (btw)"
			className={
				inline
					? "flex h-[520px] w-[480px] max-w-full flex-col overflow-hidden rounded-window bg-surface shadow-overlay"
					: "fixed top-0 right-0 bottom-0 z-50 flex w-[480px] max-w-full flex-col bg-surface shadow-overlay animate-[fade-in_0.18s_var(--ease-out-strong)]"
			}
		>
			{/* Header */}
			<div className="flex h-11 shrink-0 items-center justify-between border-b border-line px-4">
				<div className="flex items-center gap-2">
					<MessageCircleQuestion size={15} strokeWidth={1.8} className="text-ink-2" />
					<span className="text-[13px] font-medium text-ink">旁问 (btw)</span>
					<span className="text-[11.5px] text-ink-2">独立于主对话上下文</span>
				</div>
				<div className="flex items-center gap-1">
					{followUpRecordId && (
						<Button
							size="sm"
							variant="ghost"
							icon={<Plus size={12} strokeWidth={2} />}
							onClick={() => setFollowUpRecordId(null)}
						>
							新话题
						</Button>
					)}
					<IconButton size="sm" label="关闭旁问抽屉" onClick={handleClose}>
						<X size={14} strokeWidth={2.2} />
					</IconButton>
				</div>
			</div>

			{/* Records list */}
			<div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3">
				{records.length === 0 ? (
					<div className="flex h-44 flex-col items-center justify-center gap-1.5 text-center">
						<MessageCircleQuestion size={24} strokeWidth={1.6} className="text-ink-3" />
						<div className="text-[13px] font-medium text-ink">还没有旁问记录</div>
						<div className="max-w-[260px] text-[12px] text-ink-2">
							随时提问而不污染主会话上下文，支持在同一话题内连续追问。
						</div>
					</div>
				) : (
					records.map(record => {
						const liveDelta = deltas.get(record.id);
						const turns = buildBtwTurns(record, liveDelta);
						const isSelected = followUpRecordId === record.id;
						const isRecordRunning =
							record.status === "running" ||
							turns.some(t => t.status === "running") ||
							(typeof liveDelta === "string" && liveDelta.length > 0);

						return (
							<Card
								key={record.id}
								className={
									"p-3 transition-shadow " +
									(isSelected ? "ring-1 ring-accent" : "")
								}
							>
								<div className="mb-2 flex items-center justify-between gap-2">
									<div className="flex items-center gap-1.5">
										<BtwStatusPill status={isRecordRunning ? "running" : record.status} />
										<span className="font-mono text-[11px] text-ink-2">
											{turns.length > 1 ? `${turns.length} 轮` : "1 轮"}
										</span>
									</div>
									<div className="flex items-center gap-1.5">
										{isRecordRunning && (
											<Button
												size="sm"
												variant="secondary"
												icon={<Square size={10} strokeWidth={2.2} />}
												onClick={() => void handleCancel(record.id)}
											>
												取消
											</Button>
										)}
										<Button
											size="sm"
											variant={isSelected ? "primary" : "ghost"}
											icon={<CornerDownRight size={11} strokeWidth={2} />}
											onClick={() =>
												setFollowUpRecordId(prev => (prev === record.id ? null : record.id))
											}
										>
											{isSelected ? "追问中" : "追问"}
										</Button>
									</div>
								</div>

								<div className="flex flex-col gap-2.5">
									{turns.map((turn, tIdx) => (
										<div
											key={`${record.id}-t-${tIdx}`}
											className={
												tIdx > 0 ? "border-t border-line pt-2.5" : ""
											}
										>
											<div className="mb-1 flex items-start justify-end pl-8">
												<div className="rounded-bubble bg-field px-3 py-1.5 text-[13px] leading-[1.5] text-ink">
													{turn.question}
												</div>
											</div>
											{turn.answer.length > 0 ? (
												<div className="prose text-[13px] leading-[1.6] text-ink [&_code]:rounded-[5px] [&_code]:bg-field [&_code]:px-[5px] [&_code]:py-[1px] [&_code]:font-mono [&_code]:text-[0.9em] [&_p+p]:mt-2 [&_pre]:my-1.5 [&_pre]:overflow-auto [&_pre]:rounded-control [&_pre]:bg-inset [&_pre]:p-2.5 [&_pre]:font-mono [&_pre]:text-[11.5px] [&_pre]:shadow-hairline">
													<ReactMarkdown remarkPlugins={[remarkGfm]}>
														{turn.answer}
													</ReactMarkdown>
													{turn.isStreaming && <span className="stream-caret" />}
												</div>
											) : turn.isStreaming ? (
												<div className="py-1 text-[12.5px]">
													<ShimmerText>正在思考旁问回答…</ShimmerText>
												</div>
											) : null}
											{turn.error && (
												<div className="mt-1 rounded-control bg-red-tint px-2.5 py-1.5 text-[12px] text-red-ink">
													{turn.error}
												</div>
											)}
										</div>
									))}
								</div>
							</Card>
						);
					})
				)}
			</div>

			{/* Footer ask input */}
			<div className="border-t border-line p-3">
				{activeFollowUpRecord && (
					<div className="mb-2 flex items-center justify-between gap-2">
						<Chip className="max-w-full truncate">
							<CornerDownRight size={11} strokeWidth={2} className="shrink-0 text-accent-ink" />
							<span className="truncate">追问：{activeFollowUpRecord.question}</span>
						</Chip>
						<button
							type="button"
							onClick={() => setFollowUpRecordId(null)}
							className="text-[11.5px] text-ink-2 hover:text-ink"
						>
							改为新问题
						</button>
					</div>
				)}
				<div className="flex items-center gap-2">
					<input
						type="text"
						value={questionText}
						onChange={e => setQuestionText(e.target.value)}
						onKeyDown={e => {
							if (e.key === "Enter" && !e.nativeEvent.isComposing) {
								e.preventDefault();
								void handleAsk();
							}
						}}
						placeholder={
							activeFollowUpRecord ? "在此话题下继续追问…" : "输入旁问（不影响当前对话）…"
						}
						aria-label="旁问输入"
						className="h-7 min-w-0 flex-1 rounded-control bg-inset px-2.5 text-[13px] text-ink shadow-hairline outline-none placeholder:text-ink-3 focus:shadow-[0_0_0_1px_var(--line-strong)]"
					/>
					<Button
						variant="primary"
						size="md"
						loading={sending}
						disabled={questionText.trim().length === 0}
						icon={<Send size={13} strokeWidth={2} />}
						onClick={() => void handleAsk()}
					>
						提问
					</Button>
				</div>
			</div>
		</aside>
	);

	if (inline) return panel;
	if (typeof document === "undefined") return null;

	return createPortal(
		<div className="fixed inset-0 z-50">
			<div
				className="fixed inset-0 bg-scrim animate-[fade-in_0.18s]"
				onClick={handleClose}
				aria-hidden="true"
			/>
			{panel}
		</div>,
		document.body,
	);
}
