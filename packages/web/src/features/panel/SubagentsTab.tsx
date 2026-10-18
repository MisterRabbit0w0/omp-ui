import {
	buildSubagentTree,
	countSubagentDescendants,
	flattenSubagentTree,
	SubagentRow,
} from "@/features/subagents";
import type { SessionView } from "@/store/session-reducer";
import { Card } from "@/ui/Card";

export interface SubagentsTabProps {
	sessionId: string;
	view: SessionView | undefined;
}

/**
 * FRONTEND §6.16 & §6.13 子代理 tab:
 * Renders `view.subagents` as a tree (dotted ids, indented by depth) using
 * `SubagentRow` in `"list"` variant inside a `<Card>`.
 */
export function SubagentsTab({ sessionId, view }: SubagentsTabProps) {
	// Pre-order flatten of the dotted-id tree: nested subagents follow their parent.
	const nodes = view ? flattenSubagentTree(buildSubagentTree(view.subagents.values())) : [];

	if (nodes.length === 0) {
		return (
			<Card className="px-3 py-3 text-[12.5px] text-ink-2">
				当前会话暂无子代理
			</Card>
		);
	}

	return (
		<Card>
			{nodes.map((node, idx) => (
				<SubagentRow
					key={node.subagent.id}
					subagent={node.subagent}
					sessionId={sessionId}
					variant="list"
					depth={node.depth}
					descendantCount={countSubagentDescendants(node)}
					defaultOpen={idx === 0 && node.subagent.status === "running"}
				/>
			))}
		</Card>
	);
}
