import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

const SRC = path.resolve(import.meta.dir, "..");
// Comments blanked out (same length) so prose mentioning `@layer` can't be mistaken for a block.
const BASE_CSS = fs
	.readFileSync(path.join(import.meta.dir, "base.css"), "utf8")
	.replace(/\/\*[\s\S]*?\*\//g, c => " ".repeat(c.length));

function sourceFiles(dir: string): string[] {
	const out: string[] = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) out.push(...sourceFiles(full));
		else if (/\.(tsx?|jsx?)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(full);
	}
	return out;
}

/** Brace depth inside any `@layer` block at `index` (unlayered rules beat Tailwind's layered utilities). */
function insideLayer(css: string, index: number): boolean {
	const layerRe = /@layer[^{;]*\{/g;
	for (let m = layerRe.exec(css); m; m = layerRe.exec(css)) {
		let depth = 1;
		let i = m.index + m[0].length;
		for (; i < css.length && depth > 0; i++) {
			if (css[i] === "{") depth++;
			else if (css[i] === "}") depth--;
		}
		if (index > m.index && index < i) return true;
	}
	return false;
}

describe("font-size setting coverage (--app-font-scale)", () => {
	const used = new Set<string>();
	for (const file of sourceFiles(SRC)) {
		for (const m of fs.readFileSync(file, "utf8").matchAll(/(?<![\w-])text-\[(\d+(?:\.\d+)?)px\]/g)) used.add(m[1]!);
	}

	test("every arbitrary px text size used in the UI has an unlayered scale rule", () => {
		const missing: string[] = [];
		for (const size of used) {
			const rule = `[class~="text-[${size}px]"] { font-size: calc(${size}px * var(--app-font-scale, 1)); }`;
			const at = BASE_CSS.indexOf(rule);
			if (at < 0 || insideLayer(BASE_CSS, at)) missing.push(`text-[${size}px]`);
		}
		expect(missing).toEqual([]);
	});

	test("no Tailwind named text sizes (they would ignore the setting)", () => {
		const offenders: string[] = [];
		for (const file of sourceFiles(SRC)) {
			if (/(?<![\w-])text-(xs|sm|base|lg|xl|[2-9]xl)(?![\w-])/.test(fs.readFileSync(file, "utf8"))) {
				offenders.push(path.relative(SRC, file));
			}
		}
		expect(offenders).toEqual([]);
	});
});
