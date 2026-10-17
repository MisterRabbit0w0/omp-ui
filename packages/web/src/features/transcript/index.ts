/**
 * Transcript feature barrel (`@/features/transcript`).
 *
 * Custom DOM events:
 * - `transcript-scroll` (`CustomEvent<{ scrolled: boolean; sessionId: string | null }>`)
 *   Dispatched on `window` whenever the transcript scroll container crosses `scrollTop > 4`,
 *   allowing `SessionHeader` to toggle its 1px bottom border (`border-line`).
 * - `open-subagent` (`CustomEvent<{ sessionId: string; subagentId: string }>`)
 *   Dispatched on `window` when a user clicks a subagent capsule in a `task` tool row.
 * - `open-panel` / `open-panel-tab` (`CustomEvent<{ tab: "changes" | "todos"; file?: string; filePath?: string; path?: string; toolCallId?: string; sessionId?: string }>`)
 *   Dispatched on `window` when a user clicks a file change chip or todo summary link.
 * - `scroll-to-tool` (`CustomEvent<{ toolCallId: string }>`)
 *   Listened to on `window` to scroll to and expand a tool call row.
 */
export { CodeBlock, DiffView, extractDiffSource, type CodeBlockProps, type DiffViewProps } from "../tools";
export { anchorApprovals, type AnchoredApprovals } from "./approval-anchor";
export { ApprovalCard, ApprovalReceipt, type ApprovalCardProps, type ApprovalReceiptState } from "./ApprovalCard";
export { AskCard, type AskCardProps } from "./AskCard";
export {
	AssistantTurnView,
	DraftTurnView,
	StandaloneMessageView,
	type AssistantTurnViewProps,
	type DraftTurnViewProps,
} from "./AssistantTurnView";
export {
	extractInlineFileMentions,
	extractUserMessageImages,
	extractUserMessageText,
	matchBranchEntry,
	resolveActiveBranchUserEntries,
	type ActiveBranchUserEntry,
} from "./branch-match";
export {
	DEFAULT_SUGGESTIONS,
	EmptySession,
	selectSuggestionsForCwd,
	type EmptySessionProps,
} from "./EmptySession";
export { OpenUrlCard, type OpenUrlCardProps } from "./OpenUrlCard";
export { Prose, type ProseProps } from "./Prose";
export { RunIndicator, TranscriptBanners, type RunIndicatorProps } from "./RunIndicator";
export { splitStreamTail, type StreamTailSplit } from "./streaming-tail";
export { ThinkingBlock, type ThinkingBlockProps } from "./ThinkingBlock";
export { ToolRunGroup, type ToolRunGroupProps } from "./ToolRunGroup";
export {
	Transcript,
	type TranscriptProps,
	type TranscriptScrollEventDetail,
} from "./Transcript";
export { UserMessageView, type UserMessageProps } from "./UserMessage";
