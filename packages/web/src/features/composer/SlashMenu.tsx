import type { FileHit, SlashCommandSource } from "@omp-ui/protocol";
import {
	FileCode,
	FileText,
	GitBranch,
	Minimize2,
	Plug,
	ShieldAlert,
	Terminal,
	Wrench,
} from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { SparkleIcon } from "@/ui/Icon";
import { useSlidingHighlight } from "@/ui/sliding-highlight";
import { groupSlashCommands, type SlashMenuRow } from "./logic";

function slashCommandIcon(name: string, source: SlashCommandSource): ReactNode {
	const lower = name.toLowerCase();
	if (lower === "compact") return <Minimize2 size={15} strokeWidth={1.8} />;
	if (lower === "fork" || lower === "branch" || lower === "tree") return <GitBranch size={15} strokeWidth={1.8} />;
	if (lower.includes("security") || lower.includes("approval")) return <ShieldAlert size={14} strokeWidth={2} />;
	if (source === "skill" || lower === "commit") return <SparkleIcon size={15} />;
	if (source === "mcp_prompt") return <Plug size={14} strokeWidth={1.8} />;
	if (source === "extension") return <Wrench size={14} strokeWidth={1.8} />;
	if (source === "file") return <FileCode size={14} strokeWidth={1.8} />;
	return <Terminal size={14} strokeWidth={1.8} />;
}

export interface SlashMenuProps {
	rows: readonly SlashMenuRow[];
	selectedIndex: number;
	onHoverIndex: (index: number) => void;
	onSelect: (row: SlashMenuRow) => void;
	/** Render inline (non-absolute) for gallery showcase */
	inline?: boolean;
}

/**
 * FRONTEND §6.14 Slash menu:
 * Positioned 8px above Composer, same width as Composer, bg-surface,
 * shadow-raised, radius 10, padding 4, pop-in 180ms (origin bottom center),
 * max-height 320px. Grouped by source, shows hint & subcommands, sliding
 * highlight, and footer.
 */
export function SlashMenu({
	rows,
	selectedIndex,
	onHoverIndex,
	onSelect,
	inline = false,
}: SlashMenuProps) {
	const hl = useSlidingHighlight<HTMLDivElement>({ variant: "menu", restOnActive: true });
	const groups = groupSlashCommands(rows);

	useEffect(() => {
		const id = requestAnimationFrame(() => {
			hl.onPointerLeave();
			const activeEl = hl.containerRef.current?.querySelector("[data-hl-active]");
			if (activeEl instanceof HTMLElement && typeof activeEl.scrollIntoView === "function") {
				activeEl.scrollIntoView({ block: "nearest" });
			}
		});
		return () => cancelAnimationFrame(id);
	}, [selectedIndex, rows.length, hl.onPointerLeave]);

	let flatIdx = -1;

	return (
		<div
			role="listbox"
			aria-label="Slash 命令"
			className={
				(inline ? "relative w-full " : "absolute right-0 bottom-full left-0 z-30 mb-2 ") +
				"flex max-h-[320px] flex-col rounded-card bg-surface p-1 shadow-raised " +
				"origin-bottom animate-[pop-in_0.18s_var(--ease-out-strong)_both]"
			}
		>
			<div
				ref={hl.containerRef}
				onPointerOver={hl.onPointerOver}
				onFocus={hl.onFocus}
				onPointerLeave={hl.onPointerLeave}
				className="relative min-h-0 flex-1 overflow-y-auto"
			>
				{hl.highlightBlock}
				{rows.length === 0 ? (
					<div className="relative z-10 flex h-9 items-center px-2 text-[12.5px] text-ink-2">
						没有匹配的命令
					</div>
				) : (
					groups.map(group => (
						<div key={group.source}>
							{groups.length > 1 && (
								<div className="px-2 pt-1.5 pb-0.5 text-[10.5px] font-medium tracking-[0.08em] text-ink-3 uppercase">
									{group.label}
								</div>
							)}
							{group.items.map(row => {
								flatIdx += 1;
								const idx = flatIdx;
								const active = idx === selectedIndex;
								const subCount = !row.subcommand ? (row.command.subcommands?.length ?? 0) : 0;
								return (
									<button
										key={row.id}
										type="button"
										role="option"
										aria-selected={active}
										data-hl-item=""
										{...(active ? { "data-hl-active": "" } : {})}
										onMouseEnter={() => onHoverIndex(idx)}
										onMouseDown={e => {
											e.preventDefault();
											onSelect(row);
										}}
										className="relative z-10 flex h-9 w-full items-center gap-2.5 rounded-[6px] px-2 text-left"
									>
										<span className="inline-flex w-[22px] shrink-0 items-center justify-center text-ink-2">
											{slashCommandIcon(row.command.name, row.source)}
										</span>
										<span className="shrink-0 text-[12.5px] font-medium text-ink">
											{row.displayName}
										</span>
										{row.hint && (
											<span className="shrink-0 font-mono text-[11px] text-ink-3">
												{row.hint}
											</span>
										)}
										{subCount > 0 && (
											<span className="shrink-0 rounded-chip bg-field px-1.5 py-0.5 text-[10.5px] text-ink-2 shadow-hairline">
												{subCount} 子命令
											</span>
										)}
										<span className="min-w-0 flex-1 truncate text-[12px] text-ink-2">
											{row.description ?? ""}
										</span>
										<span className="shrink-0 text-[11px] text-ink-2">{row.sourceLabel}</span>
									</button>
								);
							})}
						</div>
					))
				)}
			</div>
			<div className="mt-1 border-t border-line px-2 pt-1.5 pb-1 text-[11px] text-ink-2">
				↑↓ 选择 · Enter 确认 · Esc 关闭
			</div>
		</div>
	);
}

export interface FileMentionMenuProps {
	files: readonly FileHit[];
	loading?: boolean;
	selectedIndex: number;
	onHoverIndex: (index: number) => void;
	onSelect: (hit: FileHit) => void;
	/** Show subtle warning that mid-run steer/follow_up does not expand @ mentions */
	isRunning?: boolean;
	/** Render inline (non-absolute) for gallery showcase */
	inline?: boolean;
}

/**
 * FRONTEND §6.14 @ file mention menu:
 * Row height 36px: file icon + file name 12.5/500 + directory mono 11.5 ink-2.
 */
export function FileMentionMenu({
	files,
	loading = false,
	selectedIndex,
	onHoverIndex,
	onSelect,
	isRunning = false,
	inline = false,
}: FileMentionMenuProps) {
	const hl = useSlidingHighlight<HTMLDivElement>({ variant: "menu", restOnActive: true });

	useEffect(() => {
		const id = requestAnimationFrame(() => {
			hl.onPointerLeave();
			const activeEl = hl.containerRef.current?.querySelector("[data-hl-active]");
			if (activeEl instanceof HTMLElement && typeof activeEl.scrollIntoView === "function") {
				activeEl.scrollIntoView({ block: "nearest" });
			}
		});
		return () => cancelAnimationFrame(id);
	}, [selectedIndex, files.length, hl.onPointerLeave]);

	return (
		<div
			role="listbox"
			aria-label="引用文件"
			className={
				(inline ? "relative w-full " : "absolute right-0 bottom-full left-0 z-30 mb-2 ") +
				"flex max-h-[320px] flex-col rounded-card bg-surface p-1 shadow-raised " +
				"origin-bottom animate-[pop-in_0.18s_var(--ease-out-strong)_both]"
			}
		>
			<div
				ref={hl.containerRef}
				onPointerOver={hl.onPointerOver}
				onFocus={hl.onFocus}
				onPointerLeave={hl.onPointerLeave}
				className="relative min-h-0 flex-1 overflow-y-auto"
			>
				{hl.highlightBlock}
				{files.length === 0 ? (
					<div className="relative z-10 flex h-9 items-center px-2 text-[12.5px] text-ink-2">
						{loading ? "正在搜索文件…" : "没有匹配的文件"}
					</div>
				) : (
					files.map((hit, idx) => {
						const active = idx === selectedIndex;
						return (
							<button
								key={hit.path}
								type="button"
								role="option"
								aria-selected={active}
								data-hl-item=""
								{...(active ? { "data-hl-active": "" } : {})}
								onMouseEnter={() => onHoverIndex(idx)}
								onMouseDown={e => {
									e.preventDefault();
									onSelect(hit);
								}}
								className="relative z-10 flex h-9 w-full items-center gap-2.5 rounded-[6px] px-2 text-left"
							>
								<span className="inline-flex w-[22px] shrink-0 items-center justify-center text-ink-2">
									<FileText size={14} strokeWidth={1.8} />
								</span>
								<span className="shrink-0 text-[12.5px] font-medium text-ink">{hit.name}</span>
								<span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-ink-2">
									{hit.dir || "."}
								</span>
							</button>
						);
					})
				)}
			</div>
			<div className="mt-1 flex items-center justify-between gap-2 border-t border-line px-2 pt-1.5 pb-1 text-[11px] text-ink-2">
				<span>↑↓ 选择 · Enter 确认 · Esc 关闭</span>
				{isRunning && <span className="text-orange-ink">运行中发送的 @ 引用不会展开</span>}
			</div>
		</div>
	);
}
