/**
 * Prose markdown renderer (FRONTEND §6.5.2, §4.3, DESIGN §2.1, §9.3).
 * Uses `react-markdown` + `remark-gfm` + `rehype-katex`, delegates fenced code blocks
 * to `CodeBlock`, wraps tables in `Card`, and renders streaming draft text with
 * `.stream-tail` (last ~24 chars) + `.stream-caret`.
 */
import "katex/dist/katex.min.css";
import { Children, isValidElement, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import { Card } from "../../ui/Card";
import { CodeBlock } from "../tools/CodeBlock";
import { splitStreamTail } from "./streaming-tail";

export interface ProseProps {
	content: string;
	streaming?: boolean;
	className?: string;
}

function extractTextFromChildren(node: ReactNode): string {
	if (typeof node === "string" || typeof node === "number") return String(node);
	if (Array.isArray(node)) return node.map(extractTextFromChildren).join("");
	if (isValidElement<{ children?: ReactNode }>(node)) {
		return extractTextFromChildren(node.props.children);
	}
	return "";
}

const MARKDOWN_COMPONENTS: Components = {
	p({ children }) {
		return <p className="[&:not(:first-child)]:mt-[0.75em]">{children}</p>;
	},
	h1({ children }) {
		return <h1 className="mt-4 mb-2 text-[18px] leading-[1.35] font-semibold text-ink">{children}</h1>;
	},
	h2({ children }) {
		return <h2 className="mt-3.5 mb-1.5 text-[16px] leading-[1.4] font-semibold text-ink">{children}</h2>;
	},
	h3({ children }) {
		return <h3 className="mt-3 mb-1 text-[14.5px] leading-[1.45] font-semibold text-ink">{children}</h3>;
	},
	ul({ children }) {
		return <ul className="my-[0.5em] list-disc pl-[1.25em] marker:text-ink-3">{children}</ul>;
	},
	ol({ children }) {
		return <ol className="my-[0.5em] list-decimal pl-[1.25em] marker:text-ink-3">{children}</ol>;
	},
	li({ children }) {
		return <li className="my-0.5">{children}</li>;
	},
	blockquote({ children }) {
		return (
			<blockquote className="my-2.5 border-l-2 border-line-strong pl-3 text-ink-2">
				{children}
			</blockquote>
		);
	},
	hr() {
		return <hr className="my-6 h-px border-0 bg-line" />;
	},
	a({ href, children }) {
		return (
			<a
				href={href}
				target="_blank"
				rel="noopener noreferrer"
				className="relative text-accent-ink no-underline after:absolute after:right-0 after:bottom-[-1px] after:left-0 after:h-px after:origin-left after:scale-x-0 after:bg-current after:transition-transform after:duration-280 hover:after:scale-x-100"
			>
				{children}
			</a>
		);
	},
	table({ children }) {
		return (
			<Card className="my-2.5 overflow-x-auto">
				<table className="w-full border-collapse text-left text-[13px]">{children}</table>
			</Card>
		);
	},
	thead({ children }) {
		return <thead className="bg-inset text-[12px] font-medium text-ink-2">{children}</thead>;
	},
	th({ children }) {
		return <th className="border-b border-line px-3 py-2.5 font-medium text-ink-2">{children}</th>;
	},
	td({ children }) {
		return <td className="border-b border-line px-3 py-2.5 text-ink">{children}</td>;
	},
	pre({ children }) {
		const childArray = Children.toArray(children);
		const first = childArray[0];
		if (
			isValidElement<{ className?: string; children?: ReactNode }>(first)
		) {
			const cls = first.props.className ?? "";
			const langMatch = /language-([^\s]+)/.exec(cls);
			const rawLang = langMatch ? langMatch[1] : undefined;
			const codeText = extractTextFromChildren(first.props.children);
			// Support optional `lang:filename` syntax
			let language = rawLang;
			let filename: string | undefined;
			if (rawLang && rawLang.includes(":")) {
				const [l, f] = rawLang.split(":", 2);
				language = l;
				filename = f;
			} else if (rawLang && (rawLang.includes("/") || rawLang.includes("."))) {
				filename = rawLang;
			}
			return (
				<div className="my-2.5">
					<CodeBlock code={codeText} language={language} filename={filename} />
				</div>
			);
		}
		return <pre className="my-2.5 overflow-x-auto rounded-card bg-inset p-3 mono text-[12.5px]">{children}</pre>;
	},
	code({ className, children }) {
		return (
			<code
				className={
					"mono rounded-[5px] bg-field px-[5px] py-[1px] text-[0.9em] text-ink " +
					(className ?? "")
				}
			>
				{children}
			</code>
		);
	},
};

export function Prose({ content, streaming = false, className }: ProseProps) {
	if (!content && !streaming) return null;

	if (streaming) {
		const { head, tail } = splitStreamTail(content, 24);
		return (
			<div className={"prose text-[14.5px] leading-[1.65] text-ink " + (className ?? "")}>
				{head.length > 0 && (
					<ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeKatex]} components={MARKDOWN_COMPONENTS}>
						{head}
					</ReactMarkdown>
				)}
				<span className="inline">
					{tail.length > 0 && <span className="stream-tail whitespace-pre-wrap">{tail}</span>}
					<span className="stream-caret" aria-hidden="true" />
				</span>
			</div>
		);
	}

	return (
		<div className={"prose text-[14.5px] leading-[1.65] text-ink " + (className ?? "")}>
			<ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeKatex]} components={MARKDOWN_COMPONENTS}>
				{content}
			</ReactMarkdown>
		</div>
	);
}
