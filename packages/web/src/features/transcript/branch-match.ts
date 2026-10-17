/**
 * User message to session entryId matching (DESIGN §9.3, verified protocol rule #3).
 *
 * Verified omp protocol rule:
 * `get_branch_messages` returns user messages from ALL branches in append order (and drops
 * image-only messages). To map a transcript user message to its `entryId`:
 * Call `get_entries`, take `leafId`, walk `parentId` from leaf to root to reconstruct the
 * active branch, keep `type === "message"` entries whose `message.role === "user"` in
 * root → leaf order; the k-th user message in the transcript maps to the k-th of those.
 */
import type { BranchMessage, ImageContent, MessageContent, SessionEntries, UserMessage } from "@omp-ui/protocol";

function isPlainRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function extractUserMessageText(content: MessageContent): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	const parts: string[] = [];
	for (const block of content) {
		if (block.type === "text" && typeof block.text === "string") {
			parts.push(block.text);
		}
	}
	return parts.join("\n");
}

export function extractUserMessageImages(content: MessageContent): ImageContent[] {
	if (!Array.isArray(content)) return [];
	const out: ImageContent[] = [];
	for (const block of content) {
		if (block.type === "image") {
			out.push(block);
		}
	}
	return out;
}

export function extractInlineFileMentions(text: string): string[] {
	const mentions: string[] = [];
	const seen = new Set<string>();
	const regex = /(?:^|\s)@([A-Za-z0-9_./\\-]+\.[A-Za-z0-9]+)(?=\s|$|[，。！？,.;:!?])/g;
	let match: RegExpExecArray | null;
	while ((match = regex.exec(text)) !== null) {
		const path = match[1]!;
		if (!seen.has(path)) {
			seen.add(path);
			mentions.push(path);
		}
	}
	return mentions;
}

export interface ActiveBranchUserEntry {
	entryId: string;
	text: string;
}

/**
 * Walk `parentId` from `leafId` to root in `SessionEntries`, returning the active branch's
 * user message entries in root → leaf order.
 */
export function resolveActiveBranchUserEntries(entriesResult: SessionEntries): ActiveBranchUserEntry[] {
	const entries = Array.isArray(entriesResult.entries) ? entriesResult.entries : [];
	if (entries.length === 0) return [];

	const byId = new Map<string, Record<string, unknown>>();
	let lastId: string | null = null;
	for (const raw of entries) {
		if (isPlainRecord(raw)) {
			const id = typeof raw.id === "string" ? raw.id : typeof raw.entryId === "string" ? raw.entryId : null;
			if (id) {
				byId.set(id, raw);
				lastId = id;
			}
		}
	}

	const startId = entriesResult.leafId ?? lastId;
	if (!startId || !byId.has(startId)) {
		// If entries lack parentId/id tree links, fall back to filtering entries in order
		const flat: ActiveBranchUserEntry[] = [];
		for (const raw of entries) {
			if (!isPlainRecord(raw) || raw.type !== "message" || !isPlainRecord(raw.message)) continue;
			if (raw.message.role !== "user" || raw.message.synthetic === true) continue;
			const id = typeof raw.id === "string" ? raw.id : typeof raw.entryId === "string" ? raw.entryId : "";
			if (!id) continue;
			const content = raw.message.content as MessageContent | undefined;
			flat.push({ entryId: id, text: content !== undefined ? extractUserMessageText(content) : "" });
		}
		return flat;
	}

	const chainReversed: Record<string, unknown>[] = [];
	const visited = new Set<string>();
	let curId: string | null = startId;
	while (curId && !visited.has(curId)) {
		visited.add(curId);
		const node = byId.get(curId);
		if (!node) break;
		chainReversed.push(node);
		curId = typeof node.parentId === "string" && node.parentId.length > 0 ? node.parentId : null;
	}

	const chain = chainReversed.reverse();
	const out: ActiveBranchUserEntry[] = [];
	for (const node of chain) {
		if (node.type !== "message" || !isPlainRecord(node.message)) continue;
		if (node.message.role !== "user" || node.message.synthetic === true) continue;
		const id = typeof node.id === "string" ? node.id : typeof node.entryId === "string" ? node.entryId : "";
		if (!id) continue;
		const content = node.message.content as MessageContent | undefined;
		out.push({ entryId: id, text: content !== undefined ? extractUserMessageText(content) : "" });
	}
	return out;
}

/**
 * Match the k-th user message in the transcript to its `BranchMessage` (`{ entryId, text }`),
 * accepting either a `SessionEntries` result from `get_entries` (preferred, walks `leafId` → `parentId`)
 * or a `ReadonlyArray<BranchMessage>` fallback.
 */
export function matchBranchEntry(
	userMessages: ReadonlyArray<Pick<UserMessage, "content" | "synthetic">>,
	targetIndex: number,
	entriesOrBranchMessages: SessionEntries | ReadonlyArray<BranchMessage>,
): BranchMessage | undefined {
	if (targetIndex < 0 || targetIndex >= userMessages.length) {
		return undefined;
	}

	const branchList: ReadonlyArray<BranchMessage> = Array.isArray(entriesOrBranchMessages)
		? entriesOrBranchMessages
		: resolveActiveBranchUserEntries(entriesOrBranchMessages as SessionEntries);

	if (branchList.length === 0) {
		return undefined;
	}

	// Count non-synthetic user messages before targetIndex so the k-th transcript user message
	// maps to the k-th user message entry on the root → leaf active branch
	let nonSyntheticOrdinal = 0;
	for (let i = 0; i < targetIndex; i++) {
		if (!userMessages[i]!.synthetic) {
			nonSyntheticOrdinal++;
		}
	}

	if (!Array.isArray(entriesOrBranchMessages)) {
		// From get_entries active branch walk: k-th user message ↔ k-th entry in root → leaf order
		return branchList[nonSyntheticOrdinal];
	}

	// Fallback when given BranchMessage[] directly
	const targetMsg = userMessages[targetIndex]!;
	const targetText = extractUserMessageText(targetMsg.content).trim();
	const candidateAtOrdinal = branchList[nonSyntheticOrdinal];
	if (candidateAtOrdinal && candidateAtOrdinal.text.trim() === targetText) {
		return candidateAtOrdinal;
	}

	const nonSyntheticTotal = userMessages.filter(m => !m.synthetic).length;
	if (nonSyntheticTotal === branchList.length && candidateAtOrdinal) {
		return candidateAtOrdinal;
	}

	if (targetText.length > 0) {
		let sameTextOccurrence = 0;
		for (let i = 0; i < targetIndex; i++) {
			if (extractUserMessageText(userMessages[i]!.content).trim() === targetText) {
				sameTextOccurrence++;
			}
		}
		let seenSame = 0;
		for (const bm of branchList) {
			if (bm.text.trim() === targetText) {
				if (seenSame === sameTextOccurrence) {
					return bm;
				}
				seenSame++;
			}
		}
	}

	return candidateAtOrdinal ?? branchList[targetIndex];
}
