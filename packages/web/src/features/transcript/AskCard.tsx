/**
 * AskCard component (FRONTEND §6.8, DESIGN §7.1–§7.2).
 * Renders one question at a time (`fade-up 350ms`, key = question index),
 * supports single-select (480ms auto-advance) and multi-select, recommended chip,
 * collapsible option preview, free-text input, pager dots, and receipt summary.
 */
import type { AskAnswer, AskQuestion, AskUiRequest } from "@omp-ui/protocol";
import { ArrowRight, ArrowUp, ChevronLeft, ChevronRight, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useAppStore } from "../../store/app-store";
import { IconButton } from "../../ui/Button";
import { Card, CardFooter } from "../../ui/Card";
import { Collapsible } from "../../ui/Collapsible";

export interface AskCardProps {
	sessionId: string;
	request: AskUiRequest;
}

interface QuestionDraftAnswer {
	selectedOptions: string[];
	customInput: string;
}

function buildInitialDrafts(questions: ReadonlyArray<AskQuestion>): QuestionDraftAnswer[] {
	return questions.map(q => {
		if (q.recommended !== undefined && q.options[q.recommended]) {
			return {
				selectedOptions: [q.options[q.recommended]!.label],
				customInput: "",
			};
		}
		return {
			selectedOptions: [],
			customInput: "",
		};
	});
}

function hasAnswer(draft: QuestionDraftAnswer | undefined): boolean {
	if (!draft) return false;
	return draft.selectedOptions.length > 0 || draft.customInput.trim().length > 0;
}

function formatAnswerSummary(draft: QuestionDraftAnswer | undefined): string {
	if (!draft) return "未作答";
	const parts = [...draft.selectedOptions];
	if (draft.customInput.trim().length > 0) {
		parts.push(draft.customInput.trim());
	}
	return parts.length > 0 ? parts.join("、") : "未作答";
}

/** Compact "问题 · 答案" receipt. Shared by the live card and the durable answered entry so swapping them is seamless. */
export function AskSummary({ lines, note }: { lines: Array<[string, string]>; note?: string | undefined }) {
	return (
		<div
			data-testid="ask-summary"
			className="my-1 flex flex-col gap-1 rounded-card bg-surface px-3 py-2 shadow-card text-[12px] text-ink-2"
		>
			{lines.map(([question, answer]) => (
				<div key={question} className="flex items-center gap-1.5 truncate">
					<span className="font-medium text-ink">{question}</span>
					<span>·</span>
					<span className="truncate">{answer}</span>
				</div>
			))}
			{note && <div className="text-[11.5px] text-orange-ink">{note}</div>}
		</div>
	);
}

export function AskCard({ sessionId, request }: AskCardProps) {
	const questions = request.questions;
	const [page, setPage] = useState(0);
	const [drafts, setDrafts] = useState<QuestionDraftAnswer[]>(() => buildInitialDrafts(questions));
	const [openPreviews, setOpenPreviews] = useState<Record<string, boolean>>({});
	const [status, setStatus] = useState<"editing" | "sent" | "summary" | "timed_out">("editing");
	const autoAdvanceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const answerUi = useAppStore(s => s.answerUi);

	useEffect(() => {
		return () => {
			clearTimeout(autoAdvanceRef.current ?? undefined);
		};
	}, []);

	// §7.2: Timeout handling
	useEffect(() => {
		if (!request.timeout || request.timeout <= 0 || status !== "editing") return;
		const timer = setTimeout(() => {
			setStatus("timed_out");
			answerUi(sessionId, {
				type: "extension_ui_response",
				id: request.id,
				cancelled: true,
				timedOut: true,
			});
		}, request.timeout);
		return () => clearTimeout(timer);
	}, [request.timeout, request.id, sessionId, status, answerUi]);

	if (questions.length === 0) return null;

	const currentQuestion = questions[page] ?? questions[0]!;
	const currentDraft = drafts[page] ?? { selectedOptions: [], customInput: "" };
	const isLastQuestion = page >= questions.length - 1;
	const currentHasAnswer = hasAnswer(currentDraft);

	const handleSelectOption = (label: string) => {
		if (autoAdvanceRef.current) {
			clearTimeout(autoAdvanceRef.current);
			autoAdvanceRef.current = null;
		}
		setDrafts(prev => {
			const next = [...prev];
			const cur = next[page] ?? { selectedOptions: [], customInput: "" };
			if (currentQuestion.multi) {
				const exists = cur.selectedOptions.includes(label);
				next[page] = {
					...cur,
					selectedOptions: exists
						? cur.selectedOptions.filter(x => x !== label)
						: [...cur.selectedOptions, label],
				};
			} else {
				next[page] = {
					selectedOptions: [label],
					customInput: "",
				};
			}
			return next;
		});

		// §6.8: single-choice auto-advances after 480ms when there is a next question
		if (!currentQuestion.multi && page < questions.length - 1) {
			autoAdvanceRef.current = setTimeout(() => {
				setPage(p => Math.min(questions.length - 1, p + 1));
			}, 480);
		}
	};

	const handleCustomInput = (val: string) => {
		if (autoAdvanceRef.current) {
			clearTimeout(autoAdvanceRef.current);
			autoAdvanceRef.current = null;
		}
		setDrafts(prev => {
			const next = [...prev];
			const cur = next[page] ?? { selectedOptions: [], customInput: "" };
			next[page] = {
				// §6.8: typing custom text on a single-choice question clears selected radio option
				selectedOptions: currentQuestion.multi ? cur.selectedOptions : val.length > 0 ? [] : cur.selectedOptions,
				customInput: val,
			};
			return next;
		});
	};

	const handleCancel = () => {
		answerUi(sessionId, {
			type: "extension_ui_response",
			id: request.id,
			cancelled: true,
		});
	};

	const handleSubmitOrNext = () => {
		if (!isLastQuestion) {
			setPage(p => Math.min(questions.length - 1, p + 1));
			return;
		}
		const answers: AskAnswer[] = questions.map((q, idx) => {
			const d = drafts[idx] ?? { selectedOptions: [], customInput: "" };
			const custom = d.customInput.trim();
			return {
				id: q.id,
				selectedOptions: d.selectedOptions,
				...(custom.length > 0 ? { customInput: custom } : {}),
			};
		});
		setStatus("sent");
		setTimeout(() => {
			setStatus("summary");
			answerUi(sessionId, {
				type: "extension_ui_response",
				id: request.id,
				answers,
			});
		}, 1200);
	};

	if (status === "summary" || status === "timed_out") {
		return (
			<AskSummary
				lines={questions.map((q, idx): [string, string] => [q.question, formatAnswerSummary(drafts[idx])])}
				note={status === "timed_out" ? "已按推荐答案继续" : undefined}
			/>
		);
	}

	if (status === "sent") {
		return (
			<Card className="my-1 p-3">
				<div className="flex items-center gap-2 text-[13px] font-medium text-ink">
					<span className="anim-pop-in inline-grid size-5 place-items-center rounded-full bg-green text-white">
						<svg
							width={12}
							height={12}
							viewBox="0 0 24 24"
							className="i"
							strokeWidth={3.2}
							style={{ strokeDasharray: 24, animation: "check-draw 0.3s var(--ease-out-strong) 80ms both" }}
						>
							<path d="M20 6L9 17l-5-5" />
						</svg>
					</span>
					<span className="animate-[fade-up_0.3s_var(--ease-out-strong)_100ms_both]">已发送回答</span>
				</div>
			</Card>
		);
	}

	return (
		<Card className="anim-fade-up relative my-1">
			{request.timeout && request.timeout > 0 && (
				<div
					aria-hidden="true"
					className="absolute top-0 right-0 left-0 h-[2px] origin-left bg-accent"
					style={{ animation: `countdown ${request.timeout}ms linear both` }}
				/>
			)}
			<div
				key={page}
				className="animate-[fade-up_0.35s_var(--ease-out-strong)_both] p-3"
			>
				{currentQuestion.header && (
					<div className="mb-1 text-[10.5px] font-medium tracking-[0.08em] uppercase text-ink-3">
						{currentQuestion.header}
					</div>
				)}
				<div className="flex items-start justify-between gap-3">
					<span className="text-[13px] font-medium text-ink">{currentQuestion.question}</span>
					<IconButton size="sm" label="关闭" onClick={handleCancel}>
						<X size={14} strokeWidth={2.2} className="i" />
					</IconButton>
				</div>

				<div className="mt-2 flex flex-col gap-0.5">
					{currentQuestion.options.map((opt, optIdx) => {
						const isSelected = currentDraft.selectedOptions.includes(opt.label);
						const isRecommended = currentQuestion.recommended === optIdx;
						const previewKey = `${currentQuestion.id}-${optIdx}`;
						const previewOpen = Boolean(openPreviews[previewKey]);

						return (
							<div key={opt.label} className="flex flex-col">
								<div className="-mx-1.5 flex min-h-[28px] w-[calc(100%+12px)] items-center gap-2 rounded-control px-1.5 transition-colors hover:bg-hover">
									<button
										type="button"
										onClick={() => handleSelectOption(opt.label)}
										className={
											"flex min-h-[28px] flex-1 items-center gap-2 text-left text-[13px] transition-colors " +
											(isSelected ? "text-ink" : "text-ink-2")
										}
									>
										{currentQuestion.multi ? (
											<span
												className={
													"grid size-4 shrink-0 place-items-center rounded-[5px] transition-colors duration-200 " +
													(isSelected
														? "bg-ink text-canvas"
														: "shadow-[inset_0_0_0_1.5px_var(--line-strong)] text-transparent")
												}
											>
												<svg width={10} height={10} viewBox="0 0 24 24" className="i" strokeWidth={3.5}>
													<path d="M20 6L9 17l-5-5" />
												</svg>
											</span>
										) : (
											<span
												className={
													"grid size-4 shrink-0 place-items-center rounded-full transition-colors duration-200 " +
													(isSelected ? "bg-ink" : "shadow-[inset_0_0_0_1.5px_var(--line-strong)]")
												}
											>
												<i
													className={
														"block size-1.5 rounded-full bg-canvas transition-transform duration-200 " +
														(isSelected ? "scale-100" : "scale-0")
													}
												/>
											</span>
										)}
										<span>{opt.label}</span>
										{isRecommended && (
											<span className="inline-flex h-[18px] items-center rounded-pill bg-accent-tint px-1.5 text-[11px] font-medium text-accent-on-tint">
												推荐
											</span>
										)}
									</button>
									{opt.preview && (
										<button
											type="button"
											onClick={() => setOpenPreviews(p => ({ ...p, [previewKey]: !p[previewKey] }))}
											className="rounded-chip px-1.5 py-0.5 text-[11px] font-medium text-ink-2 hover:bg-hover-2 hover:text-ink"
										>
											预览
										</button>
									)}
								</div>
								{opt.description && (
									<div className="pl-6 pb-1 text-[12px] text-ink-2">{opt.description}</div>
								)}
								{opt.preview && (
									<Collapsible open={previewOpen} duration={300}>
										<pre className="my-1 ml-6 overflow-x-auto rounded-control bg-inset p-2 shadow-hairline mono text-[11.5px] leading-[1.6] text-ink-2 whitespace-pre">
											{opt.preview}
										</pre>
									</Collapsible>
								)}
							</div>
						);
					})}

					<label className="-mx-1.5 flex min-h-[28px] w-[calc(100%+12px)] cursor-text items-center gap-2 rounded-control px-1.5 hover:bg-hover">
						<span className="w-4 shrink-0" />
						<input
							type="text"
							value={currentDraft.customInput}
							onChange={e => handleCustomInput(e.target.value)}
							onKeyDown={e => {
								if (e.key === "Enter" && currentHasAnswer) {
									e.preventDefault();
									handleSubmitOrNext();
								}
							}}
							placeholder="输入其他答案…"
							aria-label="其他答案"
							className="min-w-0 flex-1 border-0 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-3"
						/>
					</label>
				</div>
			</div>

			<CardFooter>
				<span className="flex items-center gap-2">
					<IconButton
						size="sm"
						label="上一题"
						disabled={page === 0}
						onClick={() => setPage(p => Math.max(0, p - 1))}
					>
						<ChevronLeft size={14} strokeWidth={2.2} className="i" />
					</IconButton>
					<span className="flex items-center gap-1">
						{questions.map((q, idx) => {
							const isCurrent = idx === page;
							const answered = hasAnswer(drafts[idx]);
							if (isCurrent) {
								return (
									<button
										key={q.id}
										type="button"
										aria-label={`第 ${idx + 1} 题（当前）`}
										onClick={() => setPage(idx)}
										className="size-[9px] rounded-full border-[2.5px] border-ink"
									/>
								);
							}
							if (answered) {
								return (
									<button
										key={q.id}
										type="button"
										aria-label={`第 ${idx + 1} 题（已答）`}
										onClick={() => setPage(idx)}
										className="size-[7px] rounded-full bg-ink-3"
									/>
								);
							}
							return (
								<button
									key={q.id}
									type="button"
									aria-label={`第 ${idx + 1} 题（未答）`}
									onClick={() => setPage(idx)}
									className="size-[7px] rounded-full border-[1.5px] border-ink-3"
								/>
							);
						})}
					</span>
					<IconButton
						size="sm"
						label="下一题"
						disabled={isLastQuestion}
						onClick={() => setPage(p => Math.min(questions.length - 1, p + 1))}
					>
						<ChevronRight size={14} strokeWidth={2.2} className="i" />
					</IconButton>
				</span>

				<button
					type="button"
					aria-label={isLastQuestion ? "提交回答" : "下一题"}
					onClick={handleSubmitOrNext}
					className={
						"grid size-7 place-items-center rounded-control transition-[transform,background-color] duration-200 active:scale-94 " +
						(currentHasAnswer
							? "bg-ink text-surface shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]"
							: "bg-field text-ink-2 shadow-btn")
					}
				>
					{isLastQuestion ? (
						<ArrowUp size={15} strokeWidth={2.4} className="i" />
					) : (
						<ArrowRight size={14} strokeWidth={2.5} className="i" />
					)}
				</button>
			</CardFooter>
		</Card>
	);
}
