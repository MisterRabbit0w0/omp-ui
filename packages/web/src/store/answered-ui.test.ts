import { describe, expect, test } from "bun:test";
import type { ExtensionUiRequest, ToolResultMessage } from "@omp-ui/protocol";
import { answeredApprovalFor, approvalReceiptKind, askSummaryLines, createSessionView, reduce, resolveUi } from "./session-reducer";

const approval = (id: string): ExtensionUiRequest => ({
	type: "extension_ui_request",
	id,
	method: "select",
	title: "Allow tool: bash\nCommand: echo hi",
	options: ["Approve", "Deny"],
});
const ask: ExtensionUiRequest = {
	type: "extension_ui_request",
	id: "a1",
	method: "ask",
	questions: [{ id: "q1", question: "Pick?", options: [{ label: "Red" }, { label: "Blue" }] }],
};

function withRunningBash() {
	let v = createSessionView("s");
	v = reduce(v, { type: "tool_execution_start", toolCallId: "t1", toolName: "bash", args: {} }, { live: true });
	return v;
}

describe("answeredUi", () => {
	test("a replayed request followed by ui_resolved ends up answered, not pending", () => {
		let v = withRunningBash();
		v = reduce(v, approval("u1"), { live: true });
		expect(v.pendingUi).toHaveLength(1);
		v = resolveUi(v, "u1");
		expect(v.pendingUi).toHaveLength(0);
		expect(v.answeredUi).toHaveLength(1);
		expect(v.answeredUi[0]!.toolCallId).toBe("t1");
	});

	test("resolveUi is idempotent and ignores unknown ids", () => {
		let v = reduce(withRunningBash(), approval("u1"), { live: true });
		v = resolveUi(v, "u1");
		expect(resolveUi(v, "u1")).toBe(v);
		expect(resolveUi(v, "nope")).toBe(v);
	});

	test("receipt: explicit response wins, else the tool result decides", () => {
		const base = { request: approval("u") };
		expect(approvalReceiptKind({ ...base, response: { type: "extension_ui_response", id: "u", value: "Deny" } })).toBe("denied");
		expect(approvalReceiptKind({ ...base, response: { type: "extension_ui_response", id: "u", value: "Approve" } })).toBe("approved");
		expect(approvalReceiptKind({ ...base, auto: true })).toBe("always");
		expect(approvalReceiptKind({ ...base, response: { type: "extension_ui_response", id: "u", cancelled: true, timedOut: true } })).toBe("timed_out");
		const errResult: ToolResultMessage = { role: "toolResult", toolCallId: "t", toolName: "bash", content: [], isError: true, timestamp: 1 };
		expect(approvalReceiptKind(base, errResult)).toBe("denied");
		expect(approvalReceiptKind(base, { ...errResult, isError: false })).toBe("approved");
		expect(approvalReceiptKind(base)).toBe("approved");
	});

	test("an answered ask on a tool row is never picked up as that row's approval receipt", () => {
		let v = createSessionView("s");
		v = reduce(v, { type: "tool_execution_start", toolCallId: "k1", toolName: "ask", args: {} }, { live: true });
		v = reduce(v, ask, { live: true });
		v = resolveUi(v, "a1", { response: { type: "extension_ui_response", id: "a1", answers: [{ id: "q1", selectedOptions: ["Red"] }] } });
		expect(v.answeredUi[0]!.toolCallId).toBe("k1");
		expect(answeredApprovalFor(v.answeredUi, "k1")).toBeUndefined();
		// The ask tool itself may also be gated by an approval; that one is the receipt.
		v = reduce(v, { ...approval("u1"), title: "Allow tool: ask" } as ExtensionUiRequest, { live: true });
		v = resolveUi(v, "u1");
		expect(answeredApprovalFor(v.answeredUi, "k1")?.request.id).toBe("u1");
	});

	test("ask summary lines from answers, cancel and unknown", () => {
		let v = reduce(createSessionView("s"), ask, { live: true });
		v = resolveUi(v, "a1", { response: { type: "extension_ui_response", id: "a1", answers: [{ id: "q1", selectedOptions: ["Blue"] }] } });
		expect(askSummaryLines(v.answeredUi[0]!)).toEqual([["Pick?", "Blue"]]);
		expect(askSummaryLines({ request: ask })).toEqual([["Pick?", "已回答"]]);
		expect(askSummaryLines({ request: ask, response: { type: "extension_ui_response", id: "a1", cancelled: true } })).toEqual([["Pick?", "已取消"]]);
	});
});
