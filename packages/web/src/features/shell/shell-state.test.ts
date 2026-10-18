import { describe, expect, test } from "bun:test";
import { createSessionView } from "@/store/session-reducer";
import {
	clampPanelWidth,
	clampSidebarWidth,
	countAttentionSessions,
	formatDocumentTitle,
	getLayoutMode,
	nextConnectionBannerState,
} from "./shell-state";

describe("shell-state", () => {
	test("clamps sidebar and panel widths to FRONTEND §3 bounds", () => {
		expect(clampSidebarWidth(180)).toBe(220);
		expect(clampSidebarWidth(264)).toBe(264);
		expect(clampSidebarWidth(500)).toBe(360);
		expect(clampSidebarWidth(Number.NaN)).toBe(264);

		expect(clampPanelWidth(200)).toBe(280);
		expect(clampPanelWidth(380)).toBe(380);
		expect(clampPanelWidth(800)).toBe(640);
		expect(clampPanelWidth(Number.NaN)).toBe(380);
	});

	test("computes layout mode across breakpoints", () => {
		expect(getLayoutMode(1440)).toBe("desktop");
		expect(getLayoutMode(1280)).toBe("desktop");
		expect(getLayoutMode(1279)).toBe("medium");
		expect(getLayoutMode(1024)).toBe("medium");
		expect(getLayoutMode(1023)).toBe("compact");
		expect(getLayoutMode(768)).toBe("compact");
	});

	test("computes connection banner transitions", () => {
		expect(nextConnectionBannerState("closed", "closed", false)).toBe("hidden");
		expect(nextConnectionBannerState("connected", "reconnecting", true)).toBe("reconnecting");
		expect(nextConnectionBannerState("reconnecting", "connected", true)).toBe("recovered");
		expect(nextConnectionBannerState("connected", "closed", true)).toBe("reconnecting");
	});

	test("counts attention sessions and formats document title", () => {
		const s1 = createSessionView("s1");
		const s2 = {
			...createSessionView("s2"),
			pendingUi: [
				{
					type: "extension_ui_request" as const,
					id: "u1",
					method: "confirm" as const,
					title: "Confirm",
					message: "ok?",
				},
			],
		};
		const s3 = {
			...createSessionView("s3"),
			banners: [
				{
					kind: "prompt-error" as const,
					message: "boom",
					retryable: true,
				},
			],
		};

		const count = countAttentionSessions(
			{ s1, s2, s3 },
			{ s1: 200 },
			{ s1: 100 },
			"s2",
			false,
		);
		// s1 has unread settled, s3 has prompt-error; s2 (pendingUi) is the open session and the user is looking at it
		expect(count).toBe(2);
		expect(formatDocumentTitle("设计前端", count)).toBe("(2) 设计前端 — omp");
		expect(formatDocumentTitle(undefined, 0)).toBe("omp");

		// Same state while the user is away: the open session's pending request counts again.
		expect(countAttentionSessions({ s1, s2, s3 }, { s1: 200 }, { s1: 100 }, "s2", true)).toBe(3);

		// A turn that settled while the open session was being viewed is not unread once seen.
		expect(countAttentionSessions({ s1 }, { s1: 200 }, { s1: 300 }, "s1", true)).toBe(0);
	});
});
