import { describe, expect, test } from "bun:test";
import { DEFAULT_APPEARANCE_PREFS, loadAppearancePrefs, SHORTCUTS_LIST } from "./settings-utils";

describe("settings-utils", () => {
	test("loadAppearancePrefs returns defaults when storage is empty", () => {
		const prefs = loadAppearancePrefs();
		expect(prefs).toEqual(DEFAULT_APPEARANCE_PREFS);
	});

	test("SHORTCUTS_LIST includes DESIGN §12 keyboard shortcuts", () => {
		const labels = SHORTCUTS_LIST.map(s => s.label);
		expect(labels.some(l => l.includes("新建对话"))).toBe(true);
		expect(labels.some(l => l.includes("命令面板"))).toBe(true);
		expect(labels.some(l => l.includes("侧边栏"))).toBe(true);
		expect(labels.some(l => l.includes("右侧面板"))).toBe(true);
		expect(labels.some(l => l.includes("复制最后"))).toBe(true);
	});
});
