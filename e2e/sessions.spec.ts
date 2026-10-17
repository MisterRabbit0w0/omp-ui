import { approveBtn, approvalCard, expect, send, sidebar, test, text } from "./fixtures";

test("open fixture session read-only, then send (lazy start with --resume)", async ({ app }) => {
	await sidebar(app).getByText("Fixture rich session").click();
	// read-only transcript: text, tool rows, code
	await expect(text(app, "Reading then editing.")).toBeVisible();
	await expect(text(app, "const answer = 42;")).toBeVisible();
	await expect(app.locator("[data-tool-call-id]")).toHaveCount(2);
	await expect(approvalCard(app)).toHaveCount(0);

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
	await sidebar(app).getByText("Fixture plain session").click();
	await expect(text(app, "fixture assistant reply")).toBeVisible();
	await expect(text(app, "hello fixture")).toBeVisible();
});
