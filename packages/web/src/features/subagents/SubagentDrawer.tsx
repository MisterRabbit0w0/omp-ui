import type { AgentMessage, AssistantContent, ToolResultMessage } from "@omp-ui/protocol";
import { ChevronDown, Send, Square, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { getBridge, updateSessionView } from "@/store/bridge-access";
import { useAppStore } from "@/store/app-store";
import type { SubagentView } from "@/store/session-reducer";
import { Button, IconButton } from "@/ui/Button";
import { Chip, Pill, StatusBadge } from "@/ui/Chip";
import { Collapsible } from "@/ui/Collapsible";
import { Icon, SparkleIcon, toolIcon } from "@/ui/Icon";
import { Spinner, SpinnerRing } from "@/ui/Spinner";
import {
	applySubagentMessagesPage,
	createSubagentCursorState,
	extractSubagentMeta,
	OPEN_SUBAGENT_EVENT,
	openSubagentDrawer,
	subagentChildren,
	subagentLineage,
	type OpenSubagentEventDetail,
	type SubagentCursorState,
} from "./subagent-utils";

export interface SubagentDrawerProps {
	sessionId: string | null;
	/** Optional initial subagent id (used for controlled/gallery rendering). */
	initialSubagentId?: string | null;
	/** Optional explicit SubagentView fallback (used for gallery/isolated rendering). */
	subagent?: SubagentView;
	/** Optional preloaded messages for gallery/test rendering. */
	initialMessages?: AgentMessage[];
	/** Render inline inside a container instead of a full-screen portal (for gallery). */
	inline?: boolean;
	onClose?: () => void;
}

const POLL_INTERVAL_MS = 1500;

function formatToolArgsSummary(name: string, args: Record<string, unknown>): string {
	const primary =
		args.path ??
		args.file ??
		args.command ??
		args.pattern ??
		args.query ??
		args.i ??
		args.task;
	if (typeof primary === "string" && primary.length > 0) return primary;
	const keys = Object.keys(args);
	if (keys.length === 0) return name;
	return JSON.stringify(args).slice(0, 80);
}

function extractToolResultText(result?: ToolResultMessage): string {
	if (!result) return "";
	const parts: string[] = [];
	for (const c of result.content) {
		if (c.type === "text" && c.text) parts.push(c.text);
	}
	return parts.join("\n");
}

function SubagentToolCallItem({
	block,
	result,
}: {
	block: Extract<AssistantContent, { type: "toolCall" }>;
	result?: ToolResultMessage;
}) {
	const [open, setOpen] = useState(false);
	const ToolLucide = toolIcon(block.name);
	const summary = formatToolArgsSummary(block.name, block.arguments);
	const output = extractToolResultText(result);
	const isError = result?.isError === true;

	return (
		<div className="my-0.5">
			<button
				type="button"
				onClick={() => setOpen(v => !v)}
				className="flex h-7 w-full items-center gap-2 rounded-control px-1.5 text-left transition-colors duration-100 hover:bg-hover-2"
			>
				<span className="grid size-4 shrink-0 place-items-center text-ink-3">
					<Icon icon={ToolLucide} preset="inline" />
				</span>
				<span className={"shrink-0 text-[12.5px] font-medium " + (isError ? "text-red-ink" : "text-ink")}>
					{block.name}
				</span>
				<span className="min-w-0 flex-1 truncate rounded-chip bg-hover-2 px-1.5 font-mono text-[11.5px] leading-[22px] text-ink-2 shadow-hairline dark:bg-field">
					{summary}
				</span>
				<ChevronDown
					size={12}
					strokeWidth={2.2}
					className={
						"shrink-0 text-ink-3 transition-transform duration-150 " + (open ? "rotate-180" : "-rotate-90")
					}
				/>
			</button>
			<Collapsible open={open} duration={300}>
				<div className="my-1 ml-2 border-l border-line pl-3.5">
					<pre className="max-h-60 overflow-auto rounded-control bg-inset px-2.5 py-2 font-mono text-[11.5px] leading-[1.6] text-ink-2 shadow-hairline">
						{output.length > 0 ? output : JSON.stringify(block.arguments, null, 2)}
					</pre>
				</div>
			</Collapsible>
		</div>
	);
}

function SubagentThinkingItem({ text }: { text: string }) {
	const [open, setOpen] = useState(false);
	return (
		<div className="my-1">
			<button
				type="button"
				onClick={() => setOpen(v => !v)}
				className="-ml-1.5 inline-flex items-center gap-2 rounded-control px-1.5 py-1 text-[13px] font-medium text-ink-2 transition-colors duration-100 hover:bg-hover-2"
			>
				<SparkleIcon size={15} className="text-ink-3" />
				<span>思考过程</span>
				<ChevronDown
					size={13}
					strokeWidth={2.2}
					className={"text-ink-3 transition-transform duration-200 " + (open ? "rotate-180" : "")}
				/>
			</button>
			<Collapsible open={open} duration={300}>
				<div className="relative mt-1 ml-1.5 border-l border-line py-1 pl-4 text-[12.5px] leading-[1.65] text-ink-2">
					{text}
				</div>
			</Collapsible>
		</div>
	);
}

function SubagentMessagesView({ messages }: { messages: AgentMessage[] }) {
	const resultsByCallId = new Map<string, ToolResultMessage>();
	for (const m of messages) {
		if (m.role === "toolResult") {
			resultsByCallId.set(m.toolCallId, m);
		}
	}

	const visibleMessages = messages.filter(m => m.role !== "toolResult");
	if (visibleMessages.length === 0) {
		return (
			<div className="flex h-40 items-center justify-center text-[12.5px] text-ink-2">
				暂无子代理消息记录
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-4">
			{visibleMessages.map((msg, idx) => {
				if (msg.role === "user") {
					const text =
						typeof msg.content === "string"
							? msg.content
							: msg.content
									.filter((c): c is { type: "text"; text: string } => c.type === "text")
									.map(c => c.text)
									.join("\n");
					return (
						<div key={`u-${msg.timestamp}-${idx}`} className="flex flex-col items-end pl-12">
							<div className="rounded-bubble bg-field px-3.5 py-2 text-[14.5px] leading-[1.65] whitespace-pre-wrap text-ink">
								{text}
							</div>
						</div>
					);
				}

				if (msg.role === "assistant") {
					return (
						<div key={`a-${msg.timestamp}-${idx}`} className="flex flex-col gap-2">
							{msg.content.map((block, bIdx) => {
								if (block.type === "thinking") {
									return <SubagentThinkingItem key={`th-${bIdx}`} text={block.thinking} />;
								}
								if (block.type === "redactedThinking") {
									return (
										<div key={`rth-${bIdx}`} className="flex items-center gap-2 text-[12.5px] text-ink-3">
											<SparkleIcon size={14} className="text-ink-3" />
											<span>已隐藏的思考</span>
										</div>
									);
								}
								if (block.type === "text") {
									return (
										<div
											key={`tx-${bIdx}`}
											className="prose text-[14.5px] leading-[1.65] text-ink [&_code]:rounded-[5px] [&_code]:bg-field [&_code]:px-[5px] [&_code]:py-[1px] [&_code]:font-mono [&_code]:text-[0.9em] [&_p+p]:mt-3 [&_pre]:my-2 [&_pre]:overflow-auto [&_pre]:rounded-card [&_pre]:bg-inset [&_pre]:p-3 [&_pre]:font-mono [&_pre]:text-[12.5px] [&_pre]:shadow-hairline [&_ul]:list-disc [&_ul]:pl-5"
										>
											<ReactMarkdown remarkPlugins={[remarkGfm]}>{block.text}</ReactMarkdown>
										</div>
									);
								}
								if (block.type === "toolCall") {
									return (
										<SubagentToolCallItem
											key={block.id || `tc-${bIdx}`}
											block={block}
											result={resultsByCallId.get(block.id)}
										/>
									);
								}
								return null;
							})}
						</div>
					);
				}

				return null;
			})}
		</div>
	);
}

/**
 * Right-side 560px overlay drawer for inspecting and steering a subagent (DESIGN §10.2).
 * Listens to window `open-subagent` `{ sessionId, subagentId }` events.
 */
export function SubagentDrawer({
	sessionId: propSessionId,
	initialSubagentId = null,
	subagent: propSubagent,
	initialMessages,
	inline = false,
	onClose,
}: SubagentDrawerProps) {
	const [openTarget, setOpenTarget] = useState<{
		sessionId: string | null;
		subagentId: string;
	} | null>(() =>
		initialSubagentId ? { sessionId: propSessionId, subagentId: initialSubagentId } : null,
	);
	const [cursor, setCursor] = useState<SubagentCursorState>(() => ({
		...createSubagentCursorState(),
		messages: initialMessages ?? [],
	}));
	const [loading, setLoading] = useState(false);
	const [steerText, setSteerText] = useState("");
	const [steering, setSteering] = useState(false);
	const [confirmCancel, setConfirmCancel] = useState(false);
	const [cancelling, setCancelling] = useState(false);
	const cursorRef = useRef(cursor);
	cursorRef.current = cursor;

	const activeSessionId = openTarget?.sessionId ?? propSessionId;
	const activeSubagentId = openTarget?.subagentId ?? null;

	const storeSubagent: SubagentView | undefined = useAppStore(s => {
		const sid = activeSessionId ?? s.currentSessionId;
		if (!sid || !activeSubagentId) return undefined;
		return s.views[sid]?.subagents.get(activeSubagentId);
	});
	const subagent = storeSubagent ?? propSubagent;
	const subagentsMap: Map<string, SubagentView> | undefined = useAppStore(s => {
		const sid = activeSessionId ?? s.currentSessionId;
		return sid ? s.views[sid]?.subagents : undefined;
	});
	const lineage = subagentsMap && activeSubagentId ? subagentLineage(activeSubagentId, subagentsMap) : [];
	const childSubagents =
		subagentsMap && activeSubagentId ? subagentChildren(activeSubagentId, subagentsMap) : [];

	// Listen for `open-subagent` custom DOM events.
	useEffect(() => {
		if (inline) return;
		const handler = (ev: Event) => {
			const detail = (ev as CustomEvent<OpenSubagentEventDetail>).detail;
			if (!detail?.subagentId) return;
			const resolvedSessionId =
				detail.sessionId ?? propSessionId ?? useAppStore.getState().currentSessionId;
			setConfirmCancel(false);
			setSteerText("");
			setCursor(createSubagentCursorState());
			setOpenTarget({ sessionId: resolvedSessionId, subagentId: detail.subagentId });
		};
		window.addEventListener(OPEN_SUBAGENT_EVENT, handler);
		return () => window.removeEventListener(OPEN_SUBAGENT_EVENT, handler);
	}, [inline, propSessionId]);

	// Upgrade subagent subscription to "events" while open, restore to "progress" on close (DESIGN §10.2).
	useEffect(() => {
		if (inline || !activeSessionId || !activeSubagentId) return;
		const view = useAppStore.getState().views[activeSessionId];
		if (!view || view.readonly || view.proc !== "ready") return;
		const bridge = getBridge();
		void bridge
			.rpc(activeSessionId, { type: "set_subagent_subscription", level: "events" })
			.catch(() => undefined);
		return () => {
			void bridge
				.rpc(activeSessionId, { type: "set_subagent_subscription", level: "progress" })
				.catch(() => undefined);
		};
	}, [inline, activeSessionId, activeSubagentId]);

	// Poll `get_subagent_messages { subagentId, fromByte }` every 1.5s while running.
	useEffect(() => {
		if (inline || !activeSessionId || !activeSubagentId) return;
		let cancelled = false;

		const pollOnce = async () => {
			const view = useAppStore.getState().views[activeSessionId];
			if (!view || view.proc === "none") return;
			try {
				if (cursorRef.current.fromByte === 0) setLoading(true);
				const page = await getBridge().rpc(activeSessionId, {
					type: "get_subagent_messages",
					subagentId: activeSubagentId,
					...(subagent?.sessionFile ? { sessionFile: subagent.sessionFile } : {}),
					fromByte: cursorRef.current.fromByte,
				});
				if (cancelled) return;
				setCursor(prev => applySubagentMessagesPage(prev, page));
			} catch {
				/* session or subagent may not be ready */
			} finally {
				if (!cancelled) setLoading(false);
			}
		};

		void pollOnce();

		const isActive = subagent?.status === "running" || subagent?.status === "pending";
		if (!isActive) {
			return () => {
				cancelled = true;
			};
		}

		const timer = setInterval(() => {
			void pollOnce();
		}, POLL_INTERVAL_MS);

		return () => {
			cancelled = true;
			clearInterval(timer);
		};
	}, [inline, activeSessionId, activeSubagentId, subagent?.status, subagent?.sessionFile]);

	if (!activeSubagentId) return null;

	const handleClose = () => {
		setOpenTarget(null);
		setConfirmCancel(false);
		onClose?.();
	};

	const handleSteer = async () => {
		const msg = steerText.trim();
		if (!msg || !activeSessionId || !activeSubagentId || steering) return;
		setSteering(true);
		try {
			await getBridge().rpc(activeSessionId, {
				type: "steer_subagent",
				subagentId: activeSubagentId,
				message: msg,
			});
			setSteerText("");
			useAppStore.getState().pushToast("info", "已向子代理发送指令");
		} catch (err) {
			useAppStore
				.getState()
				.pushToast("error", err instanceof Error ? err.message : "发送指令失败");
		} finally {
			setSteering(false);
		}
	};

	const handleCancelSubagent = async () => {
		if (!activeSessionId || !activeSubagentId || cancelling) return;
		setCancelling(true);
		try {
			await getBridge().rpc(activeSessionId, {
				type: "cancel_subagent",
				subagentId: activeSubagentId,
			});
			updateSessionView(activeSessionId, v => {
				const prev = v.subagents.get(activeSubagentId);
				if (!prev) return v;
				const nextMap = new Map(v.subagents);
				const now = Date.now();
				nextMap.set(activeSubagentId, { ...prev, status: "aborted", lastUpdate: now });
				// omp cancels the whole subtree: nested subagents share the dotted id prefix.
				for (const [id, s] of v.subagents) {
					if (id.startsWith(`${activeSubagentId}.`) && (s.status === "running" || s.status === "pending")) {
						nextMap.set(id, { ...s, status: "aborted", lastUpdate: now });
					}
				}
				return { ...v, subagents: nextMap };
			});
			setConfirmCancel(false);
		} catch (err) {
			useAppStore
				.getState()
				.pushToast("error", err instanceof Error ? err.message : "终止子代理失败");
		} finally {
			setCancelling(false);
		}
	};

	const meta = extractSubagentMeta(subagent?.progress);
	const isRunning = subagent?.status === "running" || subagent?.status === "pending";

	const panel = (
		<aside
			role="dialog"
			aria-label={`子代理 ${subagent?.agent ?? activeSubagentId}`}
			className={
				inline
					? "flex h-[520px] w-[560px] max-w-full flex-col overflow-hidden rounded-window bg-surface shadow-overlay"
					: "fixed top-0 right-0 bottom-0 z-50 flex w-[560px] max-w-full flex-col bg-surface shadow-overlay animate-[fade-in_0.18s_var(--ease-out-strong)]"
			}
		>
			{/* Header */}
			<div className="flex h-11 shrink-0 items-center gap-2.5 border-b border-line px-4">
				{subagent?.status === "running" ? (
					<SpinnerRing active index={subagent.index} />
				) : subagent?.status === "pending" ? (
					<SpinnerRing active={false} index={subagent.index} />
				) : subagent?.status === "completed" ? (
					<StatusBadge status="success" />
				) : subagent?.status === "failed" ? (
					<StatusBadge status="error" />
				) : (
					<StatusBadge status="aborted" />
				)}
				<span className="shrink-0 text-[13px] font-medium text-ink">
					{subagent?.agent ?? activeSubagentId}
				</span>
				{subagent?.agentSource && <Chip>{subagent.agentSource}</Chip>}
				<span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-2">
					{subagent?.description ?? subagent?.task ?? ""}
				</span>
				{meta && <span className="shrink-0 font-mono text-[11.5px] text-ink-2 tabular-nums">{meta}</span>}
				{subagent?.status === "completed" && <Pill tone="green">完成</Pill>}
				{subagent?.status === "failed" && <Pill tone="red">失败</Pill>}
				{subagent?.status === "aborted" && <Pill tone="neutral">已中止</Pill>}
				<IconButton size="sm" label="关闭子代理抽屉" onClick={handleClose}>
					<X size={14} strokeWidth={2.2} />
				</IconButton>
			</div>

			{/* Subagent tree: ancestors breadcrumb + direct children */}
			{(lineage.length > 0 || childSubagents.length > 0) && (
				<div
					className="flex shrink-0 flex-col gap-1.5 border-b border-line px-4 py-2 text-[12px]"
					data-testid="subagent-tree-nav"
				>
					{lineage.length > 0 && (
						<nav aria-label="父级子代理" className="flex min-w-0 flex-wrap items-center gap-1 text-ink-2">
							<span className="shrink-0 text-ink-3">上级</span>
							{lineage.map(parent => (
								<span key={parent.id} className="inline-flex items-center gap-1">
									<button
										type="button"
										onClick={() => openSubagentDrawer(activeSessionId, parent.id)}
										className="rounded-chip px-1 text-accent-ink hover:bg-hover hover:underline"
										data-subagent-link={parent.id}
									>
										{parent.agent}
									</button>
									<span className="text-ink-3" aria-hidden="true">›</span>
								</span>
							))}
							<span className="font-medium text-ink">{subagent?.agent ?? activeSubagentId}</span>
						</nav>
					)}
					{childSubagents.length > 0 && (
						<div className="flex min-w-0 flex-wrap items-center gap-1" aria-label="下级子代理">
							<span className="shrink-0 text-ink-3">下级 {childSubagents.length}</span>
							{childSubagents.map(child => (
								<button
									key={child.id}
									type="button"
									onClick={() => openSubagentDrawer(activeSessionId, child.id)}
									className="inline-flex h-7 items-center gap-1 rounded-full bg-inset pr-2 pl-0.5 text-ink-2 shadow-hairline hover:bg-hover"
									data-subagent-link={child.id}
								>
									{child.status === "running" || child.status === "pending" ? (
										<SpinnerRing active={child.status === "running"} index={child.index} />
									) : (
										<StatusBadge
											status={
												child.status === "completed"
													? "success"
													: child.status === "failed"
														? "error"
														: "aborted"
											}
										/>
									)}
									<span className="max-w-40 truncate">{child.agent}</span>
								</button>
							))}
						</div>
					)}
				</div>
			)}

			{/* Transcript body */}
			<div className="min-h-0 flex-1 overflow-auto px-4 py-3">
				{loading && cursor.messages.length === 0 ? (
					<div className="flex h-32 items-center justify-center gap-2 text-[12.5px] text-ink-2">
						<Spinner />
						<span>加载子代理记录…</span>
					</div>
				) : (
					<SubagentMessagesView messages={cursor.messages} />
				)}
			</div>

			{/* Confirm cancel banner */}
			{confirmCancel && (
				<div className="flex items-center justify-between gap-2 border-t border-line bg-red-tint px-4 py-2 text-[12.5px]">
					<span className="font-medium text-red-ink">确定要终止该子代理吗？</span>
					<div className="flex items-center gap-2">
						<Button size="sm" variant="secondary" onClick={() => setConfirmCancel(false)}>
							取消
						</Button>
						<Button size="sm" variant="danger" loading={cancelling} onClick={() => void handleCancelSubagent()}>
							确认终止
						</Button>
					</div>
				</div>
			)}

			{/* Footer: steer input + cancel button */}
			<div className="flex items-center gap-2 border-t border-line p-3">
				<input
					type="text"
					value={steerText}
					onChange={e => setSteerText(e.target.value)}
					onKeyDown={e => {
						if (e.key === "Enter" && !e.nativeEvent.isComposing) {
							e.preventDefault();
							void handleSteer();
						}
					}}
					placeholder={isRunning ? "向子代理发送补充指令 (steer)…" : "向子代理发送消息…"}
					aria-label="向子代理发送指令"
					className="h-7 min-w-0 flex-1 rounded-control bg-inset px-2.5 text-[13px] text-ink shadow-hairline outline-none placeholder:text-ink-3 focus:shadow-[0_0_0_1px_var(--line-strong)]"
				/>
				<Button
					variant="primary"
					size="md"
					loading={steering}
					disabled={steerText.trim().length === 0}
					icon={<Send size={13} strokeWidth={2} />}
					onClick={() => void handleSteer()}
				>
					发送
				</Button>
				{isRunning && !confirmCancel && (
					<Button
						variant="danger"
						size="md"
						icon={<Square size={12} strokeWidth={2.2} />}
						onClick={() => setConfirmCancel(true)}
					>
						终止
					</Button>
				)}
			</div>
		</aside>
	);

	if (inline) return panel;
	if (typeof document === "undefined") return null;

	return createPortal(
		<div className="fixed inset-0 z-50">
			<div
				className="fixed inset-0 bg-scrim animate-[fade-in_0.18s]"
				onClick={handleClose}
				aria-hidden="true"
			/>
			{panel}
		</div>,
		document.body,
	);
}
