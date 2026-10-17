import type { ProjectItem } from "@omp-ui/protocol";
import { Check, ChevronDown, Folder, FolderOpen, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { HttpError } from "@/lib/http";
import { getBridge } from "@/store/bridge-access";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/Popover";
import { useSlidingHighlight } from "@/ui/sliding-highlight";
import { filterRecentProjects, projectDisplayName } from "./new-session-config";

export interface ProjectMenuButtonProps {
	/** Selected project directory; null = none chosen yet. */
	cwd: string | null;
	projects: readonly ProjectItem[];
	onSelect: (cwd: string) => void;
	disabled?: boolean;
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
}

/**
 * FRONTEND §6.12 / §6.14 project button + menu: `Folder` icon, project name 13/500, chevron. The menu has a
 * search box, up to 8 recent projects (most recent first) and a 选择文件夹… row. When the bridge cannot show a
 * native picker (501) the search box turns into a path input whose value the bridge validates.
 */
export function ProjectMenuButton({ cwd, projects, onSelect, disabled, open, onOpenChange }: ProjectMenuButtonProps) {
	const [internalOpen, setInternalOpen] = useState(false);
	const isOpen = open ?? internalOpen;
	const setOpen = onOpenChange ?? setInternalOpen;
	const [query, setQuery] = useState("");
	const [pathMode, setPathMode] = useState(false);
	const [checking, setChecking] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const hl = useSlidingHighlight<HTMLDivElement>({ variant: "menu" });

	const rows = filterRecentProjects(projects, pathMode ? "" : query, cwd);
	const name = projectDisplayName(cwd);

	useEffect(() => {
		if (isOpen) return;
		setQuery("");
		setPathMode(false);
		setError(null);
	}, [isOpen]);

	useEffect(() => {
		const id = requestAnimationFrame(() => hl.onPointerLeave());
		return () => cancelAnimationFrame(id);
	}, [query, rows.length, cwd, hl.onPointerLeave]);

	const choose = (next: string) => {
		onSelect(next);
		setOpen(false);
	};

	const pickFolder = async () => {
		setError(null);
		try {
			const res = await getBridge().http.pickDir();
			if (res.path) choose(res.path);
		} catch (err) {
			if (err instanceof HttpError && err.status === 501) {
				setPathMode(true);
				setQuery("");
				return;
			}
			setError(err instanceof Error ? err.message : "无法打开文件夹选择器");
		}
	};

	const confirmTypedPath = async () => {
		const typed = query.trim();
		if (typed.length === 0 || checking) return;
		setChecking(true);
		try {
			const res = await getBridge().http.dirExists(typed);
			if (res.exists && res.isDir) choose(typed);
			else setError(res.exists ? "这不是一个文件夹" : "目录不存在");
		} catch (err) {
			setError(err instanceof Error ? err.message : "无法校验目录");
		} finally {
			setChecking(false);
		}
	};

	return (
		<Popover open={isOpen} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<button
					type="button"
					disabled={disabled}
					aria-label={name ? `项目：${name}` : "选择项目"}
					title={cwd ?? undefined}
					className={
						"inline-flex h-7 max-w-full items-center gap-1.5 rounded-control px-2 text-[13px] " +
						"transition-[background-color_0.15s,transform_0.2s] hover:bg-hover-2 active:scale-[0.96] " +
						(disabled ? "pointer-events-none opacity-35" : "")
					}
				>
					<Folder size={15} strokeWidth={1.8} className="shrink-0 text-ink-2" />
					<span className={"min-w-0 truncate font-medium " + (name ? "text-ink" : "text-ink-2")}>{name || "选择项目"}</span>
					<ChevronDown size={11} strokeWidth={2.4} className="shrink-0 text-ink-3" />
				</button>
			</PopoverTrigger>
			<PopoverContent side="bottom" align="start" padding="tight" className="w-[320px] origin-top-left">
				<label className="flex h-8 items-center gap-2 border-b border-line px-2.5 text-ink-3">
					<Search size={12} strokeWidth={2} className="shrink-0" />
					<input
						data-bare=""
						type="text"
						autoFocus
						value={query}
						onChange={e => {
							setQuery(e.target.value);
							setError(null);
						}}
						onKeyDown={e => {
							if (e.key === "Enter" && pathMode) {
								e.preventDefault();
								void confirmTypedPath();
							}
						}}
						placeholder={pathMode ? "输入项目目录的绝对路径，回车确认" : "搜索项目"}
						aria-label={pathMode ? "项目目录路径" : "搜索项目"}
						className="min-w-0 flex-1 bg-transparent text-[12.5px] text-ink outline-none placeholder:text-ink-3"
					/>
				</label>
				{error && (
					<div role="alert" className="px-2.5 pt-1.5 text-[11.5px] text-red-ink">
						{error}
					</div>
				)}

				<div
					ref={hl.containerRef}
					onPointerOver={hl.onPointerOver}
					onFocus={hl.onFocus}
					onPointerLeave={hl.onPointerLeave}
					className="relative py-1"
				>
					{hl.highlightBlock}
					{!pathMode && (
						<>
							<div className="px-2 pt-1 pb-1 text-[10.5px] font-medium tracking-[0.08em] text-ink-3 uppercase">最近</div>
							{rows.length === 0 && (
								<div className="relative z-10 flex h-9 items-center px-2 text-[12px] text-ink-2">没有匹配的项目</div>
							)}
							{rows.map(project => {
								const selected = project.cwd === cwd;
								return (
									<button
										key={project.cwd}
										type="button"
										data-hl-item=""
										{...(selected ? { "data-hl-active": "" } : {})}
										onClick={() => choose(project.cwd)}
										className={
											"relative z-10 flex h-9 w-full items-center gap-2 rounded-[6px] px-2 text-left " +
											(selected ? "bg-hover/60" : "")
										}
									>
										<Folder size={14} strokeWidth={1.8} className="shrink-0 text-ink-2" />
										<span className="shrink-0 text-[12.5px] font-medium text-ink">{project.name || projectDisplayName(project.cwd)}</span>
										<span dir="rtl" className="min-w-0 flex-1 truncate text-left font-mono text-[11.5px] text-ink-2">
											<bdi>{project.cwd}</bdi>
										</span>
										<span className="inline-flex w-4 shrink-0 items-center justify-end text-ink">
											{selected && <Check size={13} strokeWidth={2.4} />}
										</span>
									</button>
								);
							})}
						</>
					)}
				</div>

				<div className="border-t border-line pt-1">
					<button
						type="button"
						onClick={() => void pickFolder()}
						className="flex h-9 w-full items-center gap-2 rounded-[6px] px-2 text-left text-[12.5px] text-ink hover:bg-hover-2"
					>
						<FolderOpen size={14} strokeWidth={1.8} className="shrink-0 text-ink-2" />
						<span>选择文件夹…</span>
					</button>
				</div>
			</PopoverContent>
		</Popover>
	);
}
