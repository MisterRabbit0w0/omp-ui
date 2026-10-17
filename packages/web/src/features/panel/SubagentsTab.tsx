import { SubagentRow } from "@/features/subagents";
import type { SessionView } from "@/store/session-reducer";
import { Card } from "@/ui/Card";

export interface SubagentsTabProps {
	sessionId: string;
	view: SessionView | undefined;
}

/**
 * FRONTEND §6.16 & §6.13 子代理 tab:
 * Renders `view.subagents` using `SubagentRow` in `"list"` variant inside a `<Card>`.
 */
export function SubagentsTab({ sessionId, view }: SubagentsTabProps) {
	const subagents = view
		? [...view.subagents.values()].sort((a, b) => a.index - b.index)
		: [];

	if (subagents.length === 0) {
		return (
			<Card className="px-3 py-3 text-[12.5px] text-ink-2">
				当前会话暂无子代理
			</Card>
		);
	}

	return (
		<Card>
			{subagents.map((sub, idx) => (
				<SubagentRow
					key={sub.id}
					subagent={sub}
					sessionId={sessionId}
					variant="list"
					defaultOpen={idx === 0 && sub.status === "running"}
				/>
			))}
		</Card>
	);
}
