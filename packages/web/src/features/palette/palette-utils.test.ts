import { describe, expect, test } from "bun:test";
import { buildPaletteItems, filterPaletteGroups } from "./palette-utils";

describe("palette-utils", () => {
	const items = buildPaletteItems(
		[
			{
				id: "s1",
				file: "/tmp/s1.jsonl",
				cwd: "/Users/chengqi/Desktop/omp-ui",
				title: "设计前端并实现 Bridge",
				createdAt: "2026-10-16T10:00:00Z",
				updatedAt: "2026-10-16T11:00:00Z",
				sizeBytes: 100,
				live: true,
				running: false,
				archived: false,
			},
		],
		[
			{
				id: "claude-opus-5.5",
				name: "Claude Opus 5.5",
				api: "anthropic",
				provider: "anthropic",
				baseUrl: "",
				reasoning: true,
				input: ["text", "image"],
				cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
				contextWindow: 200_000,
				maxTokens: 32_000,
			},
		],
	);

	test("groups items into 会话, 操作, 模型", () => {
		const groups = filterPaletteGroups(items, "");
		expect(groups.map(g => g.category)).toEqual(["会话", "操作", "模型"]);
	});

	test("filters items by fuzzy query", () => {
		const groups = filterPaletteGroups(items, "opus");
		expect(groups.length).toBe(1);
		expect(groups[0]?.category).toBe("模型");
		expect(groups[0]?.items[0]?.label).toBe("Claude Opus 5.5");

		const empty = filterPaletteGroups(items, "nonexistent-xyz-999");
		expect(empty.length).toBe(0);
	});
});
