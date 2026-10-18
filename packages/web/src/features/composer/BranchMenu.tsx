import type { GitBranchesResult } from "@omp-ui/protocol";
import { Check, ChevronDown, GitBranch, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { notifyGitChanged } from "@/lib/git-events";
import { getBridge } from "@/store/bridge-access";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/Popover";
import { useSlidingHighlight } from "@/ui/sliding-highlight";
import { toast } from "@/ui/Toast";

export interface BranchMenuButtonProps {
	/** Workspace directory. Null/empty hides the button. */
	cwd: string | null;
	/** A session in this workspace is running: the label stays visible but switching is blocked. */
	running?: boolean;
	disabled?: boolean;
}

/**
 * Git branch picker for the workspace (shown only when `cwd` is inside a git work tree). Lists local branches,
 * most recently committed first, and runs `git switch` through the bridge. Git's own refusal (e.g. local changes
 * that would be overwritten) is shown as a toast and the branch stays unchanged.
 */
export function BranchMenuButton({ cwd, running = false, disabled = false }: BranchMenuButtonProps) {
	const [open, setOpen] = useState(false);
	const [info, setInfo] = useState<GitBranchesResult | null>(null);
	const [query, setQuery] = useState("");
	const [switching, setSwitching] = useState<string | null>(null);
	const hl = useSlidingHighlight<HTMLDivElement>({ variant: "menu" });

	// A different workspace must never show the previous repo's branch, so drop the snapshot only on cwd change.
	useEffect(() => {
		setInfo(null);
	}, [cwd]);

	// Re-read when the workspace changes and whenever the menu opens (the terminal may have switched branches).
	// The previous snapshot stays rendered meanwhile so the button doesn't flicker; a failed refresh keeps it too.
	useEffect(() => {
		if (!cwd) return;
		let cancelled = false;
		getBridge()
			.http.getGitBranches(cwd)
			.then(next => {
				if (!cancelled) setInfo(next);
			})
			.catch(() => {
				// Keep the last good snapshot; the next open retries.
			});
		return () => {
			cancelled = true;
		};
	}, [cwd, open]);

	useEffect(() => {
		if (open) setQuery("");
	}, [open]);

	if (!cwd || !info?.repo) return null;

	const label = info.current ?? (info.detachedAt ? `HEAD ${info.detachedAt}` : "分离的 HEAD");
	const q = query.trim().toLowerCase();
	const rows = q ? info.branches.filter(name => name.toLowerCase().includes(q)) : info.branches;
	const blocked = disabled || running;

	const choose = async (branch: string) => {
		if (branch === info.current || switching) return;
		setSwitching(branch);
		try {
			setInfo(await getBridge().http.switchGitBranch(cwd, branch));
			setOpen(false);
			notifyGitChanged(cwd);
			toast(`已切换到 ${branch}`, "info");
		} catch (err) {
			toast(err instanceof Error ? err.message : "切换分支失败", "error");
		} finally {
			setSwitching(null);
		}
	};

	return (
		<Popover open={open && !blocked} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<button
					type="button"
					disabled={disabled}
					aria-label={`分支：${label}`}
					title={running ? "会话运行中，结束后可切换分支" : (info.root ?? cwd)}
					className={
						"inline-flex h-7 max-w-full items-center gap-1.5 rounded-control px-2 text-[13px] " +
						"transition-[background-color_0.15s,transform_0.2s] hover:bg-hover-2 active:scale-[0.96] " +
						(disabled ? "pointer-events-none opacity-35 " : "") +
						(running ? "opacity-60" : "")
					}
				>
					<GitBranch size={15} strokeWidth={1.8} className="shrink-0 text-ink-2" />
					<span className="min-w-0 truncate font-medium text-ink">{label}</span>
					<ChevronDown size={11} strokeWidth={2.4} className="shrink-0 text-ink-3" />
				</button>
			</PopoverTrigger>
			<PopoverContent side="bottom" align="start" padding="tight" className="w-[280px] origin-top-left">
				<label className="flex h-8 items-center gap-2 border-b border-line px-2.5 text-ink-3">
					<Search size={12} strokeWidth={2} className="shrink-0" />
					<input
						data-bare=""
						type="text"
						autoFocus
						value={query}
						onChange={e => setQuery(e.target.value)}
						placeholder="搜索分支"
						aria-label="搜索分支"
						className="min-w-0 flex-1 bg-transparent text-[12.5px] text-ink outline-none placeholder:text-ink-3"
					/>
				</label>
				<div
					ref={hl.containerRef}
					onPointerOver={hl.onPointerOver}
					onFocus={hl.onFocus}
					onPointerLeave={hl.onPointerLeave}
					role="menu"
					aria-label="分支"
					className="relative max-h-[280px] overflow-y-auto py-1"
				>
					{hl.highlightBlock}
					{rows.length === 0 && (
						<div className="relative z-10 flex h-9 items-center px-2 text-[12px] text-ink-2">没有匹配的分支</div>
					)}
					{rows.map(name => {
						const selected = name === info.current;
						return (
							<button
								key={name}
								type="button"
								role="menuitemradio"
								aria-checked={selected}
								disabled={switching !== null}
								data-hl-item=""
								{...(selected ? { "data-hl-active": "" } : {})}
								onClick={() => void choose(name)}
								className={
									"relative z-10 flex h-9 w-full items-center gap-2 rounded-[6px] px-2 text-left disabled:opacity-50 " +
									(selected ? "bg-hover/60" : "")
								}
							>
								<GitBranch size={14} strokeWidth={1.8} className="shrink-0 text-ink-2" />
								<span className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink">{name}</span>
								<span className="inline-flex w-4 shrink-0 items-center justify-end text-ink">
									{selected && <Check size={13} strokeWidth={2.4} />}
								</span>
							</button>
						);
					})}
				</div>
			</PopoverContent>
		</Popover>
	);
}
