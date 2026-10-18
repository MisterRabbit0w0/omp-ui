import type { Page } from "@playwright/test";
import { approveBtn, approvalCard, expect, launches, send, showAllSessions, sidebar, test, text } from "./fixtures";

const popover = (page: Page) => page.getByRole("dialog").last();

test("opening a fixture session spawns nothing; opening the model menu starts it before the first send", async ({ app, bridge }) => {
	await sidebar(app).getByText("Fixture rich session").click();
	// read-only transcript: text, tool rows, code
	await expect(text(app, "Reading then editing.")).toBeVisible();
	await expect(text(app, "const answer = 42;")).toBeVisible();
	await expect(app.locator("[data-tool-call-id]")).toHaveCount(2);
	await expect(approvalCard(app)).toHaveCount(0);

	// Browsing the sidebar does not spawn (pool slots stay with live work)…
	expect(launches(bridge)).toHaveLength(0);
	// …opening the model menu does: once attached, models and thinking are selectable without sending.
	// The pick lands while the lazy start may still be in flight: it waits for that start instead of failing.
	await app.getByRole("button", { name: /^模型：/ }).click();
	await popover(app).getByRole("button", { name: /model-mini/ }).click();
	await expect(app.getByRole("button", { name: /^模型：model-mini/ })).toBeVisible();
	expect(launches(bridge)).toHaveLength(1);
	await app.keyboard.press("Escape");

	await send(app, "continue please");
	await expect(approvalCard(app)).toBeVisible();
	await approveBtn(app).click();
	await expect(text(app, "Command finished: hi")).toBeVisible();
	// history survived the resume and the new turn was appended
	await expect(text(app, "Reading then editing.")).toBeVisible();
	await expect(text(app, "fake reply to: continue please")).toBeVisible();
	await expect(sidebar(app).getByText("Fixture rich session")).toHaveCount(1);
});

test("plain fixture session preview", async ({ app }) => {
	await showAllSessions(app);
	await sidebar(app).getByText("Fixture plain session").click();
	await expect(text(app, "fixture assistant reply")).toBeVisible();
	await expect(text(app, "hello fixture")).toBeVisible();
});
