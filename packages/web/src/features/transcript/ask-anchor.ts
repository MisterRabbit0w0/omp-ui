/**
 * Ask request anchoring (DESIGN §7.1, FRONTEND §6.8).
 *
 * The `ask` tool call starts the UI request from inside `execute`, so the
 * request belongs under the running `ask` tool row — not at the transcript
 * tail (the native UI keeps it at its event position too).
 *
 * Pending asks match a running `ask` exec first, then a call whose execution
 * has not ended. Answered asks carry the `toolCallId` recorded at resolve
 * time; entries restored by ring replay fall back to chronological pairing
 * with the ask tool calls. Anything still unmatched stays at the tail.
 */
import type { AskUiRequest, ExtensionUiRequest } from "@omp-ui/protocol";
import type { AnsweredUi, ToolExec, TranscriptItem } from "../../store/session-reducer";
import { collectCandidateToolCalls, type CandidateToolCall } from "./approval-anchor";

export interface AnchoredAsk {
	request: AskUiRequest;
	/** Set once the request was answered/cancelled; absent while still pending. */
	entry?: AnsweredUi;
}

export interface AnchoredAsks {
	byToolCallId: Map<string, AnchoredAsk[]>;
	unanchored: AnchoredAsk[];
}

function askCandidates(
	turns: ReadonlyArray<TranscriptItem>,
	toolExec: Map<string, ToolExec>,
): CandidateToolCall[] {
	return collectCandidateToolCalls(turns, toolExec).filter(c => c.name.toLowerCase() === "ask");
}

export function anchorAsks(
	turns: ReadonlyArray<TranscriptItem>,
	pendingUi: ReadonlyArray<ExtensionUiRequest>,
	answeredUi: ReadonlyArray<AnsweredUi>,
	toolExec: Map<string, ToolExec>,
): AnchoredAsks {
	const byToolCallId = new Map<string, AnchoredAsk[]>();
	const unanchored: AnchoredAsk[] = [];
	const candidates = askCandidates(turns, toolExec);
	const used = new Set<string>();

	const attach = (ask: AnchoredAsk, toolCallId: string): void => {
		used.add(toolCallId);
		const list = byToolCallId.get(toolCallId) ?? [];
		list.push(ask);
		byToolCallId.set(toolCallId, list);
	};

	const pickFree = (predicate: (c: CandidateToolCall) => boolean): CandidateToolCall | undefined => {
		for (let i = candidates.length - 1; i >= 0; i--) {
			const c = candidates[i]!;
			if (!used.has(c.id) && predicate(c)) return c;
		}
		return undefined;
	};

	const pickFirstFree = (): CandidateToolCall | undefined => {
		for (const c of candidates) {
			if (!used.has(c.id)) return c;
		}
		return undefined;
	};

	for (const request of pendingUi) {
		if (request.method !== "ask") continue;
		const candidate =
			pickFree(c => c.isRunningExec) ?? pickFree(c => c.hasToolCallEnd && !c.hasExecutionEnd);
		const ask: AnchoredAsk = { request };
		if (candidate) attach(ask, candidate.id);
		else unanchored.push(ask);
	}

	const answeredRequests = answeredUi.filter(a => a.request.method === "ask");
	const unresolved: AnchoredAsk[] = [];
	for (const entry of answeredRequests) {
		const ask: AnchoredAsk = { request: entry.request as AskUiRequest, entry };
		if (entry.toolCallId && candidates.some(c => c.id === entry.toolCallId)) {
			attach(ask, entry.toolCallId);
		} else {
			unresolved.push(ask);
		}
	}

	// Replay has no response payload: pair leftovers with the remaining ask calls in order.
	for (const ask of unresolved) {
		const candidate = pickFirstFree();
		if (candidate) attach(ask, candidate.id);
		else unanchored.push(ask);
	}

	return { byToolCallId, unanchored };
}
