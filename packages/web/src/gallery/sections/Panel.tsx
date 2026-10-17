import { useEffect, useState } from "react";
import { BtwDrawer, openBtwDrawer } from "@/features/btw";
import { GoalTab, SidePanel } from "@/features/panel";
import { openSubagentDrawer, SubagentDrawer, SubagentRow } from "@/features/subagents";
import {
	buildPanelFixtureView,
	PANEL_FIXTURE_SESSION_ID,
	PANEL_FIXTURE_SUBAGENT_MESSAGES,
} from "@/fixtures/panel";
import { useAppStore } from "@/store/app-store";
import { Button } from "@/ui/Button";

const WARN_SESSION_ID = "fixture-panel-goal-warn";
const EMPTY_GOAL_SESSION_ID = "fixture-panel-goal-empty";

export default function PanelGallerySection() {
	const [fixtureView] = useState(() => buildPanelFixtureView(PANEL_FIXTURE_SESSION_ID));
	const [warnGoalView] = useState(() =>
		buildPanelFixtureView(WARN_SESSION_ID, { goalTokensUsed: 94000 }),
	);
	const [emptyGoalView] = useState(() =>
		buildPanelFixtureView(EMPTY_GOAL_SESSION_ID, { noGoal: true }),
	);

	// Seed the app store with the fixture views so interactive controls and drawers work live.
	useEffect(() => {
		useAppStore.setState(s => ({
			currentSessionId: s.currentSessionId ?? PANEL_FIXTURE_SESSION_ID,
			views: {
				...s.views,
				[PANEL_FIXTURE_SESSION_ID]: s.views[PANEL_FIXTURE_SESSION_ID] ?? fixtureView,
				[WARN_SESSION_ID]: s.views[WARN_SESSION_ID] ?? warnGoalView,
				[EMPTY_GOAL_SESSION_ID]: s.views[EMPTY_GOAL_SESSION_ID] ?? emptyGoalView,
			},
		}));
	}, [fixtureView, warnGoalView, emptyGoalView]);

	const currentMainView = useAppStore(s => s.views[PANEL_FIXTURE_SESSION_ID]) ?? fixtureView;
	const subagentList = [...currentMainView.subagents.values()].sort((a, b) => a.index - b.index);

	return (
		<div className="col-span-2 flex flex-col gap-6">
			<div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-6">
				<div>
					<h2 className="text-[16px] font-semibold text-ink">
						右侧面板 · 子代理 · 旁问 (SidePanel & Drawers)
					</h2>
					<p className="text-[12px] text-ink-2">
						覆盖 §6.13 子代理胶囊/列表变体、§6.16 五个面板标签页（待办/子代理/变更/目标/信息）、子代理抽屉与旁问抽屉。
					</p>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<Button
						size="sm"
						variant="secondary"
						onClick={() =>
							useAppStore.setState(s => ({
								todoFlash: { ...s.todoFlash, [PANEL_FIXTURE_SESSION_ID]: Date.now() },
							}))
						}
					>
						触发待办提醒闪烁 (todoFlash)
					</Button>
					<Button
						size="sm"
						variant="secondary"
						onClick={() => openSubagentDrawer(PANEL_FIXTURE_SESSION_ID, "sub-explore")}
					>
						弹出子代理抽屉 (Portal)
					</Button>
					<Button
						size="sm"
						variant="secondary"
						onClick={() => openBtwDrawer(PANEL_FIXTURE_SESSION_ID)}
					>
						弹出旁问抽屉 (Portal)
					</Button>
				</div>
			</div>

			{/* 1. All 5 tabs of SidePanel side-by-side */}
			<div>
				<h4 className="mb-2 text-[10.5px] font-medium tracking-[0.08em] text-ink-3 uppercase">
					右侧面板全部标签页 (SidePanel — 待办 / 子代理 / 变更 / 目标 / 信息)
				</h4>
				<div className="grid grid-cols-3 gap-4">
					<div className="h-[540px] overflow-hidden rounded-card shadow-card">
						<SidePanel
							sessionId={PANEL_FIXTURE_SESSION_ID}
							defaultTab="todo"
							view={currentMainView}
							includeOverlays={false}
						/>
					</div>
					<div className="h-[540px] overflow-hidden rounded-card shadow-card">
						<SidePanel
							sessionId={PANEL_FIXTURE_SESSION_ID}
							defaultTab="subagents"
							view={currentMainView}
							includeOverlays={false}
						/>
					</div>
					<div className="h-[540px] overflow-hidden rounded-card shadow-card">
						<SidePanel
							sessionId={PANEL_FIXTURE_SESSION_ID}
							defaultTab="changes"
							view={currentMainView}
							includeOverlays={false}
						/>
					</div>
					<div className="h-[540px] overflow-hidden rounded-card shadow-card">
						<SidePanel
							sessionId={PANEL_FIXTURE_SESSION_ID}
							defaultTab="goal"
							view={currentMainView}
							includeOverlays={false}
						/>
					</div>
					<div className="h-[540px] overflow-hidden rounded-card shadow-card">
						<SidePanel
							sessionId={PANEL_FIXTURE_SESSION_ID}
							defaultTab="info"
							view={currentMainView}
							includeOverlays={false}
						/>
					</div>
				</div>
			</div>

			{/* 2. SubagentRow Capsule variant + Goal states (≥90% orange warning & creation form) */}
			<div className="grid grid-cols-2 gap-5">
				<div>
					<h4 className="mb-2 text-[10.5px] font-medium tracking-[0.08em] text-ink-3 uppercase">
						子代理胶囊变体 (SubagentRow variant="capsule" · §6.13)
					</h4>
					<div className="flex flex-col gap-2">
						{subagentList.map((sub, idx) => (
							<SubagentRow
								key={sub.id}
								subagent={sub}
								sessionId={PANEL_FIXTURE_SESSION_ID}
								variant="capsule"
								defaultOpen={idx === 0}
							/>
						))}
					</div>
				</div>

				<div className="flex flex-col gap-3">
					<div>
						<h4 className="mb-2 text-[10.5px] font-medium tracking-[0.08em] text-ink-3 uppercase">
							目标状态：预算 ≥90% 橙色预警 & 创建表单 (§6.16)
						</h4>
						<div className="grid grid-cols-2 gap-3">
							<GoalTab
								sessionId={WARN_SESSION_ID}
								view={useAppStore(s => s.views[WARN_SESSION_ID]) ?? warnGoalView}
							/>
							<GoalTab
								sessionId={EMPTY_GOAL_SESSION_ID}
								view={useAppStore(s => s.views[EMPTY_GOAL_SESSION_ID]) ?? emptyGoalView}
							/>
						</div>
					</div>
				</div>
			</div>

			{/* 3. Both drawers open inline (SubagentDrawer & BtwDrawer) */}
			<div className="grid grid-cols-2 gap-5">
				<div>
					<h4 className="mb-2 text-[10.5px] font-medium tracking-[0.08em] text-ink-3 uppercase">
						子代理抽屉打开态 (SubagentDrawer · §10.2)
					</h4>
					<SubagentDrawer
						sessionId={PANEL_FIXTURE_SESSION_ID}
						initialSubagentId="sub-explore"
						subagent={currentMainView.subagents.get("sub-explore")}
						initialMessages={PANEL_FIXTURE_SUBAGENT_MESSAGES}
						inline
					/>
				</div>
				<div>
					<h4 className="mb-2 text-[10.5px] font-medium tracking-[0.08em] text-ink-3 uppercase">
						旁问抽屉打开态 (BtwDrawer · §9.8)
					</h4>
					<BtwDrawer
						sessionId={PANEL_FIXTURE_SESSION_ID}
						view={currentMainView}
						defaultOpen
						inline
					/>
				</div>
			</div>
		</div>
	);
}
