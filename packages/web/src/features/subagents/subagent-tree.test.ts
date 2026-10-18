import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SubagentsTab } from "@/features/panel/SubagentsTab";
import { renderToolDetail } from "@/features/tools";
import { createSessionView, type SubagentView } from "@/store/session-reducer";
import {
	buildSubagentTree,
	countActiveSubagentDescendants,
	countSubagentDescendants,
	findSubagentNode,
	findSubagentParentId,
	flattenSubagentTree,
	subagentChildren,
	subagentLineage,
} from "./subagent-utils";

function sub(id: string, extra: Partial<SubagentView> = {}): SubagentView {
	return { id, index: 0, agent: id.split(".").pop()!, agentSource: "bundled", status: "running", lastUpdate: 1, ...extra };
}

function mapOf(...subs: SubagentView[]): Map<string, SubagentView> {
	return new Map(subs.map(s => [s.id, s]));
}

describe("subagent tree", () => {
	const all = mapOf(
		sub("Anna", { index: 1, status: "completed", parentToolCallId: "c1" }),
		sub("Anna.Bob", { index: 0, parentToolCallId: "a1" }),
		sub("Anna.Bob.Cy", { index: 0, parentToolCallId: "b1" }),
		sub("Anna.Dee", { index: 1, status: "completed", parentToolCallId: "a1" }),
		sub("Zed", { index: 0, parentToolCallId: "c1" }),
		// intermediate ancestor "Ghost" was pruned: attaches to the closest known one (root here)
		sub("Ghost.Eve", { index: 0 }),
	);

	test("parent = longest known dotted prefix", () => {
		const ids = new Set(all.keys());
		expect(findSubagentParentId("Anna.Bob.Cy", ids)).toBe("Anna.Bob");
		expect(findSubagentParentId("Anna", ids)).toBeNull();
		expect(findSubagentParentId("Ghost.Eve", ids)).toBeNull();
		expect(findSubagentParentId("Anna.X.Y", ids)).toBe("Anna");
	});

	test("builds a sorted forest with depths and counts", () => {
		const roots = buildSubagentTree(all.values());
		expect(roots.map(r => r.subagent.id)).toEqual(["Ghost.Eve", "Zed", "Anna"]);
		const flat = flattenSubagentTree(roots);
		expect(flat.map(n => `${n.subagent.id}:${n.depth}`)).toEqual([
			"Ghost.Eve:0",
			"Zed:0",
			"Anna:0",
			"Anna.Bob:1",
			"Anna.Bob.Cy:2",
			"Anna.Dee:1",
		]);
		const anna = findSubagentNode(roots, "Anna")!;
		expect(countSubagentDescendants(anna)).toBe(3);
		expect(countActiveSubagentDescendants(anna)).toBe(2);
	});

	test("lineage and children", () => {
		expect(subagentLineage("Anna.Bob.Cy", all).map(s => s.id)).toEqual(["Anna", "Anna.Bob"]);
		expect(subagentLineage("Anna", all)).toEqual([]);
		expect(subagentChildren("Anna", all).map(s => s.id)).toEqual(["Anna.Bob", "Anna.Dee"]);
	});

	test("side panel renders nested subagents indented under their parent", () => {
		const view = { ...createSessionView("s"), subagents: all };
		const html = renderToStaticMarkup(createElement(SubagentsTab, { sessionId: "s", view }));
		const order = [...html.matchAll(/data-subagent-id="([^"]+)" data-subagent-depth="(\d)"/g)].map(m => `${m[1]}:${m[2]}`);
		expect(order).toEqual(["Ghost.Eve:0", "Zed:0", "Anna:0", "Anna.Bob:1", "Anna.Bob.Cy:2", "Anna.Dee:1"]);
	});

	test("task tool shows its direct subagents with their nested subtree", () => {
		const html = renderToStaticMarkup(
			createElement("div", null, renderToolDetail({ callId: "c1", toolName: "task", args: { tasks: [] }, subagents: all, sessionId: "s" })),
		);
		const ids = [...html.matchAll(/data-subagent-id="([^"]+)" data-subagent-depth="(\d)"/g)].map(m => `${m[1]}:${m[2]}`);
		// Zed and Anna belong to call c1; Anna's descendants render nested inside her capsule
		expect(ids).toEqual(["Zed:0", "Anna:0", "Anna.Bob:1", "Anna.Bob.Cy:2", "Anna.Dee:1"]);
		expect(html).toContain("+3 子代理");
	});
});
