/**
 * Shiki highlighter with custom `omp-light` and `omp-dark` themes
 * built directly from design tokens (FRONTEND §6.10, DESIGN §12).
 * Grammars are lazy-loaded per language via `hl.loadLanguage`.
 */
import { useEffect, useState } from "react";
import {
	bundledLanguages,
	createHighlighter,
	type BundledLanguage,
	type HighlighterCore,
	type ThemeRegistrationRaw,
} from "shiki";

export interface CodeToken {
	content: string;
	color?: string;
	italic?: boolean;
}

const TOKEN_SETTINGS: ThemeRegistrationRaw["settings"] = [
	{
		settings: {
			foreground: "var(--ink-2)",
			background: "var(--inset)",
		},
	},
	{
		scope: [
			"keyword",
			"keyword.control",
			"keyword.operator.new",
			"keyword.operator.expression",
			"storage",
			"storage.type",
			"storage.modifier",
		],
		settings: { foreground: "var(--accent-ink)" },
	},
	{
		scope: ["string", "string.quoted", "string.template", "regexp", "string.regexp"],
		settings: { foreground: "var(--green)" },
	},
	{
		scope: [
			"constant",
			"constant.numeric",
			"constant.language",
			"constant.language.boolean",
			"constant.character",
			"support.constant",
		],
		settings: { foreground: "var(--orange)" },
	},
	{
		scope: [
			"entity.name.function",
			"support.function",
			"entity.name.type",
			"entity.name.class",
			"support.class",
			"Support.type",
		],
		settings: { foreground: "var(--ink)" },
	},
	{
		scope: ["comment", "punctuation.definition.comment"],
		settings: { foreground: "var(--ink-3)", fontStyle: "italic" },
	},
	{
		scope: ["punctuation", "keyword.operator", "meta.brace"],
		settings: { foreground: "var(--ink-3)" },
	},
	{
		scope: ["variable", "variable.other", "variable.parameter", "source"],
		settings: { foreground: "var(--ink-2)" },
	},
	{
		scope: ["entity.name.tag", "support.class.component"],
		settings: { foreground: "var(--accent-ink)" },
	},
	{
		scope: ["entity.other.attribute-name"],
		settings: { foreground: "var(--orange)" },
	},
	{
		scope: ["markup.deleted"],
		settings: { foreground: "var(--red)" },
	},
	{
		scope: ["markup.inserted"],
		settings: { foreground: "var(--green)" },
	},
];

export const OMP_LIGHT_THEME: ThemeRegistrationRaw = {
	name: "omp-light",
	type: "light",
	settings: TOKEN_SETTINGS,
	fg: "var(--ink-2)",
	bg: "var(--inset)",
};

export const OMP_DARK_THEME: ThemeRegistrationRaw = {
	name: "omp-dark",
	type: "dark",
	settings: TOKEN_SETTINGS,
	fg: "var(--ink-2)",
	bg: "var(--inset)",
};

const LANG_ALIASES: Record<string, string> = {
	ts: "typescript",
	tsx: "tsx",
	js: "javascript",
	jsx: "jsx",
	py: "python",
	sh: "bash",
	shell: "bash",
	zsh: "bash",
	yml: "yaml",
	md: "markdown",
	rs: "rust",
	rb: "ruby",
	htm: "html",
};

export const DISPLAY_LANGUAGE_NAMES: Record<string, string> = {
	typescript: "TypeScript",
	tsx: "TSX",
	javascript: "JavaScript",
	jsx: "JSX",
	python: "Python",
	bash: "Bash",
	json: "JSON",
	yaml: "YAML",
	markdown: "Markdown",
	html: "HTML",
	css: "CSS",
	rust: "Rust",
	go: "Go",
	sql: "SQL",
	diff: "Diff",
};

export function normalizeLanguage(lang?: string, filePath?: string): string {
	const raw = (lang ?? "").trim().toLowerCase();
	if (raw) {
		return LANG_ALIASES[raw] ?? raw;
	}
	if (filePath) {
		const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
		if (ext) return LANG_ALIASES[ext] ?? ext;
	}
	return "text";
}

const KEYWORDS: Record<string, true> = {
	import: true,
	from: true,
	export: true,
	default: true,
	const: true,
	let: true,
	var: true,
	function: true,
	return: true,
	if: true,
	else: true,
	for: true,
	while: true,
	do: true,
	switch: true,
	case: true,
	break: true,
	continue: true,
	new: true,
	class: true,
	extends: true,
	implements: true,
	interface: true,
	type: true,
	enum: true,
	async: true,
	await: true,
	try: true,
	catch: true,
	finally: true,
	throw: true,
	typeof: true,
	instanceof: true,
	in: true,
	of: true,
	void: true,
	delete: true,
	private: true,
	protected: true,
	public: true,
	readonly: true,
	static: true,
	def: true,
	elif: true,
	except: true,
	lambda: true,
	with: true,
	as: true,
	yield: true,
	fn: true,
	pub: true,
	mut: true,
	impl: true,
	struct: true,
	match: true,
};

const CONSTANTS: Record<string, true> = {
	true: true,
	false: true,
	null: true,
	undefined: true,
	NaN: true,
	Infinity: true,
	None: true,
	True: true,
	False: true,
};

const TOKEN_REGEX =
	/(\/\/.*$|#.*$|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b\d+(?:\.\d+)?\b|\b[A-Za-z_$][\w$]*\b|[{}()[\].,:;+-/*=<>!&|?~]+)/gm;

/**
 * Fast synchronous tokenizer used immediately before Shiki finishes loading a
 * grammar or for lines > 2000 (DESIGN §12). Uses the exact §6.10 token colors.
 */
export function tokenizeLineFallback(line: string): CodeToken[] {
	if (!line) return [{ content: "" }];
	const out: CodeToken[] = [];
	let lastIndex = 0;
	TOKEN_REGEX.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = TOKEN_REGEX.exec(line)) !== null) {
		if (match.index > lastIndex) {
			out.push({ content: line.slice(lastIndex, match.index), color: "var(--ink-2)" });
		}
		const tok = match[0];
		const afterIdx = match.index + tok.length;
		const nextChar = line[afterIdx];
		if (tok.startsWith("//") || tok.startsWith("#")) {
			out.push({ content: tok, color: "var(--ink-3)", italic: true });
		} else if (tok.startsWith('"') || tok.startsWith("'") || tok.startsWith("`")) {
			out.push({ content: tok, color: "var(--green)" });
		} else if (/^\d/.test(tok) || CONSTANTS[tok]) {
			out.push({ content: tok, color: "var(--orange)" });
		} else if (KEYWORDS[tok]) {
			out.push({ content: tok, color: "var(--accent-ink)" });
		} else if (/^[A-Z]/.test(tok) || nextChar === "(") {
			out.push({ content: tok, color: "var(--ink)" });
		} else if (/^[{}()[\].,:;+-/*=<>!&|?~]+$/.test(tok)) {
			out.push({ content: tok, color: "var(--ink-3)" });
		} else {
			out.push({ content: tok, color: "var(--ink-2)" });
		}
		lastIndex = afterIdx;
	}
	if (lastIndex < line.length) {
		out.push({ content: line.slice(lastIndex), color: "var(--ink-2)" });
	}
	return out;
}

let highlighterPromise: Promise<HighlighterCore> | null = null;
const loadedLangs = new Set<string>();

const MAX_SHIKI_LINES = 2000;

export async function highlightCodeLines(code: string, lang?: string, filePath?: string): Promise<CodeToken[][]> {
	const rawLines = code.split("\n");
	const normLang = normalizeLanguage(lang, filePath);
	if (normLang === "text" || normLang === "") {
		return rawLines.map(l => [{ content: l, color: "var(--ink-2)" }]);
	}
	const headLines = rawLines.slice(0, MAX_SHIKI_LINES);
	const tailLines = rawLines.slice(MAX_SHIKI_LINES);
	try {
		if (!highlighterPromise) {
			highlighterPromise = createHighlighter({
				themes: [OMP_LIGHT_THEME, OMP_DARK_THEME],
				langs: [],
			});
		}
		const hl = await highlighterPromise;
		if (!loadedLangs.has(normLang) && normLang in bundledLanguages) {
			const loader = bundledLanguages[normLang as BundledLanguage];
			await hl.loadLanguage(loader);
			loadedLangs.add(normLang);
		}
		if (loadedLangs.has(normLang)) {
			const { tokens } = hl.codeToTokens(headLines.join("\n"), {
				lang: normLang,
				theme: "omp-light",
			});
			const shikiOut: CodeToken[][] = tokens.map(lineTokens =>
				lineTokens.map(t => ({
					content: t.content,
					color: t.color ?? "var(--ink-2)",
					italic: Boolean(t.fontStyle && t.fontStyle & 1),
				})),
			);
			const fallbackTail = tailLines.map(tokenizeLineFallback);
			return [...shikiOut, ...fallbackTail];
		}
	} catch {
		/* fall back to synchronous tokenizer on unsupported lang or environment */
	}
	return rawLines.map(tokenizeLineFallback);
}

export function useHighlightedLines(code: string, lang?: string, filePath?: string): CodeToken[][] {
	const [lines, setLines] = useState<CodeToken[][]>(() => code.split("\n").map(tokenizeLineFallback));

	useEffect(() => {
		let cancelled = false;
		setLines(code.split("\n").map(tokenizeLineFallback));
		void highlightCodeLines(code, lang, filePath).then(res => {
			if (!cancelled) setLines(res);
		});
		return () => {
			cancelled = true;
		};
	}, [code, lang, filePath]);

	return lines;
}
