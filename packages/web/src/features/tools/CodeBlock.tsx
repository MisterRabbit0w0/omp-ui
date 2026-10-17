/**
 * CodeBlock component (FRONTEND §6.10).
 * Supports Shiki syntax highlighting with custom omp-light/omp-dark themes,
 * line numbers (>5 lines), copy with 1.5s check feedback, wrap toggle,
 * max-height scroll + expand, and streaming cursor.
 */
import { Check, Copy, WrapText } from "lucide-react";
import { useState } from "react";
import { Card, CardBar } from "../../ui/Card";
import { DISPLAY_LANGUAGE_NAMES, normalizeLanguage, useHighlightedLines } from "./shiki";

export interface CodeBlockProps {
	code: string;
	language?: string;
	filename?: string;
	showHeader?: boolean;
	maxHeight?: number;
	streaming?: boolean;
	defaultWrap?: boolean;
	className?: string;
}

export function CodeBlock({
	code,
	language,
	filename,
	showHeader = true,
	maxHeight = 480,
	streaming = false,
	defaultWrap = false,
	className,
}: CodeBlockProps) {
	const [copied, setCopied] = useState(false);
	const [wrap, setWrap] = useState(defaultWrap);
	const [expanded, setExpanded] = useState(false);

	const cleanCode = code.endsWith("\n") ? code.slice(0, -1) : code;
	const tokensByLine = useHighlightedLines(cleanCode, language, filename);
	const showLineNumbers = tokensByLine.length > 5;
	const normLang = normalizeLanguage(language, filename);
	const langDisplay = DISPLAY_LANGUAGE_NAMES[normLang] ?? (normLang === "text" ? "" : normLang);
	const primaryTitle = filename ?? (normLang !== "text" ? normLang : "text");
	const secondaryTitle = filename ? langDisplay : langDisplay !== primaryTitle ? langDisplay : "";
	const canExpand = !expanded && tokensByLine.length > 28;

	const handleCopy = () => {
		if (typeof navigator !== "undefined" && navigator.clipboard) {
			void navigator.clipboard.writeText(cleanCode);
		}
		setCopied(true);
		setTimeout(() => setCopied(false), 1500);
	};

	const body = (
		<div className="relative">
			<div
				style={{ maxHeight: expanded ? undefined : maxHeight }}
				className={
					"bg-inset px-3 py-2.5 mono text-[12.5px] leading-[1.7] overflow-auto " +
					(wrap ? "whitespace-pre-wrap break-words" : "whitespace-pre")
				}
			>
				{tokensByLine.map((lineTokens, lineIdx) => {
					const isLastLine = lineIdx === tokensByLine.length - 1;
					return (
						<div
							key={lineIdx}
							className={streaming && isLastLine ? "animate-[fade-up_0.25s_var(--ease-out-strong)_both]" : undefined}
						>
							{showLineNumbers && (
								<span className="mr-3 inline-block w-5 select-none text-right text-ink-3 opacity-60 tabular-nums">
									{lineIdx + 1}
								</span>
							)}
							{lineTokens.map((tok, tokIdx) => (
								<span
									key={tokIdx}
									style={{
										color: tok.color,
										fontStyle: tok.italic ? "italic" : undefined,
									}}
								>
									{tok.content}
								</span>
							))}
							{streaming && isLastLine && (
								<span
									aria-hidden="true"
									className="ml-0.5 inline-block h-[1.05em] w-[3px] rounded-[1px] bg-accent align-text-bottom"
								/>
							)}
						</div>
					);
				})}
			</div>
			{canExpand && (
				<div className="flex justify-center border-t border-line bg-surface py-1">
					<button
						type="button"
						onClick={() => setExpanded(true)}
						className="shrink-0 whitespace-nowrap rounded-control px-2.5 py-0.5 text-[11.5px] font-medium text-ink-2 transition-colors hover:bg-hover hover:text-ink"
					>
						展开（共 {tokensByLine.length} 行）
					</button>
				</div>
			)}
		</div>
	);

	if (!showHeader) {
		return (
			<div className={"overflow-hidden rounded-control bg-inset shadow-hairline " + (className ?? "")}>
				{body}
			</div>
		);
	}

	return (
		<Card className={className}>
			<CardBar>
				<span className="flex min-w-0 flex-1 items-center gap-2">
					<span className="mono min-w-0 truncate text-[12px] font-medium text-ink">{primaryTitle}</span>
					{secondaryTitle && <span className="shrink-0 whitespace-nowrap text-[11.5px] text-ink-2">{secondaryTitle}</span>}
				</span>
				<span className="flex shrink-0 items-center gap-1 whitespace-nowrap">
					<button
						type="button"
						onClick={() => setWrap(w => !w)}
						aria-pressed={wrap}
						title="切换自动换行"
						className={
							"inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-control px-1.5 text-[11.5px] font-medium transition-colors " +
							(wrap ? "bg-field text-ink" : "text-ink-2 hover:bg-hover hover:text-ink")
						}
					>
						<WrapText size={11} strokeWidth={2} className="i" />
						<span>换行</span>
					</button>
					<button
						type="button"
						onClick={handleCopy}
						className={
							"inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-control px-1.5 text-[11.5px] font-medium transition-colors hover:bg-hover active:scale-96 " +
							(copied ? "text-green-ink" : "text-ink-2 hover:text-ink")
						}
					>
						<span className="relative inline-grid size-3 shrink-0 place-items-center">
							<Copy
								size={11}
								strokeWidth={2}
								className={
									"col-start-1 row-start-1 transition-[opacity,transform] duration-150 " +
									(copied ? "scale-80 opacity-0" : "scale-100 opacity-100")
								}
							/>
							<Check
								size={11}
								strokeWidth={2.6}
								className={
									"col-start-1 row-start-1 text-green transition-[opacity,transform] duration-150 " +
									(copied ? "scale-100 opacity-100" : "scale-80 opacity-0")
								}
							/>
						</span>
						<span>{copied ? "已复制" : "复制"}</span>
					</button>
				</span>
			</CardBar>
			{body}
		</Card>
	);
}
