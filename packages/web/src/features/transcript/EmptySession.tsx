/**
 * EmptySession welcome view (FRONTEND §6.3).
 * - Centered column at top 32vh
 * - Koboyo 48px hand-drawn SVG illustration (ink-3)
 * - Heading "今天做点什么？" 22/600
 * - No project row: the project lives on the composer's context strip (§6.3, §6.12)
 * - Optional children slot (for inline Composer when mounted inside EmptySession)
 * - 3 follow-up suggestions (recent user prompts for that cwd from store sessions/views,
 *   falling back to the fixed 3 prompts). Clicking a suggestion calls `sendPrompt`.
 */
import { CornerDownRight } from "lucide-react";
import type { ReactNode } from "react";
import { resolveSessionConfig } from "../composer/new-session-config";
import { useAppStore } from "../../store/app-store";
import type { SessionView } from "../../store/session-reducer";
import { extractUserMessageText } from "./branch-match";

export const DEFAULT_SUGGESTIONS: readonly [string, string, string] = [
	"解释这个仓库的结构",
	"找出并修复失败的测试",
	"审查未提交的改动",
];

export interface EmptySessionProps {
	sessionId?: string | null;
	cwd?: string | null;
	children?: ReactNode;
}

/**
 * Collect up to 3 recent unique user prompts for the target `cwd` from loaded
 * session views in the store, falling back to `DEFAULT_SUGGESTIONS`.
 */
export function selectSuggestionsForCwd(
	cwd: string | null | undefined,
	sessions: ReadonlyArray<{ id: string; cwd: string }>,
	views: Record<string, SessionView>,
): string[] {
	const recent: string[] = [];
	const seen = new Set<string>();

	const matchingSessions = cwd
		? sessions.filter(s => s.cwd === cwd)
		: sessions;

	for (const sess of matchingSessions) {
		const v = views[sess.id];
		if (!v) continue;
		for (let i = v.messages.length - 1; i >= 0; i--) {
			const m = v.messages[i]!;
			if (m.role === "user" && !m.synthetic) {
				const text = extractUserMessageText(m.content).trim().replace(/\s+/g, " ");
				if (text.length > 0 && text.length <= 80 && !seen.has(text)) {
					seen.add(text);
					recent.push(text);
					if (recent.length >= 3) return recent;
				}
			}
		}
	}

	for (const fallback of DEFAULT_SUGGESTIONS) {
		if (recent.length >= 3) break;
		if (!seen.has(fallback)) {
			seen.add(fallback);
			recent.push(fallback);
		}
	}
	return recent.slice(0, 3);
}

export function EmptySession({ sessionId = null, cwd: cwdProp, children }: EmptySessionProps) {
	const sessions = useAppStore(s => s.sessions);
	const projects = useAppStore(s => s.projects);
	const views = useAppStore(s => s.views);
	const config = useAppStore(s => s.config);
	const pendingSession = useAppStore(s => s.pendingSession);
	const sendPrompt = useAppStore(s => s.sendPrompt);
	const newSessionFromPending = useAppStore(s => s.newSessionFromPending);

	const sessionItem = sessionId ? sessions.find(s => s.id === sessionId) : undefined;
	const resolvedCwd = cwdProp ?? sessionItem?.cwd ?? resolveSessionConfig(pendingSession, config, projects).cwd;
	const suggestions = selectSuggestionsForCwd(resolvedCwd, sessions, views);

	const handleSelectSuggestion = async (promptText: string) => {
		if (sessionId) {
			await sendPrompt(sessionId, promptText);
			return;
		}
		try {
			const createdId = await newSessionFromPending();
			if (createdId) await sendPrompt(createdId, promptText);
		} catch {
			/* ignore when bridge is offline in preview/gallery */
		}
	};

	return (
		<div className="mx-auto max-w-[820px] px-6 pt-[32vh] pb-24">
			{/* §6.3 Koboyo 48px hand-drawn illustration (ink-3) */}
			<svg
				width={48}
				height={48}
				viewBox="0 0 48 48"
				fill="none"
				stroke="currentColor"
				strokeWidth={1.6}
				strokeLinecap="round"
				strokeLinejoin="round"
				aria-hidden="true"
				className="text-ink-3"
			>
				<path d="M10 33c2-9 5-17 14-19 8-2 14 4 13 11-1 6-7 9-12 8" />
				<path d="M25 33c-1 3-1 6 1 8" />
				<path d="M19 22c1-1 2-1 3 0M28 21c1-1 2-1 3 0" />
				<path d="M14 38c4 2 9 3 14 2" />
			</svg>

			<h1 className="mt-4 mb-0 text-[22px] leading-[1.3] font-semibold tracking-[-0.01em] text-ink">
				今天做点什么？
			</h1>

			{children && <div className="mt-6">{children}</div>}

			<div className="mt-5">
				{suggestions.map((text, idx) => (
					<button
						key={text}
						type="button"
						onClick={() => void handleSelectSuggestion(text)}
						style={{ animationDelay: `${idx * 90}ms` }}
						className="-mx-1.5 flex h-8 w-[calc(100%+12px)] items-center gap-2 rounded-[7px] border-b border-line px-1.5 text-left text-[12.5px] text-ink transition-colors duration-100 hover:bg-hover-2 animate-[fade-up_0.35s_var(--ease-out-strong)_both]"
					>
						<CornerDownRight size={11} strokeWidth={2} className="i shrink-0 text-ink-3" />
						<span className="truncate">{text}</span>
					</button>
				))}
			</div>
		</div>
	);
}
