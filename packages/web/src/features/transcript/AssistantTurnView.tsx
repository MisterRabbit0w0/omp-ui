/**
 * AssistantTurnView and standalone system/execution message blocks
 * (FRONTEND §6.5, §6.17, DESIGN §4.2, §6.2, §9.3, §11).
 */
import type {
	ApprovalPrompt,
	AssistantContent,
	AssistantMessage,
	BashExecutionMessage,
	BranchSummaryMessage,
	CompactionSummaryMessage,
	CustomMessage,
	FileMentionMessage,
	HookMessage,
	PythonExecutionMessage,
	ToolCall,
	ToolResultMessage,
} from "@omp-ui/protocol";
import { Check, Copy, FileText, GitBranch, RotateCcw, X } from "lucide-react";
import { useState } from "react";
import { useAppStore } from "../../store/app-store";
import { getBridge } from "../../store/bridge-access";
import {
	READ_ONLY_TOOLS,
	type AssistantTurn,
	type Draft,
	type SubagentView,
	type ToolExec,
	type ToolGroup,
	type TurnTool,
	type ViewMessage,
} from "../../store/session-reducer";
import { Banner } from "../../ui/Banner";
import { Button, IconButton } from "../../ui/Button";
import { Card } from "../../ui/Card";
import { Chip, Pill } from "../../ui/Chip";
import { Collapsible } from "../../ui/Collapsible";
import { Icon } from "../../ui/Icon";
import { Tooltip } from "../../ui/Tooltip";
import { CodeBlock } from "../tools/CodeBlock";
import { Prose } from "./Prose";
import { ThinkingBlock } from "./ThinkingBlock";
import { ToolRunGroup } from "./ToolRunGroup";

export interface AssistantTurnViewProps {
	sessionId: string;
	turn: AssistantTurn;
	toolExec: Map<string, ToolExec>;
	subagents: Map<string, SubagentView>;
	anchoredApprovals: Map<string, ApprovalPrompt[]>;
	isTurnRunning: boolean;
	animateOnMount?: boolean;
	focusedToolCallId?: string | null;
}

export interface DraftTurnViewProps {
	sessionId: string;
	draft: Draft;
	toolExec: Map<string, ToolExec>;
	subagents: Map<string, SubagentView>;
	anchoredApprovals: Map<string, ApprovalPrompt[]>;
	focusedToolCallId?: string | null;
}

function formatTokenCount(tokens: number): string {
	if (tokens >= 1000) {
		return `${(tokens / 1000).toFixed(1).replace(/\.0$/, "")}k`;
	}
	return `${tokens}`;
}

function formatShortModelName(model: string): string {
	const afterSlash = model.split("/").pop() ?? model;
	return afterSlash.replace(/^claude-/, "");
}

function formatTurnDuration(messages: ReadonlyArray<AssistantMessage>): string | undefined {
	let totalMs = 0;
	for (const m of messages) {
		if (typeof m.duration === "number" && m.duration > 0) {
			totalMs += m.duration;
		} else if (m.completedAt && m.timestamp && m.completedAt > m.timestamp) {
			totalMs += m.completedAt - m.timestamp;
		}
	}
	if (totalMs <= 0) return undefined;
	const sec = totalMs / 1000;
	if (sec < 60) {
		return sec >= 10 ? `${Math.round(sec)}s` : `${sec.toFixed(1)}s`;
	}
	return `${Math.floor(sec / 60)}m ${Math.round(sec % 60)}s`;
}

function buildToolGroups(tools: TurnTool[]): ToolGroup[] {
	const groups: ToolGroup[] = [];
	let i = 0;
	while (i < tools.length) {
		const t = tools[i]!;
		if (READ_ONLY_TOOLS[t.call.name] === true) {
			let j = i;
			while (j < tools.length && READ_ONLY_TOOLS[tools[j]!.call.name] === true) j++;
			if (j - i >= 3) {
				groups.push({ tools: tools.slice(i, j), readOnlyCollapsed: true });
			} else {
				for (let k = i; k < j; k++) groups.push({ tools: [tools[k]!], readOnlyCollapsed: false });
			}
			i = j;
		} else {
			groups.push({ tools: [t], readOnlyCollapsed: false });
			i++;
		}
	}
	return groups;
}

type TurnSegment =
	| { kind: "thinking"; text: string; redacted: boolean; durationSeconds?: number }
	| { kind: "tools"; tools: TurnTool[]; groups: ToolGroup[] }
	| { kind: "prose"; text: string };

/**
 * Segment an AssistantTurn into ordered visual blocks (Thinking -> ToolRun -> Prose)
 * matching prototype/index.html & FRONTEND §6.5.
 */
function segmentTurn(
	messages: ReadonlyArray<AssistantMessage>,
	allTurnTools: ReadonlyArray<TurnTool>,
): TurnSegment[] {
	const toolById = new Map<string, TurnTool>();
	for (const t of allTurnTools) {
		toolById.set(t.call.id, t);
	}

	const segments: TurnSegment[] = [];
	let pendingTools: TurnTool[] = [];

	const flushTools = () => {
		if (pendingTools.length === 0) return;
		segments.push({
			kind: "tools",
			tools: pendingTools,
			groups: buildToolGroups(pendingTools),
		});
		pendingTools = [];
	};

	for (const msg of messages) {
		const msgDurSec =
			typeof msg.duration === "number" && msg.duration > 0 ? Math.max(1, Math.round(msg.duration / 1000 / 2)) : undefined;

		for (const block of msg.content) {
			if (!block) continue;
			if (block.type === "thinking") {
				if (block.thinking.trim().length > 0) {
					flushTools();
					segments.push({
						kind: "thinking",
						text: block.thinking,
						redacted: false,
						durationSeconds: msgDurSec,
					});
				}
			} else if (block.type === "redactedThinking") {
				flushTools();
				segments.push({
					kind: "thinking",
					text: "",
					redacted: true,
				});
			} else if (block.type === "toolCall") {
				const turnTool = toolById.get(block.id) ?? { call: block };
				pendingTools.push(turnTool);
			} else if (block.type === "text") {
				if (block.text.trim().length > 0) {
					flushTools();
					const prev = segments[segments.length - 1];
					if (prev && prev.kind === "prose") {
						prev.text += `\n\n${block.text}`;
					} else {
						segments.push({ kind: "prose", text: block.text });
					}
				}
			}
		}
	}
	flushTools();
	return segments;
}

export function AssistantTurnView({
	sessionId,
	turn,
	toolExec,
	subagents,
	anchoredApprovals,
	isTurnRunning,
	animateOnMount = false,
	focusedToolCallId,
}: AssistantTurnViewProps) {
	const [copied, setCopied] = useState(false);
	const retryPrompt = useAppStore(s => s.retryPrompt);
	const pushToast = useAppStore(s => s.pushToast);

	const segments = segmentTurn(turn.messages, turn.tools);
	const lastMessage = turn.messages[turn.messages.length - 1];

	// `usage.totalTokens` re-counts the whole cached context on every message, so summing it is meaningless.
	// Show the context size the turn ended at plus the tokens it actually generated.
	let outputTokens = 0;
	for (const m of turn.messages) {
		outputTokens += m.usage?.output ?? 0;
	}
	const lastUsage = lastMessage?.usage;
	const contextTokens = lastUsage ? lastUsage.input + lastUsage.cacheRead + lastUsage.cacheWrite : 0;
	const modelShort = lastMessage ? formatShortModelName(lastMessage.model) : "";
	const durationText = formatTurnDuration(turn.messages);
	const ttftMs = turn.messages[0]?.ttft;

	const metaParts: string[] = [];
	if (modelShort) metaParts.push(modelShort);
	if (contextTokens > 0) metaParts.push(`上下文 ${formatTokenCount(contextTokens)}`);
	if (outputTokens > 0) metaParts.push(`输出 ${formatTokenCount(outputTokens)}`);
	if (durationText) metaParts.push(durationText);
	const metaString = metaParts.join(" · ");
	const ttftText =
		ttftMs === undefined ? undefined : ttftMs < 1000 ? `${Math.round(ttftMs)}ms` : `${(ttftMs / 1000).toFixed(1)}s`;

	const collectProseText = (): string => {
		const out: string[] = [];
		for (const m of turn.messages) {
			for (const b of m.content) {
				if (b && b.type === "text" && b.text.trim().length > 0) {
					out.push(b.text);
				}
			}
		}
		return out.join("\n\n");
	};

	const handleCopy = () => {
		const text = collectProseText();
		if (typeof navigator !== "undefined" && navigator.clipboard) {
			void navigator.clipboard.writeText(text);
		}
		setCopied(true);
		setTimeout(() => setCopied(false), 1500);
	};

	const handleRetry = () => {
		void retryPrompt(sessionId);
	};

	const handleFork = async () => {
		try {
			const res = await getBridge().rpc(sessionId, { type: "fork" });
			if (!res.cancelled) {
				pushToast("info", "已分叉为新会话");
				await useAppStore.getState().loadSessions();
			}
		} catch (err) {
			pushToast("error", err instanceof Error ? err.message : "分叉失败");
		}
	};

	return (
		<div className={"group/turn flex flex-col gap-2.5 " + (animateOnMount ? "anim-fade-up" : "")}>
			{segments.map((seg, idx) => {
				if (seg.kind === "thinking") {
					return (
						<ThinkingBlock
							key={`think-${idx}`}
							thinking={seg.text}
							redacted={seg.redacted}
							streaming={false}
							durationSeconds={seg.durationSeconds}
						/>
					);
				}
				if (seg.kind === "tools") {
					return (
						<ToolRunGroup
							key={`tools-${idx}`}
							sessionId={sessionId}
							tools={seg.tools}
							groups={seg.groups}
							toolExec={toolExec}
							subagents={subagents}
							anchoredApprovals={anchoredApprovals}
							isTurnRunning={isTurnRunning}
							focusedToolCallId={focusedToolCallId}
						/>
					);
				}
				return <Prose key={`prose-${idx}`} content={seg.text} />;
			})}

			{lastMessage?.stopReason === "error" && (
				<Banner
					variant="error"
					icon={<X size={14} strokeWidth={2.2} className="i" />}
					title="请求失败"
					action={
						<Button variant="secondary" size="sm" onClick={handleRetry}>
							重试
						</Button>
					}
				>
					<span>{lastMessage.errorMessage ?? "生成过程中发生错误"}</span>
					{(lastMessage.provider || lastMessage.model || lastMessage.errorStatus) && (
						<span className="mono ml-2 text-[11.5px] text-ink-2">
							{[
								lastMessage.provider,
								formatShortModelName(lastMessage.model),
								lastMessage.errorStatus ? `HTTP ${lastMessage.errorStatus}` : null,
							]
								.filter(Boolean)
								.join(" · ")}
						</span>
					)}
				</Banner>
			)}

			{lastMessage?.stopReason === "aborted" && (
				<div className="text-[12px] text-ink-3">已停止</div>
			)}

			{!isTurnRunning && (
				<div className="mt-0.5 flex items-center gap-0.5 animate-[fade-in_0.4s_both]">
					<IconButton size="sm" label={copied ? "已复制" : "复制"} onClick={handleCopy}>
						{copied ? (
							<Check size={14} strokeWidth={2.4} className="i text-green" />
						) : (
							<Copy size={15} strokeWidth={1.8} className="i" />
						)}
					</IconButton>
					<IconButton size="sm" label="重试" onClick={handleRetry}>
						<RotateCcw size={15} strokeWidth={1.8} className="i" />
					</IconButton>
					<IconButton size="sm" label="分叉" onClick={() => void handleFork()}>
						<GitBranch size={15} strokeWidth={1.8} className="i" />
					</IconButton>
					{metaString && (
						<span className="mono ml-auto text-[11.5px] text-ink-2 opacity-0 transition-opacity duration-150 group-hover/turn:opacity-100">
							{ttftText !== undefined ? (
								<Tooltip content={`首字延迟 ${ttftText}`}>
									<span>{metaString}</span>
								</Tooltip>
							) : (
								metaString
							)}
						</span>
					)}
				</div>
			)}
		</div>
	);
}

/**
 * Streaming Draft renderer (FRONTEND §4.3, DESIGN §6.2).
 */
export function DraftTurnView({
	sessionId,
	draft,
	toolExec,
	subagents,
	anchoredApprovals,
	focusedToolCallId,
}: DraftTurnViewProps) {
	const blocks = draft.content.filter((b): b is AssistantContent => Boolean(b));
	if (blocks.length === 0) return null;

	const thinkingBlocks: Array<{ text: string; redacted: boolean; streaming: boolean }> = [];
	const draftTools: TurnTool[] = [];
	const textChunks: string[] = [];

	draft.content.forEach((block, idx) => {
		if (!block) return;
		const isLastBlock = idx === draft.content.length - 1 && !draft.done;
		if (block.type === "thinking") {
			thinkingBlocks.push({ text: block.thinking, redacted: false, streaming: isLastBlock });
		} else if (block.type === "redactedThinking") {
			thinkingBlocks.push({ text: "", redacted: true, streaming: false });
		} else if (block.type === "toolCall") {
			const call: ToolCall = {
				type: "toolCall",
				id: block.id || `draft-tc-${idx}`,
				name: block.name || "tool",
				arguments: block.arguments ?? {},
				intent: block.intent,
			};
			draftTools.push({
				call,
				exec: block.id ? toolExec.get(block.id) : undefined,
			});
		} else if (block.type === "text") {
			textChunks.push(block.text);
		}
	});

	const joinedText = textChunks.join("\n\n");
	const toolGroups = buildToolGroups(draftTools);

	return (
		<div className="flex flex-col gap-2.5">
			{thinkingBlocks.map((tb, i) => (
				<ThinkingBlock
					key={`d-think-${i}`}
					thinking={tb.text}
					redacted={tb.redacted}
					streaming={tb.streaming}
				/>
			))}
			{draftTools.length > 0 && (
				<ToolRunGroup
					sessionId={sessionId}
					tools={draftTools}
					groups={toolGroups}
					toolExec={toolExec}
					subagents={subagents}
					anchoredApprovals={anchoredApprovals}
					isTurnRunning={!draft.done}
					focusedToolCallId={focusedToolCallId}
				/>
			)}
			{joinedText.length > 0 && (
				<Prose content={joinedText} streaming={!draft.done} />
			)}
		</div>
	);
}

// ── Standalone Special Transcript Messages (DESIGN §9.3, FRONTEND §6.17) ──

function CompactionDivider({ message }: { message: CompactionSummaryMessage }) {
	const [open, setOpen] = useState(false);
	const beforeStr = formatTokenCount(message.tokensBefore);
	const afterStr = message.tokensAfter !== undefined ? ` → ${formatTokenCount(message.tokensAfter)}` : "";

	return (
		<div className="my-4">
			<button
				type="button"
				onClick={() => setOpen(o => !o)}
				className="flex w-full items-center gap-3 text-[11.5px] text-ink-2 transition-colors hover:text-ink"
			>
				<span className="h-px flex-1 bg-line" />
				<span className="tabular-nums">
					上下文已压缩 · {beforeStr}
					{afterStr}
				</span>
				<span className="h-px flex-1 bg-line" />
			</button>
			{message.summary && (
				<Collapsible open={open} duration={300}>
					<Card className="mt-2 p-3 text-[12.5px] leading-[1.6] text-ink-2 whitespace-pre-wrap">
						{message.summary}
					</Card>
				</Collapsible>
			)}
		</div>
	);
}

function BranchSummaryDivider({ message }: { message: BranchSummaryMessage }) {
	const [open, setOpen] = useState(false);
	return (
		<div className="my-4">
			<button
				type="button"
				onClick={() => setOpen(o => !o)}
				className="flex w-full items-center gap-3 text-[11.5px] text-ink-2 transition-colors hover:text-ink"
			>
				<span className="h-px flex-1 bg-line" />
				<span>分支摘要</span>
				<span className="h-px flex-1 bg-line" />
			</button>
			{message.summary && (
				<Collapsible open={open} duration={300}>
					<Card className="mt-2 p-3 text-[12.5px] leading-[1.6] text-ink-2 whitespace-pre-wrap">
						{message.summary}
					</Card>
				</Collapsible>
			)}
		</div>
	);
}

function BashExecutionBlock({ message }: { message: BashExecutionMessage }) {
	return (
		<div className="my-3 relative max-h-[320px] overflow-auto rounded-control bg-inset px-2.5 py-2 shadow-hairline mono text-[11.5px] leading-[1.6] text-ink-2 whitespace-pre">
			{message.cancelled ? (
				<Pill tone="neutral" className="absolute top-1.5 right-1.5 h-5 font-sans">
					已取消
				</Pill>
			) : (
				message.exitCode !== undefined && (
					<Pill
						tone={message.exitCode === 0 ? "green" : "red"}
						className="absolute top-1.5 right-1.5 h-5 font-sans"
					>
						exit {message.exitCode}
					</Pill>
				)
			)}
			<div className="text-ink">$ {message.command}</div>
			{message.output && <div>{message.output}</div>}
		</div>
	);
}

function PythonExecutionBlock({ message }: { message: PythonExecutionMessage }) {
	return (
		<div className="my-3 flex flex-col gap-1.5">
			<CodeBlock code={message.code} language="python" showHeader={false} maxHeight={200} />
			{message.output && (
				<div className="relative max-h-[240px] overflow-auto rounded-control bg-inset px-2.5 py-2 shadow-hairline mono text-[11.5px] leading-[1.6] text-ink-2 whitespace-pre">
					{message.exitCode !== undefined && (
						<Pill
							tone={message.exitCode === 0 ? "green" : "red"}
							className="absolute top-1.5 right-1.5 h-5 font-sans"
						>
							exit {message.exitCode}
						</Pill>
					)}
					{message.output}
				</div>
			)}
		</div>
	);
}

function StandaloneFileMentionBlock({ message }: { message: FileMentionMessage }) {
	if (!message.files || message.files.length === 0) return null;
	return (
		<div className="my-2 flex flex-wrap gap-1.5">
			{message.files.map(f => (
				<Chip
					key={f.path}
					mono
					icon={<Icon icon={FileText} size={12} className="shrink-0 text-ink-3" />}
				>
					{f.path}
				</Chip>
			))}
		</div>
	);
}

function CustomOrHookBlock({ message }: { message: CustomMessage | HookMessage }) {
	// DESIGN §9.3: custom/hookMessage only rendered when display === true
	if (!message.display) return null;

	const text = typeof message.content === "string"
		? message.content
		: Array.isArray(message.content)
			? message.content
					.filter((b): b is { type: "text"; text: string } => b.type === "text")
					.map(b => b.text)
					.join("\n")
			: "";

	if (message.customType === "command_output") {
		return (
			<div className="my-2 overflow-x-auto rounded-control bg-inset px-3 py-2 shadow-hairline mono text-[11.5px] leading-[1.6] text-ink-2 whitespace-pre-wrap">
				{text}
			</div>
		);
	}

	if (message.customType === "ttsr_triggered") {
		return (
			<div className="my-2 flex items-center">
				<Chip>TTSR 规则已触发</Chip>
			</div>
		);
	}

	if (!text) return null;

	return (
		<div className="my-2 rounded-control bg-field px-3 py-2 shadow-hairline text-[12.5px] leading-[1.55] text-ink-2 whitespace-pre-wrap">
			{text}
		</div>
	);
}

export function StandaloneMessageView({ message }: { message: ViewMessage }) {
	switch (message.role) {
		case "compactionSummary":
			return <CompactionDivider message={message} />;
		case "branchSummary":
			return <BranchSummaryDivider message={message} />;
		case "bashExecution":
			return <BashExecutionBlock message={message} />;
		case "pythonExecution":
			return <PythonExecutionBlock message={message} />;
		case "fileMention":
			return <StandaloneFileMentionBlock message={message} />;
		case "custom":
		case "hookMessage":
			return <CustomOrHookBlock message={message} />;
		default:
			return null;
	}
}
