import { describe, expect, test } from "bun:test";
import { isApprovalRequest, parseApproval } from "./approval";
import type { SelectUiRequest } from "./rpc-wire";

const req = (title: string, options = ["Approve", "Deny"]): SelectUiRequest => ({
	type: "extension_ui_request", id: "r1", method: "select", title, options, timeout: 60000,
});

describe("approval", () => {
	test("parses full prompt", () => {
		const p = parseApproval(req("Allow tool: mcp__gh__issue\nOrigin: MCP server tool\nReason: writes\nRepo: a/b\n\nBody: x"));
		expect(p).toEqual({ requestId: "r1", toolName: "mcp__gh__issue", mcp: true, reason: "writes", details: ["Repo: a/b", "Body: x"], timeoutMs: 60000 });
	});
	test("rejects other selects", () => {
		expect(isApprovalRequest(req("Pick one", ["a", "b"]))).toBe(false);
		expect(isApprovalRequest(req("Allow tool: bash", ["Deny", "Approve"]))).toBe(false);
	});
});
