import type { Page } from "@playwright/test";
import { approveBtn, approvalCard, expect, launches, send, showAllSessions, sidebar, test, text } from "./fixtures";

const popover = (page: Page) => page.getByRole("dialog").last();

test("opening a fixture session previews it and warms one process; model picks and sends reuse it", async ({ app, bridge }) => {
	await sidebar(app).getByText("Fixture rich session").click();
	// read-only transcript: text, tool rows, code
	await expect(text(app, "Reading then editing.")).toBeVisible();
	await expect(text(app, "const answer = 42;")).toBeVisible();
	await expect(app.locator("[data-tool-call-id]")).toHaveCount(2);
	await expect(approvalCard(app)).toHaveCount(0);

	// Selecting it warms the process in the background (§3.1): permission, model and send all act on a live session.
	await expect.poll(() => launches(bridge).length).toBe(1);
	// The pick may land while that start is still in flight: it waits for it instead of failing or spawning again.
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
