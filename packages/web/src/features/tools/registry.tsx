/**
 * Tool renderer registry (DESIGN §8, FRONTEND §6.6).
 * Every renderer validates shapes defensively and is wrapped in an ErrorBoundary
 * so unexpected tool arguments or results gracefully fall back to GenericToolView.
 */
import type { ImageContent, ToolCall, ToolResultMessage } from "@omp-ui/protocol";
import { ChevronDown, ExternalLink, type LucideIcon } from "lucide-react";
import { Component, useEffect, useRef, useState, type ErrorInfo, type ReactNode } from "react";
import type { SubagentView, ToolExec } from "../../store/session-reducer";
import { Pill } from "../../ui/Chip";
import { Dialog, DialogContent } from "../../ui/Dialog";
import { toolIcon } from "../../ui/Icon";
import { CodeBlock } from "./CodeBlock";
import { computeDiffFromOldNew, DiffView, extractDiffSource, parseUnifiedDiffText } from "./DiffView";
import {
	buildSubagentTree,
	flattenSubagentTree,
	type SubagentTreeNode,
} from "../subagents/subagent-utils";
import { SubagentCapsule } from "./SubagentCapsule";

export interface ToolRenderProps {
	callId: string;
	toolName: string;
	args: unknown;
	result?: ToolResultMessage;
	exec?: ToolExec;
	subagents?: Map<string, SubagentView>;
	sessionId?: string;
}

export interface ToolRowSummary {
	verb: string;
	chipText: string;
	monoChip: boolean;
	additions?: number;
	deletions?: number;
	durationText?: string;
	exitCode?: number;
}

export interface ToolRenderer {
	match(name: string): boolean;
	icon: LucideIcon;
	summary(args: unknown, result?: ToolResultMessage, exec?: ToolExec): ToolRowSummary;
	body(props: ToolRenderProps): ReactNode;
	defaultOpen?: boolean;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Drop a trailing `:line` / `:start-end` selector; keeps Windows drive letters (`C:\…`). */
export function stripLineSelector(rawPath: string): string {
	return rawPath.replace(/:\d+(?:[-+]\d+)?$/, "");
}

export function extractResultText(result?: ToolResultMessage, exec?: ToolExec): string {
	if (result && Array.isArray(result.content)) {
		const texts: string[] = [];
		for (const item of result.content) {
			if (isPlainRecord(item) && item.type === "text" && typeof item.text === "string") {
				texts.push(item.text);
			}
		}
		if (texts.length > 0) return texts.join("\n");
	}
	if (result && isPlainRecord(result.details) && typeof result.details.output === "string") {
		return result.details.output;
	}
	if (exec) {
		if (isPlainRecord(exec.result) && typeof exec.result.output === "string") {
			return exec.result.output;
		}
		if (typeof exec.result === "string") return exec.result;
		if (exec.streamLog) return exec.streamLog;
	}
	return "";
}

export function extractResultImages(result?: ToolResultMessage, exec?: ToolExec): ImageContent[] {
	const out: ImageContent[] = [];
	if (result && Array.isArray(result.content)) {
		for (const item of result.content) {
			if (isPlainRecord(item) && item.type === "image" && typeof item.data === "string" && typeof item.mimeType === "string") {
				out.push({ type: "image", data: item.data, mimeType: item.mimeType });
			}
		}
	}
	if (result && isPlainRecord(result.details) && Array.isArray(result.details.images)) {
		for (const item of result.details.images) {
			if (isPlainRecord(item) && typeof item.data === "string" && typeof item.mimeType === "string") {
				out.push({ type: "image", data: item.data, mimeType: item.mimeType });
			}
		}
	}
	if (exec && isPlainRecord(exec.result) && Array.isArray(exec.result.images)) {
		for (const item of exec.result.images) {
			if (isPlainRecord(item) && typeof item.data === "string" && typeof item.mimeType === "string") {
				out.push({ type: "image", data: item.data, mimeType: item.mimeType });
			}
		}
	}
	return out;
}

export function formatDuration(exec?: ToolExec, result?: ToolResultMessage): string | undefined {
	if (exec?.startedAt && exec?.endedAt && exec.endedAt >= exec.startedAt) {
		const sec = (exec.endedAt - exec.startedAt) / 1000;
		return sec < 60 ? `${sec.toFixed(1)}s` : `${Math.floor(sec / 60)}m ${(sec % 60).toFixed(0)}s`;
	}
	if (result && isPlainRecord(result.details)) {
		const durMs = result.details.durationMs ?? result.details.duration;
		if (typeof durMs === "number" && durMs >= 0) {
			const sec = durMs / 1000;
			return sec < 60 ? `${sec.toFixed(1)}s` : `${Math.floor(sec / 60)}m ${(sec % 60).toFixed(0)}s`;
		}
	}
	return undefined;
}

// ── Generic Fallback View (§6.6, §8) ─────────────────────────────────

function JsonValueCell({ value }: { value: unknown }) {
	const [open, setOpen] = useState(false);
	if (value === null || value === undefined) {
		return <span className="text-ink-3">null</span>;
	}
	if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
		const str = String(value);
		if (str.length <= 160 && !str.includes("\n")) {
			return <span className="text-ink break-all">{str}</span>;
		}
		return (
			<div>
				<button
					type="button"
					onClick={() => setOpen(o => !o)}
					className="inline-flex items-center gap-1 text-[11px] text-ink-2 hover:text-ink"
				>
					<ChevronDown size={11} className={"i transition-transform " + (open ? "" : "-rotate-90")} />
					<span>{open ? "收起文本" : `${str.slice(0, 80)}…`}</span>
				</button>
				{open && <pre className="mt-1 whitespace-pre-wrap break-words text-ink">{str}</pre>}
			</div>
		);
	}
	let formatted = "";
	try {
		formatted = JSON.stringify(value, null, 2);
	} catch {
		formatted = String(value);
	}
	const preview = Array.isArray(value) ? `Array(${value.length})` : "Object";
	return (
		<div>
			<button
				type="button"
				onClick={() => setOpen(o => !o)}
				className="inline-flex items-center gap-1 text-[11.5px] text-ink-2 hover:text-ink"
			>
				<ChevronDown size={11} className={"i transition-transform " + (open ? "" : "-rotate-90")} />
				<span>{preview}</span>
			</button>
			{open && <pre className="mt-1 whitespace-pre-wrap break-words text-ink">{formatted}</pre>}
		</div>
	);
}

export function GenericToolView({ args, result, exec }: ToolRenderProps) {
	const entries: Array<[string, unknown]> = isPlainRecord(args)
		? Object.entries(args)
		: args !== undefined && args !== null
			? [["value", args]]
			: [];
	const text = extractResultText(result, exec);

	return (
		<div className="flex flex-col gap-2 rounded-control bg-inset p-2.5 shadow-hairline mono text-[11.5px] leading-[1.6]">
			{entries.length > 0 && (
				<div className="flex flex-col gap-1">
					{entries.map(([k, v]) => (
						<div key={k} className="grid grid-cols-[minmax(80px,auto)_1fr] gap-2.5">
							<span className="text-ink-2">{k}</span>
							<JsonValueCell value={v} />
						</div>
					))}
				</div>
			)}
			{text && (
				<div className={(entries.length > 0 ? "border-t border-line pt-2 " : "") + "whitespace-pre-wrap break-words text-ink-2"}>
					{text}
				</div>
			)}
			{entries.length === 0 && !text && <span className="text-ink-3">无输出</span>}
		</div>
	);
}

// ── Error Boundary ───────────────────────────────────────────────────

interface BoundaryProps {
	fallbackProps: ToolRenderProps;
	children: ReactNode;
}

interface BoundaryState {
	hasError: boolean;
}

class ToolErrorBoundary extends Component<BoundaryProps, BoundaryState> {
	override state: BoundaryState = { hasError: false };

	static getDerivedStateFromError(): BoundaryState {
		return { hasError: true };
	}

	override componentDidCatch(_error: Error, _info: ErrorInfo): void {
		// Swallow renderer error and fall back to GenericToolView per DESIGN §8
	}

	override render(): ReactNode {
		if (this.state.hasError) {
			return <GenericToolView {...this.props.fallbackProps} />;
		}
		return this.props.children;
	}
}

// ── Bash Renderer (§6.6) ─────────────────────────────────────────────

const BASH_FOLD_LINES = 500;
const MAX_INLINE_BYTES = 200 * 1024;

function BashToolView(props: ToolRenderProps) {
	const { args, result, exec } = props;
	const [showAllLines, setShowAllLines] = useState(false);
	const scrollRef = useRef<HTMLDivElement | null>(null);

	if (!isPlainRecord(args) || typeof args.command !== "string") {
		return <GenericToolView {...props} />;
	}

	const command = args.command;
	const rawOutput =
		exec?.status === "running" && exec.streamLog.length > 0
			? exec.streamLog
			: extractResultText(result, exec) || exec?.streamLog || "";

	const isTruncatedBytes = rawOutput.length > MAX_INLINE_BYTES;
	const displayOutput = isTruncatedBytes ? rawOutput.slice(0, MAX_INLINE_BYTES) : rawOutput;
	const allLines = displayOutput.length > 0 ? displayOutput.split("\n") : [];
	const folded = !showAllLines && allLines.length > BASH_FOLD_LINES;
	const visibleLines = folded ? allLines.slice(0, BASH_FOLD_LINES) : allLines;

	let exitCode: number | undefined;
	if (result && isPlainRecord(result.details) && typeof result.details.exitCode === "number") {
		exitCode = result.details.exitCode;
	} else if (exec && isPlainRecord(exec.result) && typeof exec.result.exitCode === "number") {
		exitCode = exec.result.exitCode;
	} else if (result && !result.isError && exec?.status !== "running") {
		exitCode = 0;
	} else if (result?.isError) {
		exitCode = 1;
	}

	const isRunning = exec?.status === "running";
	useEffect(() => {
		if (isRunning && scrollRef.current) {
			scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
		}
	}, [isRunning, rawOutput]);

	const handleOpenFullOutput = () => {
		if (typeof window === "undefined") return;
		const blob = new Blob([rawOutput], { type: "text/plain;charset=utf-8" });
		const url = URL.createObjectURL(blob);
		window.open(url, "_blank", "noopener,noreferrer");
	};

	return (
		<div
			ref={scrollRef}
			className="relative max-h-[320px] overflow-auto rounded-control bg-inset px-2.5 py-2 shadow-hairline mono text-[11.5px] leading-[1.6] text-ink-2 whitespace-pre"
		>
			{exitCode !== undefined && !isRunning && (
				<Pill
					tone={exitCode === 0 ? "green" : "red"}
					className="absolute top-1.5 right-1.5 h-5 font-sans"
				>
					exit {exitCode}
				</Pill>
			)}
			<div className="text-ink">$ {command}</div>
			{visibleLines.length > 0 && <div>{visibleLines.join("\n")}</div>}
			{folded && (
				<div className="mt-1.5 border-t border-line pt-1.5 font-sans">
					<button
						type="button"
						onClick={() => setShowAllLines(true)}
						className="rounded-control px-2 py-0.5 text-[11.5px] font-medium text-accent-ink hover:bg-hover"
					>
						显示全部 {allLines.length.toLocaleString("en-US")} 行
					</button>
				</div>
			)}
			{isTruncatedBytes && (
				<div className="mt-1.5 border-t border-line pt-1.5 font-sans">
					<button
						type="button"
						onClick={handleOpenFullOutput}
						className="inline-flex items-center gap-1 text-[11.5px] font-medium text-accent-ink hover:underline"
					>
						<span>输出已截断（超过 200KB），在新标签打开全文</span>
						<ExternalLink size={11} className="i" />
					</button>
				</div>
			)}
		</div>
	);
}

// ── Python Renderer (§8) ─────────────────────────────────────────────

function PythonToolView(props: ToolRenderProps) {
	const { args, result, exec } = props;
	if (!isPlainRecord(args) || typeof args.code !== "string") {
		return <GenericToolView {...props} />;
	}
	const output = extractResultText(result, exec);
	return (
		<div className="flex flex-col gap-2">
			<CodeBlock code={args.code} language="python" showHeader={false} maxHeight={220} />
			{output && (
				<div className="max-h-[240px] overflow-auto rounded-control bg-inset px-2.5 py-2 shadow-hairline mono text-[11.5px] leading-[1.6] text-ink-2 whitespace-pre">
					{output}
				</div>
			)}
		</div>
	);
}

// ── Read Renderer (§6.6) ─────────────────────────────────────────────

function stripHashlinePrefixes(raw: string): string {
	const lines = raw.split("\n");
	// Strip optional [path#TAG] header line
	let start = 0;
	if (lines[0] && /^\[[^\]#]+#[0-9A-Fa-f]{4}\]$/.test(lines[0].trim())) {
		start = 1;
	}
	const body = lines.slice(start);
	const stripped = body.map(l => {
		const m = /^\s*\d+[:|](.*)$/.exec(l);
		return m ? m[1]! : l;
	});
	return stripped.join("\n");
}

function ReadToolView(props: ToolRenderProps) {
	const { args, result, exec } = props;
	if (!isPlainRecord(args) || typeof args.path !== "string") {
		return <GenericToolView {...props} />;
	}
	const rawPath = args.path;
	const rawContent = extractResultText(result, exec);
	const code = rawContent ? stripHashlinePrefixes(rawContent) : "";

	return (
		<div className="flex flex-col gap-1.5">
			<div className="mono text-[11.5px] text-ink-2">{rawPath}</div>
			{code ? (
				<CodeBlock code={code} filename={stripLineSelector(rawPath)} showHeader={false} maxHeight={240} />
			) : (
				<div className="rounded-control bg-inset px-2.5 py-2 shadow-hairline mono text-[11.5px] text-ink-3">
					（已读取 {rawPath}）
				</div>
			)}
		</div>
	);
}

// ── Edit / Write / Notebook Renderer (§6.6, §6.9) ────────────────────

function EditWriteToolView(props: ToolRenderProps) {
	const { args, result, exec } = props;
	if (!isPlainRecord(args)) {
		return <GenericToolView {...props} />;
	}
	const rawText = extractResultText(result, exec);
	const src = extractDiffSource(args, result?.details, rawText);
	if (src.perFileResults && src.perFileResults.length > 1) {
		return (
			<div className="flex flex-col gap-2">
				{src.perFileResults.map((fileItem, idx) => (
					<DiffView
						key={fileItem.filePath ?? idx}
						filePath={fileItem.filePath}
						diff={fileItem.diff}
						oldText={fileItem.oldText}
						newText={fileItem.newText}
						rawText={fileItem.rawText}
						additions={fileItem.additions}
						deletions={fileItem.deletions}
					/>
				))}
			</div>
		);
	}
	if (!src.filePath && !src.diff && src.oldText === undefined && src.newText === undefined && !src.rawText) {
		return <GenericToolView {...props} />;
	}
	return (
		<DiffView
			filePath={src.filePath}
			diff={src.diff}
			oldText={src.oldText}
			newText={src.newText}
			rawText={src.rawText}
			additions={src.additions}
			deletions={src.deletions}
		/>
	);
}

// ── Search Renderer: grep / glob / find (§6.6) ───────────────────────

const MAX_SEARCH_ROWS = 20;

function highlightSubstring(text: string, query?: string): ReactNode {
	if (!query || query.length === 0) return text;
	const idx = text.toLowerCase().indexOf(query.toLowerCase());
	if (idx < 0) return text;
	const before = text.slice(0, idx);
	const match = text.slice(idx, idx + query.length);
	const after = text.slice(idx + query.length);
	return (
		<>
			{before}
			<span className="rounded-[3px] bg-accent-tint px-0.5 text-accent-on-tint">{match}</span>
			{after}
		</>
	);
}

function SearchToolView(props: ToolRenderProps) {
	const { args, result, exec } = props;
	const [expanded, setExpanded] = useState(false);

	if (!isPlainRecord(args)) {
		return <GenericToolView {...props} />;
	}

	const pattern =
		typeof args.pattern === "string"
			? args.pattern
			: typeof args.query === "string"
				? args.query
				: typeof args.path === "string"
					? args.path
					: "";

	const text = extractResultText(result, exec);
	const rawLines = text
		.split("\n")
		.map(l => l.trim())
		.filter(l => l.length > 0 && !l.startsWith("[Showing "));

	if (rawLines.length === 0) {
		return (
			<div className="rounded-control bg-inset px-2.5 py-1.5 shadow-hairline mono text-[11.5px] text-ink-3">
				无匹配结果
			</div>
		);
	}

	const visible = expanded ? rawLines : rawLines.slice(0, MAX_SEARCH_ROWS);
	const remaining = rawLines.length - visible.length;

	return (
		<div className="rounded-control bg-inset px-2.5 py-1.5 shadow-hairline mono text-[11.5px]">
			{visible.map((line, i) => {
				const colonIdx = line.indexOf(":");
				const spaceIdx = line.indexOf(" ");
				const splitAt = colonIdx > 0 && (spaceIdx < 0 || colonIdx < spaceIdx) ? colonIdx : spaceIdx;
				const pathPart = splitAt > 0 ? line.slice(0, splitAt) : line;
				const restPart = splitAt > 0 ? line.slice(splitAt + 1).trim() : "";
				return (
					<div key={i} className="flex h-6 items-center gap-2 truncate">
						<span className="shrink-0 text-ink">{pathPart}</span>
						{restPart && <span className="truncate text-ink-2">{highlightSubstring(restPart, pattern)}</span>}
					</div>
				);
			})}
			{remaining > 0 && (
				<button
					type="button"
					onClick={() => setExpanded(true)}
					className="flex h-6 items-center text-[11.5px] font-sans font-medium text-accent-ink hover:underline"
				>
					+{remaining}
				</button>
			)}
		</div>
	);
}

// ── Web Search Renderer (§6.6) ───────────────────────────────────────

interface WebSourceItem {
	title: string;
	url: string;
	domain: string;
}

const DOT_COLORS = ["var(--accent)", "var(--green)", "var(--orange)", "var(--ink-2)"];

function extractWebSources(result?: ToolResultMessage, rawText?: string): WebSourceItem[] {
	const items: WebSourceItem[] = [];
	if (result && isPlainRecord(result.details) && Array.isArray(result.details.results)) {
		for (const r of result.details.results) {
			if (isPlainRecord(r) && typeof r.url === "string") {
				let domain = r.url;
				try {
					domain = new URL(r.url).hostname.replace(/^www\./, "");
				} catch {
					/* keep raw */
				}
				items.push({
					title: typeof r.title === "string" && r.title.length > 0 ? r.title : domain,
					url: r.url,
					domain,
				});
			}
		}
	}
	if (items.length > 0) return items;

	// Parse markdown links `[title](https://...)` from text
	if (rawText) {
		const linkRegex = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
		let m: RegExpExecArray | null;
		while ((m = linkRegex.exec(rawText)) !== null) {
			const title = m[1]!;
			const url = m[2]!;
			let domain = url;
			try {
				domain = new URL(url).hostname.replace(/^www\./, "");
			} catch {
				/* ignore */
			}
			items.push({ title, url, domain });
		}
	}
	return items;
}

function WebSearchToolView(props: ToolRenderProps) {
	const { args, result, exec } = props;
	if (!isPlainRecord(args)) {
		return <GenericToolView {...props} />;
	}
	const rawText = extractResultText(result, exec);
	const sources = extractWebSources(result, rawText);
	if (sources.length === 0) {
		return <GenericToolView {...props} />;
	}

	return (
		<div className="flex flex-col gap-1 rounded-control bg-inset p-2 shadow-hairline">
			{sources.map((src, idx) => (
				<a
					key={idx}
					href={src.url}
					target="_blank"
					rel="noopener noreferrer"
					className="flex items-center gap-2 rounded-chip px-1.5 py-1 transition-colors hover:bg-hover"
				>
					<span
						className="size-3.5 shrink-0 rounded-full"
						style={{ background: DOT_COLORS[idx % DOT_COLORS.length] }}
					/>
					<span className="truncate text-[12.5px] font-medium text-ink hover:underline">{src.title}</span>
					<span className="mono ml-auto shrink-0 text-[11.5px] text-ink-2">{src.domain}</span>
				</a>
			))}
		</div>
	);
}

// ── Browser Renderer (§6.6) ──────────────────────────────────────────

function BrowserToolView(props: ToolRenderProps) {
	const { args, result, exec } = props;
	const [previewImage, setPreviewImage] = useState<ImageContent | null>(null);
	if (!isPlainRecord(args)) {
		return <GenericToolView {...props} />;
	}
	const images = extractResultImages(result, exec);
	const text = extractResultText(result, exec);
	const actionDesc =
		typeof args.action === "string"
			? `${args.action}${typeof args.url === "string" ? ` · ${args.url}` : ""}`
			: text;

	return (
		<div className="flex flex-col gap-2">
			{images.map((img, i) => {
				const src = `data:${img.mimeType};base64,${img.data}`;
				return (
					<button
						key={i}
						type="button"
						onClick={() => setPreviewImage(img)}
						className="w-fit overflow-hidden rounded-control shadow-hairline"
					>
						<img src={src} alt="浏览器截图" className="max-h-[280px] max-w-full rounded-control object-contain" />
					</button>
				);
			})}
			{(text || actionDesc) && (
				<div className="rounded-control bg-inset px-2.5 py-1.5 shadow-hairline mono text-[11.5px] text-ink-2 whitespace-pre-wrap">
					{text || actionDesc}
				</div>
			)}
			<Dialog open={previewImage !== null} onOpenChange={open => !open && setPreviewImage(null)}>
				<DialogContent title="浏览器截图" width={640}>
					{previewImage && (
						<img
							src={`data:${previewImage.mimeType};base64,${previewImage.data}`}
							alt="浏览器截图预览"
							className="mt-2 max-h-[75vh] w-full rounded-control object-contain"
						/>
					)}
				</DialogContent>
			</Dialog>
		</div>
	);
}

// ── Task (Subagents) Renderer (§6.6, §6.13, §10.2) ───────────────────

function TaskToolView(props: ToolRenderProps) {
	const { callId, args, result, exec, subagents, sessionId } = props;
	if (!isPlainRecord(args)) {
		return <GenericToolView {...props} />;
	}

	// Direct children of this task call, each carrying its nested subagent subtree
	// (omp ids are dotted: "Anna.Bob" was spawned by Anna's own task call).
	const matchedNodes: SubagentTreeNode[] = subagents
		? flattenSubagentTree(buildSubagentTree(subagents.values())).filter(
				n => n.subagent.parentToolCallId === callId,
			)
		: [];
	const matched: SubagentView[] = matchedNodes.map(n => n.subagent);
	const childrenById = new Map(matchedNodes.map(n => [n.subagent.id, n.children]));

	// If no live subagents matched by parentToolCallId, synthesize capsules from args.tasks
	if (matched.length === 0 && Array.isArray(args.tasks)) {
		args.tasks.forEach((t, idx) => {
			if (isPlainRecord(t)) {
				const name = typeof t.name === "string" ? t.name : typeof t.agent === "string" ? t.agent : `task-${idx + 1}`;
				const desc = typeof t.task === "string" ? t.task.split("\n")[0] : typeof t.solutionSpace === "string" ? t.solutionSpace : "";
				const status =
					result?.isError || exec?.status === "error"
						? "failed"
						: result || exec?.status === "done"
							? "completed"
							: "running";
				matched.push({
					id: `${callId}-${idx}`,
					index: idx + 1,
					agent: name,
					agentSource: "bundled",
					description: desc,
					status,
					parentToolCallId: callId,
					lastUpdate: Date.now(),
				});
			}
		});
	}

	if (matched.length === 0) {
		return <GenericToolView {...props} />;
	}

	return (
		<div className="flex flex-col gap-2 py-0.5">
			{matched.map(sub => (
				<SubagentCapsule
					key={sub.id}
					subagent={sub}
					sessionId={sessionId}
					childNodes={childrenById.get(sub.id)}
				/>
			))}
		</div>
	);
}

// ── Todo Renderer (§6.6) ─────────────────────────────────────────────

function summarizeTodos(args: unknown, result?: ToolResultMessage): string {
	const source = isPlainRecord(result?.details) ? result.details : isPlainRecord(args) ? args : {};
	const phases = Array.isArray(source.todoPhases)
		? source.todoPhases
		: Array.isArray(source.phases)
			? source.phases
			: [];
	let completed = 0;
	let inProgress = 0;
	let pending = 0;
	for (const p of phases) {
		if (isPlainRecord(p) && Array.isArray(p.tasks)) {
			for (const t of p.tasks) {
				if (isPlainRecord(t)) {
					if (t.status === "completed") completed++;
					else if (t.status === "in_progress") inProgress++;
					else if (t.status === "pending") pending++;
				}
			}
		}
	}
	const parts: string[] = [];
	if (completed > 0) parts.push(`完成 ${completed} 项`);
	if (inProgress > 0) parts.push(`进行中 ${inProgress} 项`);
	if (pending > 0) parts.push(`待办 ${pending} 项`);
	return parts.length > 0 ? parts.join(" · ") : "已更新待办列表";
}

function TodoToolView(props: ToolRenderProps) {
	const { args, result, sessionId } = props;
	if (!isPlainRecord(args)) {
		return <GenericToolView {...props} />;
	}
	const summary = summarizeTodos(args, result);
	const handleOpenTodos = () => {
		if (typeof window === "undefined") return;
		const detail = { tab: "todos", sessionId };
		window.dispatchEvent(new CustomEvent("open-panel", { detail, bubbles: true }));
		window.dispatchEvent(new CustomEvent("open-panel-tab", { detail, bubbles: true }));
	};

	return (
		<div className="flex items-center justify-between rounded-control bg-inset px-3 py-1.5 shadow-hairline text-[12px] text-ink-2">
			<span>{summary}</span>
			<button
				type="button"
				onClick={handleOpenTodos}
				className="font-medium text-accent-ink hover:underline"
			>
				在面板中查看
			</button>
		</div>
	);
}

// ── Registry & Summary Helpers ───────────────────────────────────────

function computeEditDiffCounts(args: unknown, result?: ToolResultMessage): { additions?: number; deletions?: number } {
	const src = extractDiffSource(args, result?.details);
	if (src.perFileResults && src.perFileResults.length > 0) {
		let additions = 0;
		let deletions = 0;
		for (const item of src.perFileResults) {
			if (item.additions !== undefined || item.deletions !== undefined) {
				additions += item.additions ?? 0;
				deletions += item.deletions ?? 0;
			} else if (item.oldText !== undefined || item.newText !== undefined) {
				const p = computeDiffFromOldNew(item.oldText ?? "", item.newText ?? "");
				additions += p.additions;
				deletions += p.deletions;
			} else if (item.diff) {
				const p = parseUnifiedDiffText(item.diff);
				additions += p.additions;
				deletions += p.deletions;
			}
		}
		return { additions, deletions };
	}
	if (src.additions !== undefined || src.deletions !== undefined) {
		return { additions: src.additions, deletions: src.deletions };
	}
	if (src.oldText !== undefined || src.newText !== undefined) {
		const parsed = computeDiffFromOldNew(src.oldText ?? "", src.newText ?? "");
		return { additions: parsed.additions, deletions: parsed.deletions };
	}
	if (src.diff) {
		const parsed = parseUnifiedDiffText(src.diff);
		return { additions: parsed.additions, deletions: parsed.deletions };
	}
	return {};
}

export const TOOL_RENDERERS: ToolRenderer[] = [
	{
		match: name => name === "bash",
		icon: toolIcon("bash"),
		summary(args, result, exec) {
			const cmd = isPlainRecord(args) && typeof args.command === "string" ? args.command : "";
			return {
				verb: "运行",
				chipText: cmd || (exec?.intent ?? "bash"),
				monoChip: true,
				durationText: formatDuration(exec, result),
			};
		},
		body: props => <BashToolView {...props} />,
	},
	{
		match: name => name === "python" || name === "eval",
		icon: toolIcon("python"),
		summary(args, result, exec) {
			const firstLine =
				isPlainRecord(args) && typeof args.code === "string" ? (args.code.split("\n")[0] ?? "") : "";
			return {
				verb: "运行 Python",
				chipText: firstLine || (exec?.intent ?? "python"),
				monoChip: true,
				durationText: formatDuration(exec, result),
			};
		},
		body: props => <PythonToolView {...props} />,
	},
	{
		match: name => name === "read",
		icon: toolIcon("read"),
		summary(args, result, exec) {
			const path = isPlainRecord(args) && typeof args.path === "string" ? args.path : "";
			return {
				verb: "读取",
				chipText: path || (exec?.intent ?? "read"),
				monoChip: true,
				durationText: formatDuration(exec, result),
			};
		},
		body: props => <ReadToolView {...props} />,
	},
	{
		match: name => name === "write",
		icon: toolIcon("write"),
		summary(args, result, exec) {
			const src = extractDiffSource(args, result?.details);
			const counts = computeEditDiffCounts(args, result);
			return {
				verb: "新建",
				chipText: src.filePath ?? (exec?.intent ?? "write"),
				monoChip: true,
				additions: counts.additions,
				deletions: counts.deletions,
				durationText: formatDuration(exec, result),
			};
		},
		body: props => <EditWriteToolView {...props} />,
	},
	{
		match: name => name === "edit" || name === "notebook",
		icon: toolIcon("edit"),
		summary(args, result, exec) {
			const src = extractDiffSource(args, result?.details);
			const counts = computeEditDiffCounts(args, result);
			return {
				verb: "编辑",
				chipText: src.filePath ?? (exec?.intent ?? "edit"),
				monoChip: true,
				additions: counts.additions,
				deletions: counts.deletions,
				durationText: formatDuration(exec, result),
			};
		},
		body: props => <EditWriteToolView {...props} />,
	},
	{
		match: name => name === "grep" || name === "glob" || name === "find",
		icon: toolIcon("grep"),
		summary(args, result, exec) {
			const a = isPlainRecord(args) ? args : {};
			const label =
				typeof a.pattern === "string"
					? a.pattern
					: typeof a.query === "string"
						? a.query
						: typeof a.path === "string"
							? a.path
							: "";
			return {
				verb: "搜索",
				chipText: label || (exec?.intent ?? "search"),
				monoChip: true,
				durationText: formatDuration(exec, result),
			};
		},
		body: props => <SearchToolView {...props} />,
	},
	{
		match: name => name === "web_search",
		icon: toolIcon("web_search"),
		summary(args, result, exec) {
			const q = isPlainRecord(args) && typeof args.query === "string" ? args.query : "";
			return {
				verb: "搜索网页",
				chipText: q || (exec?.intent ?? "web_search"),
				monoChip: false,
				durationText: formatDuration(exec, result),
			};
		},
		body: props => <WebSearchToolView {...props} />,
	},
	{
		match: name => name === "browser",
		icon: toolIcon("browser"),
		summary(args, result, exec) {
			const a = isPlainRecord(args) ? args : {};
			const act = typeof a.action === "string" ? a.action : typeof a.url === "string" ? a.url : "";
			return {
				verb: "浏览器",
				chipText: act || (exec?.intent ?? "browser"),
				monoChip: false,
				durationText: formatDuration(exec, result),
			};
		},
		body: props => <BrowserToolView {...props} />,
	},
	{
		match: name => name === "task",
		icon: toolIcon("task"),
		summary(args, result, exec) {
			const a = isPlainRecord(args) ? args : {};
			let agentName = "";
			let desc = typeof a.context === "string" ? (a.context.split("\n")[0] ?? "") : "";
			if (Array.isArray(a.tasks) && a.tasks.length > 0 && isPlainRecord(a.tasks[0])) {
				const first = a.tasks[0];
				if (typeof first.name === "string") agentName = first.name;
				else if (typeof first.agent === "string") agentName = first.agent;
				if (!desc && typeof first.solutionSpace === "string") desc = first.solutionSpace;
			}
			return {
				verb: agentName ? `子代理 ${agentName}` : "子代理",
				chipText: desc || (exec?.intent ?? "运行子代理任务"),
				monoChip: false,
				durationText: formatDuration(exec, result),
			};
		},
		body: props => <TaskToolView {...props} />,
		defaultOpen: true,
	},
	{
		match: name => name === "todo" || name === "set_todos",
		icon: toolIcon("todo"),
		summary(args, result, exec) {
			return {
				verb: "更新待办",
				chipText: summarizeTodos(args, result),
				monoChip: false,
				durationText: formatDuration(exec, result),
			};
		},
		body: props => <TodoToolView {...props} />,
	},
];

const FALLBACK_RENDERER: ToolRenderer = {
	match: () => true,
	icon: toolIcon("other"),
	summary(args, result, exec) {
		const a = isPlainRecord(args) ? args : {};
		const preview =
			typeof a.i === "string"
				? a.i
				: typeof a.path === "string"
					? a.path
					: typeof a.command === "string"
						? a.command
						: exec?.intent ?? "";
		return {
			verb: "调用",
			chipText: preview,
			monoChip: true,
			durationText: formatDuration(exec, result),
		};
	},
	body: props => <GenericToolView {...props} />,
};

export function resolveToolRenderer(toolName: string): ToolRenderer {
	for (const r of TOOL_RENDERERS) {
		if (r.match(toolName)) return r;
	}
	if (toolName.startsWith("mcp__") || toolName.startsWith("mcp:")) {
		const parts = toolName.replace(/^mcp(__|:)/, "").split(/__|:/);
		const formatted = parts.length >= 2 ? `${parts[0]} › ${parts.slice(1).join(":")}` : toolName;
		return {
			match: () => true,
			icon: toolIcon("mcp"),
			summary(_args, result, exec) {
				return {
					verb: "MCP",
					chipText: formatted,
					monoChip: true,
					durationText: formatDuration(exec, result),
				};
			},
			body: props => <GenericToolView {...props} />,
		};
	}
	return {
		...FALLBACK_RENDERER,
		icon: toolIcon(toolName),
		summary(args, result, exec) {
			const base = FALLBACK_RENDERER.summary(args, result, exec);
			return {
				...base,
				verb: toolName || "工具",
				chipText: base.chipText || toolName,
			};
		},
	};
}

export function getToolRowSummary(call: ToolCall, result?: ToolResultMessage, exec?: ToolExec): ToolRowSummary {
	try {
		const renderer = resolveToolRenderer(call.name);
		const args = call.arguments ?? exec?.args;
		return renderer.summary(args, result, exec);
	} catch {
		return {
			verb: call.name || "工具",
			chipText: call.intent ?? "",
			monoChip: false,
		};
	}
}

export function renderToolDetail(props: ToolRenderProps): ReactNode {
	const renderer = resolveToolRenderer(props.toolName);
	return (
		<ToolErrorBoundary fallbackProps={props}>
			{renderer.body(props)}
		</ToolErrorBoundary>
	);
}
