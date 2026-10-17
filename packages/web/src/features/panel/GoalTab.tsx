import type { Goal, GoalOp, GoalStatus } from "@omp-ui/protocol";
import { Pause, Play, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { getBridge, updateSessionView } from "@/store/bridge-access";
import { useAppStore } from "@/store/app-store";
import type { SessionView } from "@/store/session-reducer";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { Pill } from "@/ui/Chip";
import { computeGoalBudgetMeter, formatGoalUsageSummary } from "./panel-logic";

export interface GoalTabProps {
	sessionId: string;
	view: SessionView | undefined;
}

function GoalStatusPill({ status }: { status: GoalStatus }) {
	switch (status) {
		case "active":
			return <Pill tone="accent">进行中</Pill>;
		case "paused":
			return <Pill tone="orange">已暂停</Pill>;
		case "budget-limited":
			return <Pill tone="orange">超出预算</Pill>;
		case "complete":
			return <Pill tone="green">已完成</Pill>;
		case "dropped":
			return <Pill tone="neutral">已放弃</Pill>;
	}
}

/**
 * FRONTEND §6.16 目标 tab:
 * - When no goal exists: form card (objective textarea + token_budget number input + "开始" primary button).
 * - When goal exists: goal card (objective 13 ink, status pill, 4px budget meter with ≥90% orange,
 *   "已用 34k / 100k · 12 分钟" mono 11.5 ink-2, and Pause / Resume / Drop buttons).
 */
export function GoalTab({ sessionId, view }: GoalTabProps) {
	const [objectiveInput, setObjectiveInput] = useState("");
	const [budgetInput, setBudgetInput] = useState("100000");
	const [busyOp, setBusyOp] = useState<GoalOp | null>(null);

	const goalMode = view?.state?.goal ?? null;
	const goal: Goal | null =
		goalMode?.goal && goalMode.goal.status !== "dropped" ? goalMode.goal : null;

	const runGoalOp = async (
		op: GoalOp,
		params?: { objective?: string; token_budget?: number },
	) => {
		if (busyOp) return;
		setBusyOp(op);

		// Optimistic local state update when session is offline/fixture or in-flight
		const currentView = useAppStore.getState().views[sessionId];
		if (!currentView || currentView.readonly || currentView.proc !== "ready") {
			updateSessionView(sessionId, curr => {
				const now = Date.now();
				if (op === "create" && params?.objective) {
					const created: Goal = {
						id: `goal-${now}`,
						objective: params.objective,
						status: "active",
						tokensUsed: 0,
						timeUsedSeconds: 0,
						createdAt: now,
						updatedAt: now,
						...(params.token_budget ? { tokenBudget: params.token_budget } : {}),
					};
					return {
						...curr,
						state: {
							...(curr.state ?? { sessionId }),
							goal: { enabled: true, mode: "active", goal: created },
						},
					};
				}
				if (op === "drop") {
					return {
						...curr,
						state: curr.state ? { ...curr.state, goal: null } : null,
					};
				}
				if (curr.state?.goal?.goal && (op === "pause" || op === "resume")) {
					const nextStatus: GoalStatus = op === "pause" ? "paused" : "active";
					return {
						...curr,
						state: {
							...curr.state,
							goal: {
								...curr.state.goal,
								goal: { ...curr.state.goal.goal, status: nextStatus, updatedAt: now },
							},
						},
					};
				}
				return curr;
			});
			setBusyOp(null);
			return;
		}

		try {
			const res = await getBridge().rpc(sessionId, {
				type: "goal",
				op,
				...(params?.objective !== undefined ? { objective: params.objective } : {}),
				...(params?.token_budget !== undefined ? { token_budget: params.token_budget } : {}),
			});
			updateSessionView(sessionId, curr => ({
				...curr,
				state: {
					...(curr.state ?? { sessionId }),
					goal: res.state,
				},
			}));
			if (op === "create") {
				setObjectiveInput("");
			}
		} catch (err) {
			useAppStore
				.getState()
				.pushToast("error", err instanceof Error ? err.message : "目标操作失败");
		} finally {
			setBusyOp(null);
		}
	};

	if (!goal) {
		const parsedBudget = Number.parseInt(budgetInput, 10);
		const validBudget =
			Number.isFinite(parsedBudget) && parsedBudget > 0 ? parsedBudget : undefined;

		return (
			<Card className="p-3">
				<div className="mb-2 text-[13px] font-medium text-ink">设定会话目标</div>
				<div className="flex flex-col gap-2.5">
					<div>
						<label className="mb-1 block text-[12px] text-ink-2" htmlFor={`goal-obj-${sessionId}`}>
							目标描述
						</label>
						<textarea
							id={`goal-obj-${sessionId}`}
							rows={3}
							value={objectiveInput}
							onChange={e => setObjectiveInput(e.target.value)}
							placeholder="例如：完成进程池与 LRU 回收并通过全部单元测试"
							className="w-full resize-none rounded-control bg-inset p-2 text-[13px] leading-[1.5] text-ink shadow-hairline outline-none placeholder:text-ink-3 focus:shadow-[0_0_0_1px_var(--line-strong)]"
						/>
					</div>
					<div>
						<label
							className="mb-1 block text-[12px] text-ink-2"
							htmlFor={`goal-budget-${sessionId}`}
						>
							Token 预算（可选）
						</label>
						<input
							id={`goal-budget-${sessionId}`}
							type="number"
							min={1000}
							step={10000}
							value={budgetInput}
							onChange={e => setBudgetInput(e.target.value)}
							placeholder="100000"
							className="h-7 w-full rounded-control bg-inset px-2.5 font-mono text-[12.5px] text-ink tabular-nums shadow-hairline outline-none placeholder:text-ink-3 focus:shadow-[0_0_0_1px_var(--line-strong)]"
						/>
					</div>
					<div className="flex justify-end pt-0.5">
						<Button
							variant="primary"
							size="md"
							loading={busyOp === "create"}
							disabled={objectiveInput.trim().length === 0}
							icon={<Plus size={13} strokeWidth={2.2} />}
							onClick={() =>
								void runGoalOp("create", {
									objective: objectiveInput.trim(),
									token_budget: validBudget,
								})
							}
						>
							开始
						</Button>
					</div>
				</div>
			</Card>
		);
	}

	const meter = computeGoalBudgetMeter(goal.tokensUsed, goal.tokenBudget);
	const usageSummary = formatGoalUsageSummary(goal);

	return (
		<Card className="p-3">
			<div className="flex items-start justify-between gap-2">
				<div className="min-w-0 flex-1 text-[13px] leading-[1.45] font-medium text-ink">
					{goal.objective}
				</div>
				<span className="shrink-0 whitespace-nowrap">
					<GoalStatusPill status={goal.status} />
				</span>
			</div>

			{/* Budget progress bar (FRONTEND §6.16: h4, radius 999, track bg-field, fill accent, ≥90% orange, width transition 400ms) */}
			{meter.hasBudget && (
				<div
					role="progressbar"
					aria-valuenow={Math.round(meter.rawPercent)}
					aria-valuemin={0}
					aria-valuemax={100}
					aria-label="目标预算进度"
					className="my-2.5 h-1 overflow-hidden rounded-pill bg-field"
				>
					<div
						style={{ width: `${meter.widthPercent}%` }}
						className={
							"h-full rounded-pill transition-[width] duration-400 ease-[var(--ease-out-strong)] " +
							(meter.tone === "orange" ? "bg-orange" : "bg-accent")
						}
					/>
				</div>
			)}

			<div
				className={
					"font-mono text-[11.5px] tabular-nums " +
					(meter.isWarning ? "text-orange-ink" : "text-ink-2")
				}
			>
				{usageSummary}
			</div>

			<div className="mt-3 flex items-center gap-2">
				{goal.status === "active" ? (
					<Button
						size="sm"
						variant="secondary"
						loading={busyOp === "pause"}
						icon={<Pause size={11} strokeWidth={2} />}
						onClick={() => void runGoalOp("pause")}
					>
						暂停
					</Button>
				) : goal.status === "paused" || goal.status === "budget-limited" ? (
					<Button
						size="sm"
						variant="secondary"
						loading={busyOp === "resume"}
						icon={<Play size={11} strokeWidth={2} />}
						onClick={() => void runGoalOp("resume")}
					>
						恢复
					</Button>
				) : null}
				<Button
					size="sm"
					variant="ghost"
					loading={busyOp === "drop"}
					icon={<Trash2 size={11} strokeWidth={2} />}
					onClick={() => void runGoalOp("drop")}
				>
					放弃
				</Button>
			</div>
		</Card>
	);
}
