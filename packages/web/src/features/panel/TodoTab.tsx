import type { TodoItem, TodoPhase } from "@omp-ui/protocol";
import { Plus } from "lucide-react";
import { useState } from "react";
import { formatCompactTokens } from "@/features/subagents/subagent-utils";
import { getBridge, updateSessionView } from "@/store/bridge-access";
import { useAppStore } from "@/store/app-store";
import type { SessionView } from "@/store/session-reducer";
import { Card } from "@/ui/Card";
import { StatusBadge } from "@/ui/Chip";
import { SpinnerRing } from "@/ui/Spinner";
import { addTodoTask, editTodoTaskContent, toggleTodoTask } from "./panel-logic";

export interface TodoTabProps {
	sessionId: string;
	view: SessionView | undefined;
}

function TodoStatusControl({
	task,
	index,
	onToggle,
}: {
	task: TodoItem;
	index: number;
	onToggle: () => void;
}) {
	return (
		<button
			type="button"
			role="checkbox"
			aria-checked={task.status === "completed"}
			aria-label={`切换任务状态：${task.content}`}
			onClick={onToggle}
			className="inline-flex shrink-0 items-center justify-center rounded-full transition-transform duration-150 active:scale-94"
		>
			{task.status === "completed" ? (
				<span className="grid size-6 place-items-center">
					<StatusBadge status="success" />
				</span>
			) : task.status === "in_progress" ? (
				<SpinnerRing active index={index} />
			) : task.status === "pending" ? (
				<SpinnerRing active={false} index={index} />
			) : task.status === "blocked" ? (
				<span className="grid size-6 place-items-center">
					<span
						className="grid size-[20px] place-items-center rounded-full bg-orange text-[12px] font-bold text-white"
						aria-hidden="true"
					>
						!
					</span>
				</span>
			) : (
				<span className="grid size-6 place-items-center">
					<StatusBadge status="aborted" />
				</span>
			)}
		</button>
	);
}

/**
 * FRONTEND §6.16 待办 tab:
 * - TaskRows list variant grouped by phase.
 * - Status badges: completed (green check), in_progress (active SpinnerRing),
 *   pending (static SpinnerRing + index), blocked (orange circle ! + orange-ink blocker text),
 *   abandoned (ink-3 circle – + strikethrough).
 * - Double-click inline edit, "+ 添加" row, checkbox toggle -> `set_todos` (optimistic, revert on error).
 */
export function TodoTab({ sessionId, view }: TodoTabProps) {
	const [editingTarget, setEditingTarget] = useState<{
		phaseIdx: number;
		taskIdx: number;
		draft: string;
	} | null>(null);
	const [addingPhaseIdx, setAddingPhaseIdx] = useState<number | null>(null);
	const [newTaskText, setNewTaskText] = useState("");

	const phases: TodoPhase[] = view?.state?.todoPhases ?? [];

	const applyPhasesOptimistically = async (nextPhases: TodoPhase[], prevPhases: TodoPhase[]) => {
		updateSessionView(sessionId, curr => ({
			...curr,
			state: curr.state
				? { ...curr.state, todoPhases: nextPhases }
				: { sessionId, todoPhases: nextPhases },
		}));

		const currentView = useAppStore.getState().views[sessionId];
		if (!currentView || currentView.readonly || currentView.proc !== "ready") {
			return;
		}

		try {
			const res = await getBridge().rpc(sessionId, {
				type: "set_todos",
				phases: nextPhases,
			});
			updateSessionView(sessionId, curr => ({
				...curr,
				state: curr.state
					? { ...curr.state, todoPhases: res.todoPhases }
					: { sessionId, todoPhases: res.todoPhases },
			}));
		} catch (err) {
			// Revert optimistic update on RPC error
			updateSessionView(sessionId, curr => ({
				...curr,
				state: curr.state
					? { ...curr.state, todoPhases: prevPhases }
					: { sessionId, todoPhases: prevPhases },
			}));
			useAppStore
				.getState()
				.pushToast("error", err instanceof Error ? err.message : "更新待办失败");
		}
	};

	const handleToggle = (phaseIdx: number, taskIdx: number) => {
		const next = toggleTodoTask(phases, phaseIdx, taskIdx);
		void applyPhasesOptimistically(next, phases);
	};

	const commitInlineEdit = () => {
		if (!editingTarget) return;
		const { phaseIdx, taskIdx, draft } = editingTarget;
		setEditingTarget(null);
		const trimmed = draft.trim();
		const currentContent = phases[phaseIdx]?.tasks[taskIdx]?.content;
		if (!trimmed || trimmed === currentContent) return;
		const next = editTodoTaskContent(phases, phaseIdx, taskIdx, trimmed);
		void applyPhasesOptimistically(next, phases);
	};

	const commitAddTask = (phaseIdx: number) => {
		const trimmed = newTaskText.trim();
		setAddingPhaseIdx(null);
		setNewTaskText("");
		if (!trimmed) return;
		const next = addTodoTask(phases, phaseIdx, trimmed);
		void applyPhasesOptimistically(next, phases);
	};

	const ctxUsage = view?.state?.contextUsage ?? view?.stats?.contextUsage;
	const cost = view?.stats?.cost;
	const modelLabel = view?.state?.model
		? `${view.state.model.provider}/${view.state.model.id}`
		: undefined;

	return (
		<div className="flex flex-col gap-2">
			{phases.length === 0 ? (
				<Card>
					<div className="px-3 py-3 text-[12.5px] text-ink-2">暂无待办事项</div>
					{addingPhaseIdx === 0 ? (
						<div className="flex min-h-[40px] items-center gap-2 border-t border-line px-2.5">
							<input
								type="text"
								autoFocus
								value={newTaskText}
								onChange={e => setNewTaskText(e.target.value)}
								onBlur={() => commitAddTask(0)}
								onKeyDown={e => {
									if (e.key === "Enter" && !e.nativeEvent.isComposing) {
										e.preventDefault();
										commitAddTask(0);
									} else if (e.key === "Escape") {
										setAddingPhaseIdx(null);
										setNewTaskText("");
									}
								}}
								placeholder="输入新待办并按 Enter…"
								aria-label="新待办内容"
								className="w-full border-b border-line-strong bg-transparent py-1 text-[12.5px] text-ink outline-none placeholder:text-ink-3"
							/>
						</div>
					) : (
						<button
							type="button"
							onClick={() => {
								setAddingPhaseIdx(0);
								setNewTaskText("");
							}}
							className="flex h-9 w-full items-center gap-2 border-t border-line px-2.5 text-left text-[12.5px] text-ink-2 transition-colors duration-100 hover:bg-hover hover:text-ink"
						>
							<Plus size={13} strokeWidth={2} className="text-ink-3" />
							<span>添加</span>
						</button>
					)}
				</Card>
			) : (
				phases.map((phase, pIdx) => (
					<div key={`${phase.name}-${pIdx}`} className="flex flex-col gap-1">
						<div className="px-0.5 pt-1 pb-0.5 text-[10.5px] font-medium tracking-[0.08em] text-ink-3 uppercase">
							{phase.name}
						</div>
						<Card>
							{phase.tasks.map((task, tIdx) => {
								const isEditing =
									editingTarget?.phaseIdx === pIdx && editingTarget?.taskIdx === tIdx;
								const textClass =
									task.status === "completed"
										? "text-ink-2"
										: task.status === "abandoned"
											? "text-ink-3 line-through"
											: "text-ink";

								return (
									<div
										key={`${pIdx}-${tIdx}`}
										className="flex min-h-[44px] items-center gap-2.5 border-b border-line px-2.5 py-1.5 last:border-b-0"
									>
										<TodoStatusControl
											task={task}
											index={tIdx + 1}
											onToggle={() => handleToggle(pIdx, tIdx)}
										/>
										<div
											className="min-w-0 flex-1 text-[12.5px]"
											onDoubleClick={() =>
												setEditingTarget({
													phaseIdx: pIdx,
													taskIdx: tIdx,
													draft: task.content,
												})
											}
										>
											{isEditing ? (
												<input
													type="text"
													autoFocus
													value={editingTarget.draft}
													onChange={e =>
														setEditingTarget({
															phaseIdx: pIdx,
															taskIdx: tIdx,
															draft: e.target.value,
														})
													}
													onBlur={commitInlineEdit}
													onKeyDown={e => {
														if (e.key === "Enter" && !e.nativeEvent.isComposing) {
															e.preventDefault();
															commitInlineEdit();
														} else if (e.key === "Escape") {
															setEditingTarget(null);
														}
													}}
													aria-label="编辑待办内容"
													className="w-full border-b border-line-strong bg-transparent py-0.5 text-[12.5px] text-ink outline-none"
												/>
											) : (
												<div title="双击编辑" className={"cursor-text " + textClass}>
													{task.content}
												</div>
											)}
											{task.blocker && (
												<div className="mt-0.5 text-[12px] text-orange-ink">{task.blocker}</div>
											)}
											{task.details && (
												<div className="mt-0.5 text-[11.5px] text-ink-2">{task.details}</div>
											)}
											{task.notes && task.notes.length > 0 && (
												<div className="mt-0.5 text-[11.5px] text-ink-2">
													{task.notes.join(" · ")}
												</div>
											)}
										</div>
									</div>
								);
							})}

							{/* Bottom "+ 添加" row inside the last phase card (or active adding phase) */}
							{(pIdx === phases.length - 1 || addingPhaseIdx === pIdx) &&
								(addingPhaseIdx === pIdx ? (
									<div className="flex min-h-[40px] items-center gap-2 border-t border-line px-2.5">
										<input
											type="text"
											autoFocus
											value={newTaskText}
											onChange={e => setNewTaskText(e.target.value)}
											onBlur={() => commitAddTask(pIdx)}
											onKeyDown={e => {
												if (e.key === "Enter" && !e.nativeEvent.isComposing) {
													e.preventDefault();
													commitAddTask(pIdx);
												} else if (e.key === "Escape") {
													setAddingPhaseIdx(null);
													setNewTaskText("");
												}
											}}
											placeholder="输入新待办并按 Enter…"
											aria-label="新待办内容"
											className="w-full border-b border-line-strong bg-transparent py-1 text-[12.5px] text-ink outline-none placeholder:text-ink-3"
										/>
									</div>
								) : (
									<button
										type="button"
										onClick={() => {
											setAddingPhaseIdx(pIdx);
											setNewTaskText("");
										}}
										className="flex h-9 w-full items-center gap-2 border-t border-line px-2.5 text-left text-[12.5px] text-ink-2 transition-colors duration-100 hover:bg-hover hover:text-ink"
									>
										<Plus size={13} strokeWidth={2} className="text-ink-3" />
										<span>添加</span>
									</button>
								))}
						</Card>
					</div>
				))
			)}

			{/* Context summary card matching prototype/index.html lines 630-636 */}
			{(ctxUsage || cost !== undefined || modelLabel) && (
				<div className="flex flex-col gap-1">
					<div className="px-0.5 pt-2 pb-0.5 text-[10.5px] font-medium tracking-[0.08em] text-ink-3 uppercase">
						上下文
					</div>
					<Card className="px-3 py-2.5">
						{ctxUsage && (
							<>
								<div className="flex items-center justify-between text-[12px] leading-[22px] text-ink-2">
									<span>tokens</span>
									<span className="font-mono text-[11.5px] text-ink tabular-nums">
										{formatCompactTokens(ctxUsage.tokens)} /{" "}
										{formatCompactTokens(ctxUsage.contextWindow)}
									</span>
								</div>
								<div className="my-1.5 h-1 overflow-hidden rounded-pill bg-field">
									<div
										style={{ width: `${Math.min(100, Math.max(0, ctxUsage.percent))}%` }}
										className={
											"h-full rounded-pill transition-[width] duration-400 ease-[var(--ease-out-strong)] " +
											(ctxUsage.percent >= 95
												? "bg-red"
												: ctxUsage.percent >= 80
													? "bg-orange"
													: "bg-accent")
										}
									/>
								</div>
							</>
						)}
						{cost !== undefined && (
							<div className="flex items-center justify-between text-[12px] leading-[22px] text-ink-2">
								<span>花费</span>
								<span className="font-mono text-[11.5px] text-ink tabular-nums">
									${cost.toFixed(2)}
								</span>
							</div>
						)}
						{modelLabel && (
							<div className="flex items-center justify-between text-[12px] leading-[22px] text-ink-2">
								<span>模型</span>
								<span className="truncate font-mono text-[11.5px] text-ink">{modelLabel}</span>
							</div>
						)}
					</Card>
				</div>
			)}
		</div>
	);
}
