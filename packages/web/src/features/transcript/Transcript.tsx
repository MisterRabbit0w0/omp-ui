/**
 * Virtualized Transcript scroll container (FRONTEND §3, §6.3–§6.11, §6.17–§6.18, DESIGN §6, §7, §9.3).
 *
 * Custom DOM events emitted / handled:
 * - Emits `transcript-scroll` (`CustomEvent<{ scrolled: boolean; sessionId: string | null }>`) on `window`
 *   when scrollTop crosses 4px so `SessionHeader` can toggle its bottom 1px hairline.
 * - Listens to `scroll-to-tool` (`CustomEvent<{ toolCallId: string }>`) on `window` to scroll to and
 *   expand a specific tool call from the right panel's 变更 tab.
 */
import type { AskUiRequest, FileMentionItem, OpenUrlUiRequest, UserMessage } from "@omp-ui/protocol";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSessionView } from "../../store/hooks";
import { approvalReceiptKind, askSummaryLines, selectTurns, type SessionView, type TranscriptItem } from "../../store/session-reducer";
import { anchorApprovals } from "./approval-anchor";
import { ApprovalCard, ApprovalReceipt } from "./ApprovalCard";
import { AskCard, AskSummary } from "./AskCard";
import { AssistantTurnView, DraftTurnView, StandaloneMessageView } from "./AssistantTurnView";
import { extractUserMessageText } from "./branch-match";
import { EmptySession } from "./EmptySession";
import { OpenUrlCard } from "./OpenUrlCard";
import { RunIndicator, TranscriptBanners } from "./RunIndicator";
import { UserMessageView } from "./UserMessage";

export interface TranscriptScrollEventDetail {
	scrolled: boolean;
	sessionId: string | null;
}

export interface TranscriptProps {
	sessionId: string | null;
	/** Optional override SessionView for gallery / isolated testing. */
	view?: SessionView;
	/** Callback fired when `scrollTop > 4` changes (in addition to `transcript-scroll` custom event). */
	onScrollStateChange?: (scrolled: boolean) => void;
	className?: string;
}

type PreparedRow =
	| {
			key: string;
			kind: "user";
			message: UserMessage & { animateOnMount?: boolean };
			userIndex: number;
			attachedFileMentions?: FileMentionItem[];
	  }
	| {
			key: string;
			kind: "turn";
			turn: Extract<TranscriptItem, { kind: "turn" }>["turn"];
			isLastTurn: boolean;
			animateOnMount: boolean;
	  }
	| {
			key: string;
			kind: "draft";
			draft: Extract<TranscriptItem, { kind: "draft" }>["draft"];
	  }
	| {
			key: string;
			kind: "standalone";
			message: Extract<TranscriptItem, { kind: "message" }>["message"];
	  };

function LoadingSkeleton() {
	return (
		<div
			aria-label="正在加载会话历史"
			className="mx-auto flex max-w-[820px] flex-col gap-6 px-6 pt-6 pb-[180px]"
		>
			{[0, 1, 2].map(groupIdx => (
				<div key={groupIdx} className="flex flex-col gap-4">
					<div className="flex justify-end">
						<div className="h-9 w-48 rounded-chip bg-inset animate-[pulse-dot_1.4s_infinite]" />
					</div>
					<div className="flex flex-col gap-2">
						<div className="h-4 w-[82%] rounded-chip bg-inset animate-[pulse-dot_1.4s_infinite]" />
						<div className="h-4 w-[65%] rounded-chip bg-inset animate-[pulse-dot_1.4s_infinite]" />
						<div className="h-4 w-[48%] rounded-chip bg-inset animate-[pulse-dot_1.4s_infinite]" />
					</div>
				</div>
			))}
		</div>
	);
}

export function Transcript({
	sessionId,
	view: viewOverride,
	onScrollStateChange,
	className,
}: TranscriptProps) {
	const storeView = useSessionView(sessionId);
	const view = viewOverride ?? storeView;

	const scrollRef = useRef<HTMLDivElement | null>(null);
	const [atBottom, setAtBottom] = useState(true);
	const [hasUnreadBelow, setHasUnreadBelow] = useState(false);
	const [showColdSkeleton, setShowColdSkeleton] = useState(false);
	const [focusedToolCallId, setFocusedToolCallId] = useState<string | null>(null);
	const scrolledHeaderRef = useRef(false);
	/** Follow new content. Cleared only by the user scrolling up; set again when they reach the bottom. */
	const stickRef = useRef(true);
	const lastScrollTopRef = useRef(0);
	const lastScrollHeightRef = useRef(0);
	const resizeObserverRef = useRef<ResizeObserver | null>(null);

	// Any growth of the content (new rows, row measurement, collapsibles, images, the run indicator)
	// keeps the view pinned while following. A callback ref so it survives the empty/skeleton branches.
	const contentRef = useCallback((node: HTMLDivElement | null) => {
		resizeObserverRef.current?.disconnect();
		resizeObserverRef.current = null;
		if (!node || typeof ResizeObserver === "undefined") return;
		const ro = new ResizeObserver(() => {
			const el = scrollRef.current;
			if (!el || !stickRef.current) return;
			el.scrollTop = el.scrollHeight;
			lastScrollTopRef.current = el.scrollTop;
			lastScrollHeightRef.current = el.scrollHeight;
		});
		ro.observe(node);
		resizeObserverRef.current = ro;
	}, []);

	// §6.18: Loading skeleton only appears when cold start history fetch takes > 300ms
	const isColdStarting = Boolean(
		view && view.proc === "starting" && view.messages.length === 0 && view.drafts.size === 0,
	);
	useEffect(() => {
		if (!isColdStarting) {
			setShowColdSkeleton(false);
			return;
		}
		const timer = setTimeout(() => {
			setShowColdSkeleton(true);
		}, 300);
		return () => clearTimeout(timer);
	}, [isColdStarting]);

	const rawTurns = useMemo(() => (view ? selectTurns(view) : []), [view]);
	const rawToolIds = useMemo(() => {
		const ids = new Set<string>();
		for (const item of rawTurns) if (item.kind === "turn") for (const t of item.turn.tools) ids.add(t.call.id);
		return ids;
	}, [rawTurns]);

	// All user messages in transcript order (used for get_entries branch matching)
	const allUserMessages = useMemo(() => {
		if (!view) return [];
		const list: Array<Pick<UserMessage, "content" | "synthetic">> = [];
		for (const m of view.messages) {
			if (m.role === "user") {
				list.push(m);
			}
		}
		return list;
	}, [view]);

	// Build prepared rows: pair `fileMention` messages onto their preceding `UserMessage` (verified rule #5)
	const preparedRows = useMemo<PreparedRow[]>(() => {
		const rows: PreparedRow[] = [];
		let userCounter = 0;

		for (let i = 0; i < rawTurns.length; i++) {
			const item = rawTurns[i]!;
			if (item.kind === "message") {
				const msg = item.message;
				if (msg.role === "user") {
					const currentIndex = userCounter++;
					let attachedFileMentions: FileMentionItem[] | undefined;
					const nextItem = rawTurns[i + 1];
					if (nextItem && nextItem.kind === "message" && nextItem.message.role === "fileMention") {
						attachedFileMentions = nextItem.message.files;
						i++; // Consume the following fileMention message so it attaches above the user bubble
					}
					rows.push({
						key: `user-${currentIndex}-${msg.timestamp}`,
						kind: "user",
						message: msg,
						userIndex: currentIndex,
						attachedFileMentions,
					});
				} else if (msg.role !== "toolResult") {
					rows.push({
						key: `msg-${i}-${msg.timestamp}`,
						kind: "standalone",
						message: msg,
					});
				}
			} else if (item.kind === "turn") {
				const isLastTurn =
					i === rawTurns.length - 1 ||
					rawTurns.slice(i + 1).every(r => r.kind === "draft");
				const animateOnMount = item.turn.messages.some(
					m => "animateOnMount" in m && m.animateOnMount === true,
				);
				rows.push({
					key: `turn-${i}-${item.turn.messages[0]?.timestamp ?? i}`,
					kind: "turn",
					turn: item.turn,
					isLastTurn,
					animateOnMount,
				});
			} else if (item.kind === "draft") {
				rows.push({
					key: `draft-${item.draft.messageId}`,
					kind: "draft",
					draft: item.draft,
				});
			}
		}

		return rows;
	}, [rawTurns]);

	const anchored = useMemo(
		() =>
			view
				? anchorApprovals(rawTurns, view.pendingUi, view.toolExec)
				: { byToolCallId: new Map(), unanchored: [] },
		[view, rawTurns],
	);

	const askRequests = useMemo<AskUiRequest[]>(
		() => (view ? view.pendingUi.filter((r): r is AskUiRequest => r.method === "ask") : []),
		[view],
	);

	const answeredAsks = useMemo(
		() => (view ? view.answeredUi.filter(a => a.request.method === "ask") : []),
		[view],
	);

	const unanchoredReceipts = useMemo(
		() =>
			view
				? view.answeredUi.filter(
						a => a.request.method === "select" && (a.toolCallId === undefined || !rawToolIds.has(a.toolCallId)),
					)
				: [],
		[view, rawToolIds],
	);

	const openUrlRequests = useMemo<OpenUrlUiRequest[]>(
		() => (view ? view.pendingUi.filter((r): r is OpenUrlUiRequest => r.method === "open_url") : []),
		[view],
	);

	const procExitBanners = useMemo(
		() => (view ? view.banners.filter(b => b.kind === "proc-exit") : []),
		[view],
	);

	const tailBanners = useMemo(
		() => (view ? view.banners.filter(b => b.kind !== "proc-exit" && b.kind !== "compacting") : []),
		[view],
	);

	// Polite aria-live announcement for completed assistant messages only (§9.3)
	const politeAnnouncement = useMemo(() => {
		if (!view || view.messages.length === 0) return "";
		for (let i = view.messages.length - 1; i >= 0; i--) {
			const m = view.messages[i]!;
			if (m.role === "assistant") {
				const text = m.content
					.filter((b): b is { type: "text"; text: string } => b.type === "text")
					.map(b => b.text)
					.join(" ")
					.trim();
				if (text) return text.slice(0, 200);
			} else if (m.role === "user") {
				return extractUserMessageText(m.content).slice(0, 120);
			}
		}
		return "";
	}, [view?.messages.length]);

	// The live tail (last user message onward: the running turn and its drafts) renders in normal flow:
	// estimated-then-measured heights there would make the bottom, and the run indicator below it, jump.
	const tailStart = useMemo(() => {
		for (let i = preparedRows.length - 1; i >= 0; i--) {
			if (preparedRows[i]!.kind === "user") return i;
		}
		const firstDraft = preparedRows.findIndex(r => r.kind === "draft");
		return firstDraft >= 0 ? firstDraft : preparedRows.length;
	}, [preparedRows]);

	const virtualizer = useVirtualizer({
		count: tailStart,
		getScrollElement: () => scrollRef.current,
		getItemKey: index => preparedRows[index]?.key ?? index,
		estimateSize: index => {
			const row = preparedRows[index];
			if (!row) return 100;
			if (row.kind === "user") return 88;
			if (row.kind === "turn") return 220;
			if (row.kind === "draft") return 140;
			return 64;
		},
		overscan: 6,
		initialRect: { width: 760, height: 900 },
	});

	// Emit header hairline scroll signal and update auto-follow state
	const handleScroll = () => {
		const el = scrollRef.current;
		if (!el) return;
		const isScrolled = el.scrollTop > 4;
		if (isScrolled !== scrolledHeaderRef.current) {
			scrolledHeaderRef.current = isScrolled;
			onScrollStateChange?.(isScrolled);
			if (typeof window !== "undefined") {
				window.dispatchEvent(
					new CustomEvent<TranscriptScrollEventDetail>("transcript-scroll", {
						detail: { scrolled: isScrolled, sessionId },
					}),
				);
			}
		}
		const top = el.scrollTop;
		const distFromBottom = el.scrollHeight - top - el.clientHeight;
		// Content shrinking clamps scrollTop down; only an upward move at unchanged height is the user.
		const userScrolledUp = top < lastScrollTopRef.current - 1 && el.scrollHeight === lastScrollHeightRef.current;
		if (distFromBottom <= 2) stickRef.current = true;
		else if (userScrolledUp) stickRef.current = false;
		else if (distFromBottom <= 64 && top > lastScrollTopRef.current) stickRef.current = true; // scrolled back down
		lastScrollTopRef.current = top;
		lastScrollHeightRef.current = el.scrollHeight;
		setAtBottom(stickRef.current);
		if (stickRef.current) setHasUnreadBelow(false);
	};

	const scrollToBottom = (smooth = true) => {
		const el = scrollRef.current;
		if (!el) return;
		stickRef.current = true;
		if (typeof el.scrollTo === "function") {
			el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
		} else {
			el.scrollTop = el.scrollHeight;
		}
		setAtBottom(true);
		setHasUnreadBelow(false);
	};

	// "新消息" hint while scrolled up (following itself is driven by the ResizeObserver above)
	const contentVersion = useMemo(() => {
		if (!view) return 0;
		let draftLen = 0;
		for (const d of view.drafts.values()) {
			draftLen += d.content.length;
			for (const b of d.content) {
				if (b?.type === "text") draftLen += b.text.length;
				else if (b?.type === "thinking") draftLen += b.thinking.length;
			}
		}
		let streamLen = 0;
		for (const ex of view.toolExec.values()) {
			streamLen += ex.streamLog.length;
		}
		return view.messages.length * 1000 + draftLen + streamLen + view.pendingUi.length * 100 + view.banners.length * 10;
	}, [view]);

	const prevVersionRef = useRef(contentVersion);
	useEffect(() => {
		if (contentVersion === prevVersionRef.current) return;
		prevVersionRef.current = contentVersion;
		if (!stickRef.current) setHasUnreadBelow(true);
	}, [contentVersion]);

	// Listen for `scroll-to-tool` from SidePanel 变更 tab
	useEffect(() => {
		if (typeof window === "undefined") return;
		const handler = (e: Event) => {
			if (!(e instanceof CustomEvent) || !e.detail || typeof e.detail !== "object") return;
			const targetId = "toolCallId" in e.detail && typeof e.detail.toolCallId === "string" ? e.detail.toolCallId : undefined;
			if (!targetId) return;
			const rowIdx = preparedRows.findIndex(
				r => r.kind === "turn" && r.turn.tools.some(t => t.call.id === targetId),
			);
			if (rowIdx >= 0 && rowIdx < tailStart) {
				virtualizer.scrollToIndex(rowIdx, { align: "center" });
			} else {
				scrollRef.current
					?.querySelector(`[data-tool-call-id="${CSS.escape(targetId)}"]`)
					?.scrollIntoView({ block: "center" });
			}
			setFocusedToolCallId(targetId);
		};
		window.addEventListener("scroll-to-tool", handler);
		return () => window.removeEventListener("scroll-to-tool", handler);
	}, [preparedRows, virtualizer, tailStart]);

	if (!view) {
		return (
			<div ref={scrollRef} onScroll={handleScroll} className={"flex-1 overflow-auto min-h-0 " + (className ?? "")}>
				<EmptySession sessionId={sessionId} />
			</div>
		);
	}

	if (isColdStarting && showColdSkeleton) {
		return (
			<div ref={scrollRef} onScroll={handleScroll} className={"flex-1 overflow-auto min-h-0 " + (className ?? "")}>
				<LoadingSkeleton />
			</div>
		);
	}

	const isEmpty =
		preparedRows.length === 0 &&
		view.pendingUi.length === 0 &&
		view.banners.length === 0 &&
		view.run.kind === "idle";

	if (isEmpty) {
		return (
			<div ref={scrollRef} onScroll={handleScroll} className={"flex-1 overflow-auto min-h-0 " + (className ?? "")}>
				<EmptySession sessionId={sessionId} />
			</div>
		);
	}

	const isSessionRunning =
		view.run.kind === "running" ||
		view.run.kind === "settling" ||
		view.run.kind === "compacting" ||
		view.run.kind === "retrying" ||
		view.drafts.size > 0;

	const renderRowContent = (row: PreparedRow) => {
		if (row.kind === "user") {
			return (
				<UserMessageView
					sessionId={view.sessionId}
					message={row.message}
					userMessageIndex={row.userIndex}
					allUserMessages={allUserMessages}
					attachedFileMentions={row.attachedFileMentions}
				/>
			);
		}
		if (row.kind === "turn") {
			// The committed turn stays "running" while the next message of the same loop streams as a draft.
			const turnRunning = row.isLastTurn && isSessionRunning;
			return (
				<div className="my-6">
					<AssistantTurnView
						sessionId={view.sessionId}
						turn={row.turn}
						toolExec={view.toolExec}
						subagents={view.subagents}
						anchoredApprovals={anchored.byToolCallId}
						isTurnRunning={turnRunning}
						animateOnMount={row.animateOnMount}
						focusedToolCallId={focusedToolCallId}
					/>
				</div>
			);
		}
		if (row.kind === "draft") {
			return (
				<div className="my-6">
					<DraftTurnView
						sessionId={view.sessionId}
						draft={row.draft}
						toolExec={view.toolExec}
						subagents={view.subagents}
						anchoredApprovals={anchored.byToolCallId}
						focusedToolCallId={focusedToolCallId}
					/>
				</div>
			);
		}
		return <StandaloneMessageView message={row.message} />;
	};

	const virtualItems = virtualizer.getVirtualItems();
	const useVirtual = virtualItems.length > 0;

	return (
		<div className={"relative flex flex-1 flex-col min-h-0 " + (className ?? "")}>
			<div
				ref={scrollRef}
				onScroll={handleScroll}
				onWheel={e => {
					// Wheel-up intent unsticks before the next content resize can re-pin the view.
					if (e.deltaY < 0) stickRef.current = false;
				}}
				className="scroll flex-1 overflow-auto min-h-0"
			>
				<div ref={contentRef} className="col mx-auto max-w-[820px] px-6 pt-4 pb-[180px]">
					{procExitBanners.length > 0 && (
						<TranscriptBanners sessionId={view.sessionId} banners={procExitBanners} />
					)}

					{useVirtual ? (
						<div
							style={{
								height: `${virtualizer.getTotalSize()}px`,
								width: "100%",
								position: "relative",
							}}
						>
							{virtualItems.map(vItem => {
								const row = preparedRows[vItem.index];
								if (!row) return null;
								return (
									<div
										key={row.key}
										data-index={vItem.index}
										ref={virtualizer.measureElement}
										style={{
											position: "absolute",
											top: 0,
											left: 0,
											width: "100%",
											transform: `translateY(${vItem.start}px)`,
										}}
									>
										{renderRowContent(row)}
									</div>
								);
							})}
						</div>
					) : (
						<div>
							{preparedRows.slice(0, tailStart).map(row => (
								<div key={row.key}>{renderRowContent(row)}</div>
							))}
						</div>
					)}

					{preparedRows.slice(tailStart).map(row => (
						<div key={row.key}>{renderRowContent(row)}</div>
					))}

					{/* Unanchored approval cards (fallback when no matching running tool call) */}
					{anchored.unanchored.map(appr => (
						<ApprovalCard key={appr.requestId} sessionId={view.sessionId} approval={appr} />
					))}

					{/* Answered approvals that have no tool row to sit under */}
					{unanchoredReceipts.map(a => (
						<ApprovalReceipt key={a.request.id} state={approvalReceiptKind(a)} />
					))}

					{/* Answered asks stay as a compact receipt for the session's lifetime (§6.8) */}
					{answeredAsks.map(a => (
						<AskSummary key={a.request.id} lines={askSummaryLines(a)} />
					))}

					{/* Inline AskCard requests */}
					{askRequests.map(req => (
						<AskCard key={req.id} sessionId={view.sessionId} request={req} />
					))}

					{/* Inline OpenUrlCard requests */}
					{openUrlRequests.map(req => (
						<OpenUrlCard
							key={req.id}
							url={req.url}
							launchUrl={req.launchUrl}
							instructions={req.instructions}
						/>
					))}

					{/* Tail banners: retry countdown, prompt error, compaction error */}
					{tailBanners.length > 0 && (
						<TranscriptBanners sessionId={view.sessionId} banners={tailBanners} />
					)}

					{/* §6.11 RunIndicator at the end of the transcript */}
					<RunIndicator view={view} />
				</div>
			</div>

			{/* §6.18 Back-to-bottom / "新消息" floating button (the arrow icon is the only arrow) */}
			{!atBottom && (
				<button
					type="button"
					aria-label={hasUnreadBelow ? "新消息" : "回到底部"}
					onClick={() => scrollToBottom(true)}
					className={
						"anim-pop-in absolute bottom-[136px] left-1/2 z-20 -translate-x-1/2 flex h-8 items-center justify-center gap-1.5 rounded-pill bg-surface shadow-raised text-[12px] font-medium text-ink transition-transform active:scale-96 hover:bg-hover " +
						(hasUnreadBelow ? "px-3" : "w-8")
					}
				>
					<ArrowDown size={15} strokeWidth={2} className="i text-ink-2" />
					{hasUnreadBelow && (
						<>
							<span>新消息</span>
							<span className="size-1.5 rounded-full bg-accent" />
						</>
					)}
				</button>
			)}

			{/* §9.3 Polite screen-reader region for completed messages */}
			<div aria-live="polite" className="sr-only">
				{politeAnnouncement}
			</div>
		</div>
	);
}
