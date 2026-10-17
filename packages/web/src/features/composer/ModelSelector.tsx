import type { ModelInfo, SessionState, ThinkingLevel } from "@omp-ui/protocol";
import { AlertTriangle, Check, ChevronDown, ChevronLeft, ChevronRight, Image as ImageIcon, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/Popover";
import { Switch } from "@/ui/Switch";
import { useSlidingHighlight } from "@/ui/sliding-highlight";
import {
	THINKING_LABELS,
	filterModels,
	formatContextWindow,
	formatUsageLimitWarning,
	groupModelsByProvider,
	modelButtonLabel,
	shortModelName,
} from "./logic";

export const DEFAULT_THINKING_LEVELS: ThinkingLevel[] = ["inherit", "off", "minimal", "low", "medium", "high", "xhigh"];

/** Segment order for the thinking row: "自动" first, then whatever the session reports. */
export function thinkingSegments(levels: readonly ThinkingLevel[]): ThinkingLevel[] {
	const base = levels.length > 0 ? levels.filter(l => l !== "inherit") : DEFAULT_THINKING_LEVELS.filter(l => l !== "inherit");
	return ["inherit", ...base];
}

export interface ModelMenuPanelProps {
	models: readonly ModelInfo[];
	currentModel?: ModelInfo | null;
	state?: SessionState | null;
	onSelectModel: (model: ModelInfo) => void;
	onToggleFastMode?: (enabled: boolean) => void;
	onToggleSlowMode?: (enabled: boolean) => void;
	initialQuery?: string;
	/** Levels offered by `get_available_thinking_levels`; empty = the default ladder. */
	thinkingLevels?: readonly ThinkingLevel[];
	currentThinking?: ThinkingLevel;
	/** When set, the thinking segmented row is rendered under the model list. */
	onSelectThinking?: (level: ThinkingLevel) => void;
}

/**
 * FRONTEND §6.14 Model menu: usage-limit warning -> search -> two-level list (providers, then that
 * provider's 30px model rows: name 12.5/500, context window, image icon, check on the current one;
 * a non-empty query or a single provider shows models directly) -> thinking segmented row
 * -> fast/slow switches (only when supported). Picking a model does not close the menu.
 */
export function ModelMenuPanel({
	models,
	currentModel,
	state,
	onSelectModel,
	onToggleFastMode,
	onToggleSlowMode,
	initialQuery = "",
	thinkingLevels = [],
	currentThinking,
	onSelectThinking,
}: ModelMenuPanelProps) {
	const [query, setQuery] = useState(initialQuery);
	// Start on the current model's provider; the back row returns to the provider list.
	const [openProvider, setOpenProvider] = useState<string | null>(currentModel?.provider ?? null);
	const hl = useSlidingHighlight<HTMLDivElement>({ variant: "menu" });
	const searching = query.trim().length > 0;
	const allGroups = groupModelsByProvider(models);
	const groups = searching
		? groupModelsByProvider(filterModels(models, query))
		: allGroups.length === 1
			? allGroups
			: allGroups.filter(g => g.provider === openProvider);
	// Unknown/stale openProvider (e.g. current model's provider absent) falls back to the provider list.
	const showProviders = !searching && allGroups.length > 1 && groups.length === 0;
	const usageWarning = formatUsageLimitWarning(state?.usageLimit);
	const fastSupported = state?.fastModeEnabled !== undefined || state?.fastModeActive !== undefined;
	const currentKey = currentModel ? `${currentModel.provider}/${currentModel.id}` : null;

	useEffect(() => {
		const id = requestAnimationFrame(() => hl.onPointerLeave());
		return () => cancelAnimationFrame(id);
	}, [query, openProvider, groups.length, currentModel?.id, hl.onPointerLeave]);

	return (
		<div className="flex w-full min-w-[280px] flex-col text-[12.5px] text-ink">
			{usageWarning && (
				<div className="mx-1 mt-1 mb-1 flex items-center gap-1.5 rounded-[6px] bg-orange-tint px-2 py-1.5 text-[11.5px] text-orange-ink">
					<AlertTriangle size={13} strokeWidth={2} className="shrink-0 text-orange" />
					<span className="min-w-0 flex-1 truncate">{usageWarning}</span>
				</div>
			)}

			<label className="flex h-8 items-center gap-2 border-b border-line px-2.5 text-ink-3">
				<Search size={12} strokeWidth={2} className="shrink-0" />
				<input
					data-bare=""
					type="text"
					value={query}
					onChange={e => setQuery(e.target.value)}
					placeholder="搜索模型…"
					aria-label="搜索模型"
					className="min-w-0 flex-1 bg-transparent text-[12.5px] text-ink outline-none placeholder:text-ink-3"
				/>
			</label>

			<div
				ref={hl.containerRef}
				onPointerOver={hl.onPointerOver}
				onFocus={hl.onFocus}
				onPointerLeave={hl.onPointerLeave}
				className="relative max-h-[320px] overflow-y-auto py-1"
			>
				{hl.highlightBlock}
				{showProviders ? (
					allGroups.map(group => {
						const current = group.models.find(m => `${m.provider}/${m.id}` === currentKey);
						return (
							<button
								key={group.provider}
								type="button"
								data-hl-item=""
								{...(current ? { "data-hl-active": "" } : {})}
								onClick={() => setOpenProvider(group.provider)}
								className={
									"relative z-10 flex h-[30px] w-full items-center gap-1.5 rounded-[6px] px-2 text-left " +
									(current ? "bg-hover/60" : "")
								}
							>
								<span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-ink">{group.provider}</span>
								{current && (
									<span className="max-w-[120px] shrink truncate text-[11px] text-ink-2">
										{shortModelName(current, current.name)}
									</span>
								)}
								<span className="shrink-0 font-mono text-[11px] text-ink-3">{group.models.length}</span>
								<ChevronRight size={13} strokeWidth={2.2} className="shrink-0 text-ink-3" />
							</button>
						);
					})
				) : groups.length === 0 ? (
					<div className="relative z-10 flex h-[30px] items-center px-2 text-[12px] text-ink-2">没有匹配的模型</div>
				) : (
					groups.map(group => (
						<div key={group.provider}>
							{!searching && allGroups.length > 1 ? (
								<button
									type="button"
									onClick={() => setOpenProvider(null)}
									aria-label="返回供应商列表"
									className="relative z-10 flex h-[26px] w-full items-center gap-1 rounded-[6px] px-1.5 text-left text-[11px] font-medium tracking-[0.08em] text-ink-3 uppercase hover:text-ink-2"
								>
									<ChevronLeft size={13} strokeWidth={2.2} className="shrink-0" />
									{group.provider}
								</button>
							) : (
								<div className="px-2 pt-2 pb-1 text-[10.5px] font-medium tracking-[0.08em] text-ink-3 uppercase">
									{group.provider}
								</div>
							)}
							{group.models.map(model => {
								const current = `${model.provider}/${model.id}` === currentKey;
								const ctxLabel = formatContextWindow(model.contextWindow);
								const supportsImage = Array.isArray(model.input) && model.input.includes("image");
								return (
									<button
										key={`${model.provider}/${model.id}`}
										type="button"
										data-hl-item=""
										{...(current ? { "data-hl-active": "" } : {})}
										onClick={() => onSelectModel(model)}
										className={
											"relative z-10 flex h-[30px] w-full items-center gap-1.5 rounded-[6px] px-2 text-left " +
											(current ? "bg-hover/60" : "")
										}
									>
										<span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-ink">
											{shortModelName(model, model.name)}
										</span>
										{ctxLabel && <span className="shrink-0 font-mono text-[11px] text-ink-2">{ctxLabel}</span>}
										{supportsImage && (
											<span className="inline-flex shrink-0 items-center text-ink-2" title="支持图片输入">
												<ImageIcon size={12} strokeWidth={1.8} />
											</span>
										)}
										<span className="inline-flex w-4 shrink-0 items-center justify-end text-ink">
											{current && <Check size={13} strokeWidth={2.4} />}
										</span>
									</button>
								);
							})}
						</div>
					))
				)}
			</div>

			{onSelectThinking && (
				<div className="border-t border-line px-2 pt-2 pb-1.5">
					<div className="pb-1 text-[10.5px] font-medium tracking-[0.08em] text-ink-3 uppercase">思考</div>
					<div role="radiogroup" aria-label="思考级别" className="flex h-7 items-stretch gap-0.5">
						{thinkingSegments(thinkingLevels).map(level => {
							const selected = (currentThinking ?? "inherit") === level;
							return (
								<button
									key={level}
									type="button"
									role="radio"
									aria-checked={selected}
									onClick={() => onSelectThinking(level)}
									className={
										"min-w-0 flex-1 truncate rounded-[6px] px-0.5 text-[12px] transition-colors duration-100 active:scale-[0.96] " +
										(selected ? "bg-field font-medium text-ink" : "text-ink-2 hover:text-ink")
									}
								>
									{THINKING_LABELS[level] ?? level}
								</button>
							);
						})}
					</div>
				</div>
			)}

			{(fastSupported || state?.slowModeSupported) && (
				<div className="border-t border-line pt-1">
					{fastSupported && (
						<div className="flex h-[30px] items-center justify-between px-2 text-[12px] text-ink-2">
							<span>快速模式 (Fast)</span>
							<Switch checked={Boolean(state?.fastModeEnabled)} onCheckedChange={onToggleFastMode} label="快速模式" />
						</div>
					)}
					{state?.slowModeSupported && (
						<div className="flex h-[30px] items-center justify-between px-2 text-[12px] text-ink-2">
							<span>
								慢速通道 (Slow)
								{state.slowModeScope === "global" ? " · 全局" : ""}
							</span>
							<Switch checked={Boolean(state.slowModeEnabled)} onCheckedChange={onToggleSlowMode} label="慢速通道" />
						</div>
					)}
				</div>
			)}
		</div>
	);
}

export interface ModelThinkingButtonProps extends Omit<ModelMenuPanelProps, "initialQuery"> {
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
	disabled?: boolean;
	/** Configured default (`provider/id`), shown while no model is resolved yet (welcome composer). */
	defaultModel?: string;
}

/**
 * FRONTEND §6.12 merged model·thinking button: short model name 13/500 ink + thinking level 13 ink-2
 * ("高", "自动" when auto) + chevron. Opens the model menu; thinking lives at the bottom of that menu.
 */
export function ModelThinkingButton({
	open,
	onOpenChange,
	disabled,
	defaultModel,
	...panel
}: ModelThinkingButtonProps) {
	const [internalOpen, setInternalOpen] = useState(false);
	const isOpen = open ?? internalOpen;
	const setOpen = onOpenChange ?? setInternalOpen;

	const modelLabel = modelButtonLabel(panel.currentModel ?? panel.state?.model, defaultModel);
	const thinkingLabel = THINKING_LABELS[panel.currentThinking ?? "inherit"] ?? panel.currentThinking ?? "";

	return (
		<Popover open={isOpen} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<button
					type="button"
					disabled={disabled}
					aria-label={`模型：${modelLabel}，思考：${thinkingLabel}`}
					className={
						"inline-flex h-7 min-w-0 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-control px-2 text-[13px] " +
						"transition-[background-color_0.15s,transform_0.2s] hover:bg-hover active:scale-[0.94] " +
						(disabled ? "pointer-events-none opacity-35" : "")
					}
				>
					<span className="max-w-[160px] truncate font-medium text-ink">{modelLabel}</span>
					<span className="shrink-0 whitespace-nowrap text-ink-2">{thinkingLabel}</span>
					<ChevronDown size={11} strokeWidth={2.4} className="text-ink-3" />
				</button>
			</PopoverTrigger>
			<PopoverContent side="top" align="end" padding="tight" className="w-[300px] origin-bottom-right">
				<ModelMenuPanel {...panel} currentModel={panel.currentModel ?? panel.state?.model} />
			</PopoverContent>
		</Popover>
	);
}
