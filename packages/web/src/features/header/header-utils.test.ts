import { describe, expect, test } from "bun:test";
import {
	buildSessionTree,
	extractLastAssistantText,
	formatCostUsd,
	formatTokensCompact,
	getContextRingTone,
	truncateMiddlePath,
} from "./header-utils";

describe("header-utils", () => {
	test("truncateMiddlePath normalizes home dir and middle-truncates long paths", () => {
		expect(truncateMiddlePath("/Users/chengqi/Desktop/code/tools/omp-ui", 40)).toBe(
			"~/Desktop/code/tools/omp-ui",
		);
		const longPath = "/Users/chengqi/Desktop/very/deeply/nested/workspace/directory/omp-ui";
		const truncated = truncateMiddlePath(longPath, 24);
		expect(truncated.startsWith("~/")).toBe(true);
		expect(truncated.endsWith("/omp-ui")).toBe(true);
		expect(truncated.includes("…")).toBe(true);
	});

	test("getContextRingTone respects 80% and 95% thresholds", () => {
		expect(getContextRingTone(42)).toBe("normal");
		expect(getContextRingTone(79.9)).toBe("normal");
		expect(getContextRingTone(80)).toBe("orange");
		expect(getContextRingTone(94)).toBe("orange");
		expect(getContextRingTone(95)).toBe("red");
	});

	test("formatTokensCompact and formatCostUsd format numbers cleanly", () => {
		expect(formatTokensCompact(0)).toBe("0");
		expect(formatTokensCompact(850)).toBe("850");
		expect(formatTokensCompact(84_200)).toBe("84.2k");
		expect(formatTokensCompact(200_000)).toBe("200k");
		expect(formatTokensCompact(1_500_000)).toBe("1.5M");

		expect(formatCostUsd(0)).toBe("$0.00");
		expect(formatCostUsd(0.42)).toBe("$0.42");
		expect(formatCostUsd(0.0035)).toBe("$0.0035");
	});

	test("extractLastAssistantText returns latest assistant prose", () => {
		const text = extractLastAssistantText([
			{ role: "user", content: "hi", timestamp: 1 },
			{
				role: "assistant",
				content: [{ type: "text", text: "first reply" }],
				api: "anthropic",
				provider: "anthropic",
				model: "opus",
				usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
				stopReason: "stop",
				timestamp: 2,
			},
			{
				role: "assistant",
				content: [{ type: "text", text: "second reply" }],
				api: "anthropic",
				provider: "anthropic",
				model: "opus",
				usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
				stopReason: "stop",
				timestamp: 3,
			},
		]);
		expect(text).toBe("second reply");
	});

	test("buildSessionTree builds nested tree and marks active branch to leafId", () => {
		const roots = buildSessionTree(
			[
				{ id: "e1", role: "user", text: "First prompt", parentId: null },
				{ id: "e2", role: "assistant", text: "First answer", parentId: "e1" },
				{ id: "e3", role: "user", text: "Branch A", parentId: "e2" },
				{ id: "e4", role: "user", text: "Branch B", parentId: "e2" },
			],
			"e4",
		);
		expect(roots.length).toBe(1);
		expect(roots[0]?.id).toBe("e1");
		expect(roots[0]?.onActiveBranch).toBe(true);
		const e2 = roots[0]?.children[0];
		expect(e2?.id).toBe("e2");
		expect(e2?.children.length).toBe(2);
		expect(e2?.children[0]?.isLeaf).toBe(false);
		expect(e2?.children[0]?.onActiveBranch).toBe(false);
		expect(e2?.children[1]?.isLeaf).toBe(true);
		expect(e2?.children[1]?.onActiveBranch).toBe(true);
	});
});
