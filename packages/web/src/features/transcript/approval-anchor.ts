/**
 * Approval request anchoring logic (DESIGN §7.3, FRONTEND §6.7).
 *
 * Verified omp protocol rule:
 * Approval `select` arrives AFTER `tool_execution_start` for that call
 * (agent-loop emits start, then tool.execute runs the approval gate).
 * Primary anchor: the most recent tool call with the same name whose
 * `exec.status === "running"` (`toolExec` has it, no `tool_execution_end` yet).
 * Secondary fallback (for synthetic frames without `tool_execution_start`):
 * the most recent tool call with the same name that has `toolcall_end` and no `tool_execution_end`.
 * Final fallback: end of transcript (`unanchored`).
 */
import { isApprovalRequest, parseApproval, type ApprovalPrompt, type ExtensionUiRequest } from "@omp-ui/protocol";
import { toolNamesMatch, type ToolExec, type TranscriptItem } from "../../store/session-reducer";

export interface AnchoredApprovals {
	/** toolCallId -> approval prompts anchored under that tool row */
	byToolCallId: Map<string, ApprovalPrompt[]>;
	/** approval prompts that could not be matched to an awaiting tool row */
	unanchored: ApprovalPrompt[];
}

export interface CandidateToolCall {
	id: string;
	name: string;
	isRunningExec: boolean;
	hasToolCallEnd: boolean;
	hasExecutionEnd: boolean;
}

/**
 * Collect candidate tool calls in chronological order from `selectTurns(view)` and `toolExec`.
 */
export function collectCandidateToolCalls(
	turns: ReadonlyArray<TranscriptItem>,
	toolExec: Map<string, ToolExec>,
): CandidateToolCall[] {
	const candidates: CandidateToolCall[] = [];
	const seenIds = new Set<string>();

	for (const item of turns) {
		if (item.kind === "turn") {
			for (const t of item.turn.tools) {
				const exec = t.exec ?? toolExec.get(t.call.id);
				const hasToolCallEnd = Boolean(t.call.id && t.call.name);
				const hasExecutionEnd =
					t.result !== undefined || exec?.status === "done" || exec?.status === "error";
				const isRunningExec = exec?.status === "running" && !hasExecutionEnd;
				if (t.call.id) seenIds.add(t.call.id);
				candidates.push({
					id: t.call.id,
					name: t.call.name,
					isRunningExec,
					hasToolCallEnd,
					hasExecutionEnd,
				});
			}
		} else if (item.kind === "draft") {
			const { draft } = item;
			draft.content.forEach((block, contentIndex) => {
				if (block && block.type === "toolCall") {
					const hasToolCallEnd = !draft.toolArgsText.has(contentIndex) && Boolean(block.id && block.name);
					const exec = block.id ? toolExec.get(block.id) : undefined;
					const hasExecutionEnd = exec?.status === "done" || exec?.status === "error";
					const isRunningExec = exec?.status === "running" && !hasExecutionEnd;
					if (block.id) seenIds.add(block.id);
					candidates.push({
						id: block.id,
						name: block.name || exec?.toolName || "",
						isRunningExec,
						hasToolCallEnd,
						hasExecutionEnd,
					});
				}
			});
		}
	}

	// Include any toolExec entries that started before a draft/turn block had their id populated
	for (const exec of toolExec.values()) {
		if (!seenIds.has(exec.toolCallId)) {
			candidates.push({
				id: exec.toolCallId,
				name: exec.toolName,
				isRunningExec: exec.status === "running",
				hasToolCallEnd: true,
				hasExecutionEnd: exec.status === "done" || exec.status === "error",
			});
		}
	}

	return candidates;
}

export function anchorApprovals(
	turns: ReadonlyArray<TranscriptItem>,
	pendingUi: ReadonlyArray<ExtensionUiRequest>,
	toolExec: Map<string, ToolExec>,
): AnchoredApprovals {
	const byToolCallId = new Map<string, ApprovalPrompt[]>();
	const unanchored: ApprovalPrompt[] = [];

	const approvals: ApprovalPrompt[] = [];
	for (const req of pendingUi) {
		if (isApprovalRequest(req)) {
			const parsed = parseApproval(req);
			if (parsed) approvals.push(parsed);
		}
	}

	if (approvals.length === 0) {
		return { byToolCallId, unanchored };
	}

	const candidates = collectCandidateToolCalls(turns, toolExec);

	for (const approval of approvals) {
		let matchedId: string | undefined;

		// 1. Primary: most recent tool call with the same name whose exec.status === "running"
		for (let i = candidates.length - 1; i >= 0; i--) {
			const c = candidates[i]!;
			if (c.isRunningExec && toolNamesMatch(c.name, approval.toolName)) {
				matchedId = c.id;
				break;
			}
		}

		// 2. Secondary: most recent tool call with the same name that has toolcall_end and no execution_end
		if (!matchedId) {
			for (let i = candidates.length - 1; i >= 0; i--) {
				const c = candidates[i]!;
				if (c.hasToolCallEnd && !c.hasExecutionEnd && toolNamesMatch(c.name, approval.toolName)) {
					matchedId = c.id;
					break;
				}
			}
		}

		if (matchedId) {
			const list = byToolCallId.get(matchedId) ?? [];
			list.push(approval);
			byToolCallId.set(matchedId, list);
		} else {
			unanchored.push(approval);
		}
	}

	return { byToolCallId, unanchored };
}
