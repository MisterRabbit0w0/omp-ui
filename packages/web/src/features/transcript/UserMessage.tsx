/**
 * UserMessage component (FRONTEND §6.4, DESIGN §9.3, verified protocol rules #3 & #5).
 * - Right-aligned bubble (`bg-field`, radius 14, padding 8/14, 14.5/1.65)
 * - Above bubble: 64×64 image thumbnails (click to enlarge in overlay dialog) +
 *   fileMention chips (from following `fileMention` message or `@path` tokens)
 * - Hover actions below bubble: Copy, Edit & Rewind (`get_entries` → walk `leafId`/`parentId` → `branch {entryId}` → `composerInsert`), Fork (`fork {entryId}`)
 * - Pending `message_end`: `opacity-60`
 * - Entry animation only when `animateOnMount === true`
 */
import type { FileMentionItem, ImageContent, UserMessage as ProtocolUserMessage } from "@omp-ui/protocol";
import { Check, Copy, FileText, GitBranch, PenLine } from "lucide-react";
import { useState } from "react";
import { useAppStore } from "../../store/app-store";
import { getBridge } from "../../store/bridge-access";
import { IconButton } from "../../ui/Button";
import { Chip } from "../../ui/Chip";
import { Dialog, DialogContent } from "../../ui/Dialog";
import { Icon } from "../../ui/Icon";
import {
	extractInlineFileMentions,
	extractUserMessageImages,
	extractUserMessageText,
	matchBranchEntry,
} from "./branch-match";

export interface UserMessageProps {
	sessionId: string;
	message: ProtocolUserMessage & { animateOnMount?: boolean };
	/** Ordinal index of this user message among all user messages in the transcript */
	userMessageIndex: number;
	allUserMessages: ReadonlyArray<Pick<ProtocolUserMessage, "content" | "synthetic">>;
	/** `fileMention` items from the immediately following `fileMention` message (verified protocol rule #5) */
	attachedFileMentions?: ReadonlyArray<FileMentionItem>;
	pending?: boolean;
}

export function UserMessageView({
	sessionId,
	message,
	userMessageIndex,
	allUserMessages,
	attachedFileMentions,
	pending = false,
}: UserMessageProps) {
	const [copied, setCopied] = useState(false);
	const [lightboxImage, setLightboxImage] = useState<ImageContent | null>(null);
	const [busyAction, setBusyAction] = useState(false);

	const pushToast = useAppStore(s => s.pushToast);

	const text = extractUserMessageText(message.content);
	const images = extractUserMessageImages(message.content);
	const inlineMentions = extractInlineFileMentions(text);

	// Merge explicit `fileMention` message items with any inline `@path` mentions
	const fileChipPaths: string[] = [];
	const seenPaths = new Set<string>();
	if (attachedFileMentions) {
		for (const f of attachedFileMentions) {
			if (f.path && !seenPaths.has(f.path)) {
				seenPaths.add(f.path);
				fileChipPaths.push(f.path);
			}
		}
	}
	for (const p of inlineMentions) {
		if (!seenPaths.has(p)) {
			seenPaths.add(p);
			fileChipPaths.push(p);
		}
	}

	const handleCopy = () => {
		if (typeof navigator !== "undefined" && navigator.clipboard) {
			void navigator.clipboard.writeText(text);
		}
		setCopied(true);
		setTimeout(() => setCopied(false), 1500);
	};

	const resolveEntryId = async (): Promise<string | undefined> => {
		const bridge = getBridge();
		try {
			const entriesRes = await bridge.rpc(sessionId, { type: "get_entries" });
			const matched = matchBranchEntry(allUserMessages, userMessageIndex, entriesRes);
			if (matched?.entryId) return matched.entryId;
		} catch {
			/* fall back to get_branch_messages if get_entries fails */
		}
		const branchMsgsRes = await bridge.rpc(sessionId, { type: "get_branch_messages" });
		const matched = matchBranchEntry(allUserMessages, userMessageIndex, branchMsgsRes.messages);
		return matched?.entryId;
	};

	const handleEditAndRewind = async () => {
		if (busyAction) return;
		setBusyAction(true);
		try {
			const entryId = await resolveEntryId();
			if (!entryId) {
				useAppStore.setState({
					composerInsert: { sessionId, text, at: Date.now() },
				});
				return;
			}
			const bridge = getBridge();
			const res = await bridge.rpc(sessionId, { type: "branch", entryId });
			if (!res.cancelled) {
				useAppStore.setState({
					composerInsert: { sessionId, text: res.text || text, at: Date.now() },
				});
				await useAppStore.getState().coldStart(sessionId);
			}
		} catch (err) {
			pushToast("error", err instanceof Error ? err.message : "无法从此处重来");
		} finally {
			setBusyAction(false);
		}
	};

	const handleFork = async () => {
		if (busyAction) return;
		setBusyAction(true);
		try {
			const entryId = await resolveEntryId();
			const bridge = getBridge();
			const res = await bridge.rpc(sessionId, {
				type: "fork",
				...(entryId ? { entryId } : {}),
			});
			if (!res.cancelled) {
				pushToast("info", "已分叉为新会话");
				await useAppStore.getState().loadSessions();
			}
		} catch (err) {
			pushToast("error", err instanceof Error ? err.message : "分叉失败");
		} finally {
			setBusyAction(false);
		}
	};

	return (
		<div
			className={
				"group/user my-6 flex flex-col items-end pl-16 " +
				(message.animateOnMount ? "anim-fade-up " : "") +
				(pending ? "opacity-60 " : "")
			}
		>
			{images.length > 0 && (
				<div className="mb-1.5 flex flex-wrap justify-end gap-1.5">
					{images.map((img, i) => (
						<button
							key={i}
							type="button"
							onClick={() => setLightboxImage(img)}
							className="size-16 overflow-hidden rounded-control shadow-hairline transition-transform hover:scale-[1.02] active:scale-96"
						>
							<img
								src={`data:${img.mimeType};base64,${img.data}`}
								alt="用户上传图片"
								className="size-full object-cover"
							/>
						</button>
					))}
				</div>
			)}

			{fileChipPaths.length > 0 && (
				<div className="mb-1.5 flex flex-wrap justify-end gap-1.5">
					{fileChipPaths.map(path => (
						<Chip
							key={path}
							mono
							icon={<Icon icon={FileText} size={12} className="shrink-0 text-ink-3" />}
						>
							{path}
						</Chip>
					))}
				</div>
			)}

			<div className="max-w-full rounded-bubble bg-field px-3.5 py-2 text-[14.5px] leading-[1.65] text-ink whitespace-pre-wrap break-words">
				{text}
			</div>

			<div className="mt-1 flex items-center gap-0.5 opacity-0 transition-opacity duration-150 group-hover/user:opacity-100 focus-within:opacity-100">
				<IconButton size="sm" label={copied ? "已复制" : "复制"} onClick={handleCopy}>
					{copied ? (
						<Check size={14} strokeWidth={2.4} className="i text-green" />
					) : (
						<Copy size={15} strokeWidth={1.8} className="i" />
					)}
				</IconButton>
				<IconButton
					size="sm"
					label="编辑并从这里重来"
					disabled={busyAction}
					onClick={() => void handleEditAndRewind()}
				>
					<PenLine size={15} strokeWidth={1.8} className="i" />
				</IconButton>
				<IconButton
					size="sm"
					label="从这里分叉"
					disabled={busyAction}
					onClick={() => void handleFork()}
				>
					<GitBranch size={15} strokeWidth={1.8} className="i" />
				</IconButton>
			</div>

			<Dialog open={lightboxImage !== null} onOpenChange={open => !open && setLightboxImage(null)}>
				<DialogContent title="图片预览" width={640}>
					{lightboxImage && (
						<img
							src={`data:${lightboxImage.mimeType};base64,${lightboxImage.data}`}
							alt="图片放大预览"
							className="mt-2 max-h-[75vh] w-full rounded-control object-contain"
						/>
					)}
				</DialogContent>
			</Dialog>
		</div>
	);
}
