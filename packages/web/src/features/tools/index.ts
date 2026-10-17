/**
 * Tool renderers barrel (DESIGN §8, FRONTEND §6.6, §6.9, §6.10, §6.13).
 */
export { CodeBlock, type CodeBlockProps } from "./CodeBlock";
export {
	computeDiffFromOldNew,
	DiffView,
	extractDiffSource,
	parseUnifiedDiffText,
	type DiffLine,
	type DiffViewProps,
	type ParsedDiff,
} from "./DiffView";
export {
	extractResultImages,
	extractResultText,
	formatDuration,
	GenericToolView,
	getToolRowSummary,
	renderToolDetail,
	resolveToolRenderer,
	TOOL_RENDERERS,
	type ToolRenderer,
	type ToolRenderProps,
	type ToolRowSummary,
} from "./registry";
export {
	DISPLAY_LANGUAGE_NAMES,
	highlightCodeLines,
	normalizeLanguage,
	OMP_DARK_THEME,
	OMP_LIGHT_THEME,
	tokenizeLineFallback,
	useHighlightedLines,
	type CodeToken,
} from "./shiki";
export { dispatchOpenSubagent, SubagentCapsule, type SubagentCapsuleProps } from "./SubagentCapsule";
