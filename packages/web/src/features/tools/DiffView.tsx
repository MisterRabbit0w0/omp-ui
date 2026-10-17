/**
 * DiffView component (FRONTEND §6.9, DESIGN §8).
 * Supports:
 * - omp's numbered diff format (`+123|content`, `-123|content`, ` 123|content`, and legacy `+123 content`)
 * - git unified diff format (`@@ -a,b +c,d @@`)
 * - computing hunks via `diff` (`diffLines`) when `oldText`/`newText` exist (preferred over `diff` string)
 * - multi-file edits via `details.perFileResults`
 * - `write` tool rendering from `args.content`
 * - unified and side-by-side (split) modes, folding unchanged runs, and Shiki/token coloring.
 */
import { diffLines } from "diff";
import { Check, Copy, FileText, WrapText } from "lucide-react";
import { useMemo, useState } from "react";
import { Card, CardBar } from "../../ui/Card";
import { Icon } from "../../ui/Icon";
import { tokenizeLineFallback, type CodeToken } from "./shiki";

export interface DiffLine {
	kind: "add" | "del" | "context" | "hunk";
	oldLineNumber?: number;
	newLineNumber?: number;
	content: string;
	tokens: CodeToken[];
}

export interface ParsedDiff {
	lines: DiffLine[];
	additions: number;
	deletions: number;
}

export interface SingleFileDiffSource {
	filePath?: string;
	diff?: string;
	oldText?: string;
	newText?: string;
	rawText?: string;
	additions?: number;
	deletions?: number;
}

export interface ExtractedDiffSource extends SingleFileDiffSource {
	perFileResults?: SingleFileDiffSource[];
}

export interface DiffViewProps {
	filePath?: string;
	/** Alias for filePath so callers from SidePanel or tools can pass either. */
	path?: string;
	diff?: string;
	oldText?: string;
	newText?: string;
	rawText?: string;
	additions?: number;
	deletions?: number;
	defaultMode?: "unified" | "split";
	showHeader?: boolean;
	wrap?: boolean;
	defaultWrap?: boolean;
	className?: string;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

const OMP_NUMBERED_PIPE_RE = /^([+-]|−| )(\s*\d+)\|(.*)$/;
const OMP_NUMBERED_SPACE_RE = /^([+-]|−| )(\s*\d+)\s(.*)$/;

/**
 * Parse either omp's numbered diff format (`+123|content`, `-123|content`, ` 123|content`,
 * legacy `+123 content`) OR standard unified diff (`@@ -a,b +c,d @@`).
 */
export function parseUnifiedDiffText(diffText: string): ParsedDiff {
	const rawLines = diffText.replace(/\r\n/g, "\n").split("\n");
	if (rawLines.length > 0 && rawLines[rawLines.length - 1] === "") {
		rawLines.pop();
	}
	const lines: DiffLine[] = [];
	let additions = 0;
	let deletions = 0;
	let oldLn = 1;
	let newLn = 1;

	for (const line of rawLines) {
		if (line.startsWith("--- ") || line.startsWith("+++ ") || line.startsWith("Index:") || line.startsWith("===")) {
			continue;
		}
		// Ellipsis separator in omp diff output (`...` or `   ...`)
		if (/^\s*(?:\.{3}|⋯)\s*$/.test(line)) {
			lines.push({
				kind: "hunk",
				content: "⋯",
				tokens: [{ content: "⋯", color: "var(--ink-2)" }],
			});
			continue;
		}
		// 1. Check omp numbered diff format: `+123|content`, `-123|content`, ` 123|content` or legacy `+123 content`
		const pipeMatch = OMP_NUMBERED_PIPE_RE.exec(line) ?? OMP_NUMBERED_SPACE_RE.exec(line);
		if (pipeMatch) {
			const sign = pipeMatch[1]!;
			const ln = Number.parseInt(pipeMatch[2]!.trim(), 10);
			const content = pipeMatch[3]!;
			if (sign === "+") {
				additions++;
				newLn = ln + 1;
				lines.push({
					kind: "add",
					newLineNumber: ln,
					content,
					tokens: tokenizeLineFallback(content),
				});
			} else if (sign === "-" || sign === "−") {
				deletions++;
				oldLn = ln + 1;
				lines.push({
					kind: "del",
					oldLineNumber: ln,
					content,
					tokens: tokenizeLineFallback(content),
				});
			} else {
				oldLn = ln + 1;
				newLn = ln + 1;
				lines.push({
					kind: "context",
					oldLineNumber: ln,
					newLineNumber: ln,
					content,
					tokens: tokenizeLineFallback(content),
				});
			}
			continue;
		}

		// 2. Check git unified diff hunk header
		const hunkMatch = /^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@(.*)$/.exec(line);
		if (hunkMatch) {
			oldLn = Number.parseInt(hunkMatch[1]!, 10);
			newLn = Number.parseInt(hunkMatch[2]!, 10);
			lines.push({
				kind: "hunk",
				content: line,
				tokens: [{ content: line, color: "var(--ink-2)" }],
			});
			continue;
		}

		// 3. Standard unified diff lines (`+`, `-`, ` `)
		if (line.startsWith("+")) {
			const content = line.slice(1);
			additions++;
			lines.push({
				kind: "add",
				newLineNumber: newLn++,
				content,
				tokens: tokenizeLineFallback(content),
			});
		} else if (line.startsWith("-") || line.startsWith("−")) {
			const content = line.slice(1);
			deletions++;
			lines.push({
				kind: "del",
				oldLineNumber: oldLn++,
				content,
				tokens: tokenizeLineFallback(content),
			});
		} else {
			const content = line.startsWith(" ") ? line.slice(1) : line;
			lines.push({
				kind: "context",
				oldLineNumber: oldLn++,
				newLineNumber: newLn++,
				content,
				tokens: tokenizeLineFallback(content),
			});
		}
	}
	return { lines, additions, deletions };
}

/** Build DiffLine[] from oldText and newText using `diffLines` from `diff`. */
export function computeDiffFromOldNew(oldText: string, newText: string): ParsedDiff {
	const changes = diffLines(oldText.replace(/\r\n/g, "\n"), newText.replace(/\r\n/g, "\n"));
	const lines: DiffLine[] = [];
	let additions = 0;
	let deletions = 0;
	let oldLn = 1;
	let newLn = 1;

	for (const part of changes) {
		const partLines = part.value.split("\n");
		if (partLines.length > 0 && partLines[partLines.length - 1] === "") {
			partLines.pop();
		}
		for (const content of partLines) {
			const tokens = tokenizeLineFallback(content);
			if (part.added) {
				additions++;
				lines.push({ kind: "add", newLineNumber: newLn++, content, tokens });
			} else if (part.removed) {
				deletions++;
				lines.push({ kind: "del", oldLineNumber: oldLn++, content, tokens });
			} else {
				lines.push({
					kind: "context",
					oldLineNumber: oldLn++,
					newLineNumber: newLn++,
					content,
					tokens,
				});
			}
		}
	}
	return { lines, additions, deletions };
}

function extractOneFileDiff(detailsObj: Record<string, unknown>): SingleFileDiffSource {
	const rawPath = detailsObj.path ?? detailsObj.resolvedPath ?? detailsObj.file ?? detailsObj.filePath;
	const filePath = typeof rawPath === "string" ? rawPath : undefined;

	const additions =
		typeof detailsObj.additions === "number"
			? detailsObj.additions
			: typeof detailsObj.addedLines === "number"
				? detailsObj.addedLines
				: typeof detailsObj.added === "number"
					? detailsObj.added
					: undefined;
	const deletions =
		typeof detailsObj.deletions === "number"
			? detailsObj.deletions
			: typeof detailsObj.removedLines === "number"
				? detailsObj.removedLines
				: typeof detailsObj.removed === "number"
					? detailsObj.removed
					: undefined;

	// Prefer oldText/newText when present so we can compute full hunks with `diff`
	const detailOld = detailsObj.oldText ?? detailsObj.oldContent ?? detailsObj.before;
	const detailNew = detailsObj.newText ?? detailsObj.newContent ?? detailsObj.after;
	if (typeof detailOld === "string" && typeof detailNew === "string") {
		const detailDiff = typeof detailsObj.diff === "string" ? detailsObj.diff : undefined;
		return { filePath, oldText: detailOld, newText: detailNew, diff: detailDiff, additions, deletions };
	}

	const detailDiff = detailsObj.diff ?? detailsObj.patch ?? detailsObj.unifiedDiff;
	if (typeof detailDiff === "string" && detailDiff.trim().length > 0) {
		return { filePath, diff: detailDiff, additions, deletions };
	}

	return { filePath, additions, deletions };
}

/**
 * Extract diff source following verified omp protocol & DESIGN §8 preference:
 * 1. `result.details`:
 *    - if `perFileResults` array exists, extract each file's diff (`oldText`/`newText` preferred, else `diff`)
 *    - if `oldText`/`newText` exist on `details`, prefer computing hunks from them
 *    - if `details.diff` exists (`+123|content` or unified), parse that
 * 2. `args`:
 *    - `oldText`/`newText` (`old_string`/`new_string`)
 *    - `write` tool: `args.content` (rendered as new file additions)
 *    - `edit` tool hashline `args.input`
 * 3. `raw` fallback (`rawResultText`)
 */
export function extractDiffSource(
	args: unknown,
	details: unknown,
	rawResultText?: string,
): ExtractedDiffSource {
	const argsObj: Record<string, unknown> = isPlainRecord(args) ? args : {};
	const detailsObj: Record<string, unknown> = isPlainRecord(details) ? details : {};

	const rawPath =
		detailsObj.path ??
		detailsObj.resolvedPath ??
		detailsObj.file ??
		detailsObj.filePath ??
		argsObj.path ??
		argsObj.file ??
		argsObj.filePath ??
		argsObj.notebookPath;
	let filePath = typeof rawPath === "string" ? rawPath : undefined;

	// Multi-file edits (`details.perFileResults`)
	let perFileResults: SingleFileDiffSource[] | undefined;
	if (Array.isArray(detailsObj.perFileResults) && detailsObj.perFileResults.length > 0) {
		perFileResults = [];
		for (const item of detailsObj.perFileResults) {
			if (isPlainRecord(item)) {
				const one = extractOneFileDiff(item);
				if (one.filePath || one.diff || one.oldText !== undefined || one.newText !== undefined) {
					perFileResults.push(one);
				}
			}
		}
		if (perFileResults.length > 0) {
			const first = perFileResults[0]!;
			return {
				...first,
				filePath: first.filePath ?? filePath,
				perFileResults,
			};
		}
	}

	const fromDetails = extractOneFileDiff(detailsObj);
	if (fromDetails.oldText !== undefined && fromDetails.newText !== undefined) {
		return { ...fromDetails, filePath: fromDetails.filePath ?? filePath };
	}
	if (fromDetails.diff) {
		return { ...fromDetails, filePath: fromDetails.filePath ?? filePath };
	}

	const additions = fromDetails.additions;
	const deletions = fromDetails.deletions;

	// 2. Check args old/new or write content or hashline input
	const argOld = argsObj.oldText ?? argsObj.old_string ?? argsObj.oldContent ?? argsObj.oldStr;
	const argNew = argsObj.newText ?? argsObj.new_string ?? argsObj.newContent ?? argsObj.newStr;
	if (typeof argOld === "string" && typeof argNew === "string") {
		return { filePath, oldText: argOld, newText: argNew, additions, deletions };
	}
	if (typeof argsObj.diff === "string" && argsObj.diff.trim().length > 0) {
		return { filePath, diff: argsObj.diff, additions, deletions };
	}
	if (typeof argsObj.content === "string") {
		// `write` tool: details have no diff, render from args.content as new file
		return { filePath, oldText: "", newText: argsObj.content, additions, deletions };
	}
	if (typeof argsObj.newSource === "string") {
		return { filePath, oldText: "", newText: argsObj.newSource, additions, deletions };
	}
	if (typeof argsObj.input === "string" && argsObj.input.trim().length > 0) {
		const rawInput = argsObj.input;
		if (!filePath) {
			const headerMatch = /^\[([^\]#]+)(?:#[0-9A-Fa-f]+)?\]/m.exec(rawInput);
			if (headerMatch) filePath = headerMatch[1];
		}
		return { filePath, diff: rawInput, additions, deletions };
	}

	// 3. Fallback to raw result text
	return { filePath, rawText: rawResultText ?? "", additions, deletions };
}

type DisplaySegment =
	| { type: "line"; line: DiffLine; index: number }
	| { type: "fold"; id: string; count: number; lines: DiffLine[]; startIndex: number };

const FOLD_THRESHOLD = 6;
const CONTEXT_KEEP = 2;

function groupWithFolds(lines: DiffLine[], expandedFolds: Record<string, true>): DisplaySegment[] {
	const segments: DisplaySegment[] = [];
	let i = 0;
	while (i < lines.length) {
		if (lines[i]!.kind === "context") {
			let j = i;
			while (j < lines.length && lines[j]!.kind === "context") j++;
			const runLen = j - i;
			const foldId = `fold-${i}-${j}`;
			if (runLen > FOLD_THRESHOLD && !expandedFolds[foldId]) {
				for (let k = i; k < i + CONTEXT_KEEP; k++) {
					segments.push({ type: "line", line: lines[k]!, index: k });
				}
				const foldedSlice = lines.slice(i + CONTEXT_KEEP, j - CONTEXT_KEEP);
				segments.push({
					type: "fold",
					id: foldId,
					count: foldedSlice.length,
					lines: foldedSlice,
					startIndex: i + CONTEXT_KEEP,
				});
				for (let k = j - CONTEXT_KEEP; k < j; k++) {
					segments.push({ type: "line", line: lines[k]!, index: k });
				}
			} else {
				for (let k = i; k < j; k++) {
					segments.push({ type: "line", line: lines[k]!, index: k });
				}
			}
			i = j;
		} else {
			segments.push({ type: "line", line: lines[i]!, index: i });
			i++;
		}
	}
	return segments;
}

interface SplitPair {
	kind: "hunk" | "fold" | "pair";
	hunkText?: string;
	foldId?: string;
	foldCount?: number;
	left?: DiffLine;
	right?: DiffLine;
}

function buildSplitPairs(segments: DisplaySegment[]): SplitPair[] {
	const out: SplitPair[] = [];
	let i = 0;
	while (i < segments.length) {
		const seg = segments[i]!;
		if (seg.type === "fold") {
			out.push({ kind: "fold", foldId: seg.id, foldCount: seg.count });
			i++;
			continue;
		}
		const line = seg.line;
		if (line.kind === "hunk") {
			out.push({ kind: "hunk", hunkText: line.content });
			i++;
			continue;
		}
		if (line.kind === "context") {
			out.push({ kind: "pair", left: line, right: line });
			i++;
			continue;
		}
		const dels: DiffLine[] = [];
		const adds: DiffLine[] = [];
		while (i < segments.length) {
			const cur = segments[i]!;
			if (cur.type !== "line") break;
			const l = cur.line;
			if (l.kind === "del") {
				dels.push(l);
				i++;
			} else if (l.kind === "add") {
				adds.push(l);
				i++;
			} else {
				break;
			}
		}
		const maxLen = Math.max(dels.length, adds.length);
		for (let k = 0; k < maxLen; k++) {
			out.push({ kind: "pair", left: dels[k], right: adds[k] });
		}
	}
	return out;
}

const DIFF_MAX_HEIGHT = 480;
/** 480px / 20.4px per row; fewer rows than this never overflow, so no button. */
const DIFF_COLLAPSE_LINES = 24;

export function DiffView({
	filePath,
	path,
	diff,
	oldText,
	newText,
	rawText,
	additions: additionsProp,
	deletions: deletionsProp,
	defaultMode = "unified",
	wrap: controlledWrap,
	defaultWrap = false,
	showHeader = true,
	className,
}: DiffViewProps) {
	const [mode, setMode] = useState<"unified" | "split">(defaultMode);
	const [internalWrap, setInternalWrap] = useState(defaultWrap);
	const wrap = controlledWrap ?? internalWrap;
	const [expandedFolds, setExpandedFolds] = useState<Record<string, true>>({});
	const [copied, setCopied] = useState(false);
	const [bodyExpanded, setBodyExpanded] = useState(false);

	const resolvedPath = filePath ?? path ?? "";
	const lastSlash = Math.max(resolvedPath.lastIndexOf("/"), resolvedPath.lastIndexOf("\\"));
	const dirPart = lastSlash >= 0 ? resolvedPath.slice(0, lastSlash + 1) : "";
	const basePart = lastSlash >= 0 ? resolvedPath.slice(lastSlash + 1) : resolvedPath || "diff";

	// Prefer oldText/newText when provided (verified protocol rule #2), otherwise parse diff / rawText
	const parsed = useMemo<ParsedDiff>(() => {
		if (typeof oldText === "string" || typeof newText === "string") {
			return computeDiffFromOldNew(oldText ?? "", newText ?? "");
		}
		if (typeof diff === "string" && diff.length > 0) {
			return parseUnifiedDiffText(diff);
		}
		if (typeof rawText === "string" && rawText.length > 0) {
			return parseUnifiedDiffText(rawText);
		}
		return { lines: [], additions: 0, deletions: 0 };
	}, [diff, oldText, newText, rawText]);

	const additions = additionsProp ?? parsed.additions;
	const deletions = deletionsProp ?? parsed.deletions;
	const segments = useMemo(() => groupWithFolds(parsed.lines, expandedFolds), [parsed.lines, expandedFolds]);
	const splitPairs = useMemo(() => (mode === "split" ? buildSplitPairs(segments) : []), [mode, segments]);

	const handleCopy = () => {
		const copyPayload =
			newText ??
			diff ??
			rawText ??
			parsed.lines
				.filter(l => l.kind !== "del" && l.kind !== "hunk")
				.map(l => l.content)
				.join("\n");
		if (typeof navigator !== "undefined" && navigator.clipboard) {
			void navigator.clipboard.writeText(copyPayload);
		}
		setCopied(true);
		setTimeout(() => setCopied(false), 1500);
	};

	const renderTokens = (tokens: CodeToken[], isAdd: boolean) =>
		tokens.map((tok, idx) => (
			<span
				key={idx}
				style={{
					color: tok.color === "var(--ink-2)" && isAdd ? "var(--ink)" : tok.color,
					fontStyle: tok.italic ? "italic" : undefined,
				}}
			>
				{tok.content}
			</span>
		));

	const diffRows =
		mode === "unified" ? (
			<div className={wrap ? "min-w-full" : "min-w-full w-max"}>
				{segments.map(seg => {
					if (seg.type === "fold") {
						return (
							<button
								key={seg.id}
								type="button"
								onClick={() => setExpandedFolds(prev => ({ ...prev, [seg.id]: true }))}
								className="flex h-6 w-full items-center gap-2 whitespace-nowrap bg-field px-3 text-left text-[11.5px] text-ink-2 transition-colors hover:bg-hover"
							>
								<span>⋯ 显示 {seg.count} 行未改动</span>
							</button>
						);
					}
					const { line, index } = seg;
					if (line.kind === "hunk") {
						return (
							<div key={index} className="flex h-6 items-center whitespace-nowrap bg-field px-3 text-[11.5px] text-ink-2">
								{line.content}
							</div>
						);
					}
					const isAdd = line.kind === "add";
					const isDel = line.kind === "del";
					return (
						<div
							key={index}
							className={
								(wrap
									? "grid min-w-full grid-cols-[40px_40px_14px_minmax(0,1fr)] pr-3 whitespace-pre-wrap break-all "
									: "grid min-w-max grid-cols-[40px_40px_14px_1fr] pr-3 whitespace-pre ") +
								(isAdd ? "bg-green-tint text-ink" : isDel ? "bg-red-tint text-ink-2" : "text-ink-2")
							}
						>
							<span className="select-none pr-1.5 text-right text-[11px] text-ink-3 opacity-60 tabular-nums">
								{line.oldLineNumber ?? ""}
							</span>
							<span className="select-none pr-1.5 text-right text-[11px] text-ink-3 opacity-60 tabular-nums">
								{line.newLineNumber ?? ""}
							</span>
							<span className={"select-none " + (isAdd ? "text-green" : isDel ? "text-red" : "")}>
								{isAdd ? "+" : isDel ? "−" : ""}
							</span>
							<span className={wrap ? "min-w-0 break-all" : undefined}>{renderTokens(line.tokens, isAdd)}</span>
						</div>
					);
				})}
			</div>
		) : (
			<div className={wrap ? "min-w-full" : "min-w-full w-max"}>
				{splitPairs.map((pair, idx) => {
					if (pair.kind === "fold" && pair.foldId) {
						const foldId = pair.foldId;
						return (
							<button
								key={foldId}
								type="button"
								onClick={() => setExpandedFolds(prev => ({ ...prev, [foldId]: true }))}
								className="flex h-6 w-full items-center gap-2 whitespace-nowrap bg-field px-3 text-left text-[11.5px] text-ink-2 transition-colors hover:bg-hover"
							>
								<span>⋯ 显示 {pair.foldCount} 行未改动</span>
							</button>
						);
					}
					if (pair.kind === "hunk") {
						return (
							<div key={idx} className="flex h-6 items-center whitespace-nowrap bg-field px-3 text-[11.5px] text-ink-2">
								{pair.hunkText}
							</div>
						);
					}
					const left = pair.left;
					const right = pair.right;
					return (
						<div
							key={idx}
							className={
								wrap
									? "grid min-w-full grid-cols-[minmax(0,1fr)_1px_minmax(0,1fr)] whitespace-pre-wrap break-all"
									: "grid min-w-max grid-cols-[1fr_1px_1fr] whitespace-pre"
							}
						>
							<div
								className={
									"grid grid-cols-[40px_14px_minmax(0,1fr)] pr-3 " +
									(left?.kind === "del" ? "bg-red-tint text-ink-2" : "text-ink-2")
								}
							>
								<span className="select-none pr-1.5 text-right text-[11px] text-ink-3 opacity-60 tabular-nums">
									{left?.oldLineNumber ?? ""}
								</span>
								<span className={left?.kind === "del" ? "select-none text-red" : "select-none"}>
									{left?.kind === "del" ? "−" : ""}
								</span>
								<span className={wrap ? "min-w-0 break-all" : undefined}>{left ? renderTokens(left.tokens, false) : ""}</span>
							</div>
							<div className="bg-line" />
							<div
								className={
									"grid grid-cols-[40px_14px_minmax(0,1fr)] pr-3 " +
									(right?.kind === "add" ? "bg-green-tint text-ink" : "text-ink-2")
								}
							>
								<span className="select-none pr-1.5 text-right text-[11px] text-ink-3 opacity-60 tabular-nums">
									{right?.newLineNumber ?? ""}
								</span>
								<span className={right?.kind === "add" ? "select-none text-green" : "select-none"}>
									{right?.kind === "add" ? "+" : ""}
								</span>
								<span className={wrap ? "min-w-0 break-all" : undefined}>{right ? renderTokens(right.tokens, right.kind === "add") : ""}</span>
							</div>
						</div>
					);
				})}
			</div>
		);

	// Same cap as CodeBlock (§6.10): 480px with internal scroll, then a bottom "展开" button.
	const rowCount = parsed.lines.length;
	const canExpand = !bodyExpanded && rowCount > DIFF_COLLAPSE_LINES;
	const diffBody = (
		<>
			<div
				data-testid="diff-body"
				className="scroll min-w-0 bg-inset mono text-[12px] leading-[1.7] text-ink-2 overflow-auto"
				style={{ maxHeight: bodyExpanded ? undefined : DIFF_MAX_HEIGHT }}
			>
				{diffRows}
			</div>
			{canExpand && (
				<div className="flex justify-center border-t border-line bg-surface py-1">
					<button
						type="button"
						onClick={() => setBodyExpanded(true)}
						className="shrink-0 whitespace-nowrap rounded-control px-2.5 py-0.5 text-[11.5px] font-medium text-ink-2 transition-colors hover:bg-hover hover:text-ink"
					>
						展开（共 {rowCount} 行）
					</button>
				</div>
			)}
		</>
	);

	if (!showHeader) {
		return <div className={"min-w-0 overflow-hidden rounded-control shadow-hairline " + (className ?? "")}>{diffBody}</div>;
	}

	return (
		<Card className={className}>
			<CardBar>
				<span className="flex min-w-0 flex-1 items-center gap-2 mono text-[12px] font-medium">
					<Icon icon={FileText} preset="inline" className="shrink-0 text-ink-3" />
					<span className="min-w-0 truncate">
						{dirPart && <span className="text-ink-2">{dirPart}</span>}
						<span className="text-ink">{basePart}</span>
					</span>
					{(additions > 0 || deletions > 0) && (
						<span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap tabular-nums">
							{additions > 0 && <span className="text-green-ink">+{additions}</span>}
							{deletions > 0 && <span className="text-red-ink">−{deletions}</span>}
						</span>
					)}
				</span>
				<span className="flex shrink-0 items-center gap-1.5 whitespace-nowrap">
					<span className="inline-flex h-6 shrink-0 items-center rounded-chip bg-field p-0.5 shadow-hairline text-[11.5px]">
						<button
							type="button"
							onClick={() => setMode("unified")}
							aria-pressed={mode === "unified"}
							className={
								"h-5 shrink-0 whitespace-nowrap rounded-[4px] px-1.5 transition-colors " +
								(mode === "unified" ? "bg-surface font-medium text-ink shadow-xs" : "text-ink-2 hover:text-ink")
							}
						>
							合并
						</button>
						<button
							type="button"
							onClick={() => setMode("split")}
							aria-pressed={mode === "split"}
							className={
								"h-5 shrink-0 whitespace-nowrap rounded-[4px] px-1.5 transition-colors " +
								(mode === "split" ? "bg-surface font-medium text-ink shadow-xs" : "text-ink-2 hover:text-ink")
							}
						>
							并排
						</button>
					</span>
					{controlledWrap === undefined && (
						<button
							type="button"
							onClick={() => setInternalWrap(w => !w)}
							aria-pressed={wrap}
							title="切换自动换行"
							className={
								"inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-control px-1.5 text-[11.5px] font-medium transition-colors " +
								(wrap ? "bg-field text-ink" : "text-ink-2 hover:bg-hover hover:text-ink")
							}
						>
							<WrapText size={11} strokeWidth={2} className="i" />
							<span>换行</span>
						</button>
					)}
					<button
						type="button"
						onClick={handleCopy}
						aria-label="复制改动后内容"
						className={
							"inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-control px-1.5 text-[11.5px] font-medium transition-colors hover:bg-hover active:scale-96 " +
							(copied ? "text-green-ink" : "text-ink-2 hover:text-ink")
						}
					>
						<span className="relative inline-grid size-3 shrink-0 place-items-center">
							<Copy
								size={11}
								strokeWidth={2}
								className={
									"col-start-1 row-start-1 transition-[opacity,transform] duration-150 " +
									(copied ? "scale-80 opacity-0" : "scale-100 opacity-100")
								}
							/>
							<Check
								size={11}
								strokeWidth={2.6}
								className={
									"col-start-1 row-start-1 text-green transition-[opacity,transform] duration-150 " +
									(copied ? "scale-100 opacity-100" : "scale-80 opacity-0")
								}
							/>
						</span>
						<span>{copied ? "已复制" : "复制"}</span>
					</button>
				</span>
			</CardBar>
			{diffBody}
		</Card>
	);
}
