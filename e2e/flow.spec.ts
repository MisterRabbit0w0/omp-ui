import { approvalCard, approveBtn, denyBtn, expect, send, sidebar, test, watchPage, text } from "./fixtures";

test("welcome -> new session -> prompt -> stream -> approve -> receipt + output -> idle -> sidebar", async ({ app }) => {
	// Fixture sessions are listed before anything is started (bug 3 / http binding regression).
	await expect(sidebar(app).getByText("Fixture rich session")).toBeVisible();
	await expect(sidebar(app).getByText("暂无会话")).toHaveCount(0);

	await send(app, "hello");
	// user message + streamed text
	await expect(text(app, "fake reply to: hello")).toBeVisible();
	// approval card is anchored inside the bash tool row
	const row = app.locator("[data-tool-call-id]");
	await expect(row).toHaveCount(1);
	await expect(row.getByRole("alertdialog")).toBeVisible();
	await expect(row.getByText("Command: echo hi")).toBeVisible();
	await expect(app.getByTestId("run-indicator")).toBeVisible();
	// mid-loop: the committed message must not show the end-of-turn action bar yet; the header says it's working
	await expect(app.getByRole("button", { name: "分叉", exact: true })).toHaveCount(0);
	await expect(app.locator(".hdr").getByRole("status")).toHaveText("运行中");
	await expect.poll(() => app.title()).toMatch(/^● /);
	// sidebar already lists the live session
	await expect(sidebar(app).getByText("hello", { exact: true })).toHaveCount(1);

	await approveBtn(app).click();
	await expect(text(app, "已允许")).toBeVisible();
	await expect(text(app, "Command finished: hi")).toBeVisible();
	await expect(app.getByTestId("run-indicator")).toHaveCount(0);
	await expect(app.getByRole("button", { name: "分叉", exact: true })).toHaveCount(1);
	await expect(app.locator(".hdr").getByRole("status")).toHaveCount(0);
	await expect(approvalCard(app)).toHaveCount(0);

	// bash output is in the tool row
	await row.getByRole("button", { expanded: false }).first().click();
	await expect(row.getByText("hi", { exact: true }).first()).toBeVisible();

	// the file written by omp must not create a duplicate row
	await app.waitForTimeout(1200);
	await expect(sidebar(app).getByText("hello", { exact: true })).toHaveCount(1);
});

test("deny path", async ({ app }) => {
	await send(app, "please run");
	await expect(approvalCard(app)).toBeVisible();
	await denyBtn(app).click();
	await expect(text(app, "已拒绝")).toBeVisible();
	await expect(text(app, "Command was denied.")).toBeVisible();
	await expect(app.getByTestId("run-indicator")).toHaveCount(0);
});

test("ask card answer", async ({ app }) => {
	await send(app, "ASK me");
	await expect(text(app, "Pick a color?")).toBeVisible();
	await app.getByText("Blue", { exact: true }).click();
	const submit = app.getByRole("button", { name: "提交回答" });
	if (await submit.isVisible().catch(() => false)) await submit.click();
	await expect(text(app, "you chose: Blue")).toBeVisible();
	await expect(app.getByTestId("run-indicator")).toHaveCount(0);
});

test("reload mid-run restores state and the pending approval", async ({ app }) => {
	await send(app, "hello");
	await expect(approvalCard(app)).toBeVisible();
	await app.reload();
	await expect(app.getByText("已连接")).toBeVisible();
	await sidebar(app).getByText("hello", { exact: true }).click();
	await expect(approvalCard(app)).toBeVisible();
	await expect(text(app, "fake reply to: hello")).toBeVisible();
	// user message is not duplicated by replay + history refetch
	await expect(app.getByText("hello", { exact: true }).filter({ visible: true })).toHaveCount(3); // sidebar, header, user bubble
	await approveBtn(app).click();
	await expect(text(app, "Command finished: hi")).toBeVisible();
	await expect(app.getByTestId("run-indicator")).toHaveCount(0);
});

test("second tab answering the approval resolves the first", async ({ app, bridge, context, consoleErrors }) => {
	await send(app, "hello");
	await expect(approvalCard(app)).toBeVisible();

	const tab2 = await context.newPage();
	watchPage(tab2, consoleErrors);
	await tab2.goto(bridge.url);
	await sidebar(tab2).getByText("hello", { exact: true }).click();
	await expect(approvalCard(tab2)).toBeVisible();
	await approveBtn(tab2).click();

	await expect(approvalCard(app)).toHaveCount(0);
	await expect(text(app, "Command finished: hi")).toBeVisible();
	await expect(text(tab2, "Command finished: hi")).toBeVisible();
});

test("B1: approving, then reloading and reopening shows no pending card and keeps the receipt", async ({ app }) => {
	await send(app, "hello");
	await approveBtn(app).click();
	await expect(text(app, "Command finished: hi")).toBeVisible();
	await expect(app.getByTestId("run-indicator")).toHaveCount(0);

	await app.reload();
	await expect(app.getByText("已连接")).toBeVisible();
	await sidebar(app).getByText("hello", { exact: true }).click();
	await expect(text(app, "Command finished: hi")).toBeVisible();
	// replayed request must not resurrect as pending
	await expect(approvalCard(app)).toHaveCount(0);
	await expect(app.getByTestId("run-indicator")).toHaveCount(0);
	await expect(app.getByText("等待你的回应")).toHaveCount(0);
	// receipt comes from durable data (replayed request + tool result)
	await expect(app.locator("[data-tool-call-id]").getByText("已允许")).toBeVisible();
});

test("B1: denied approval keeps the 已拒绝 receipt after reload", async ({ app }) => {
	await send(app, "please run");
	await denyBtn(app).click();
	await expect(text(app, "Command was denied.")).toBeVisible();
	await app.reload();
	await expect(app.getByText("已连接")).toBeVisible();
	await sidebar(app).getByText("please run", { exact: true }).click();
	await expect(approvalCard(app)).toHaveCount(0);
	await expect(app.locator("[data-tool-call-id]").getByText("已拒绝")).toBeVisible();
});

test("B1/M6: ask answer leaves a summary, and reload does not resurrect the ask card", async ({ app }) => {
	await send(app, "ASK me");
	// The questionnaire is anchored under its ask tool call, not pinned to the transcript tail.
	const askRow = app.locator("[data-tool-call-id]").filter({ has: app.getByText("Pick a color?") });
	await expect(askRow).toHaveCount(1);
	await app.getByText("Blue", { exact: true }).click();
	const submit = app.getByRole("button", { name: "提交回答" });
	if (await submit.isVisible().catch(() => false)) await submit.click();
	await expect(text(app, "you chose: Blue")).toBeVisible();
	// M6: summary stays in the transcript after the card is gone
	await expect(askRow.getByTestId("ask-summary")).toContainText("Pick a color?");
	await expect(askRow.getByTestId("ask-summary")).toContainText("Blue");

	await app.reload();
	await expect(app.getByText("已连接")).toBeVisible();
	await sidebar(app).getByText("ASK me", { exact: true }).click();
	await expect(text(app, "you chose: Blue")).toBeVisible();
	await expect(app.getByRole("button", { name: "提交回答" })).toHaveCount(0);
	await expect(app.getByText("等待你的回应")).toHaveCount(0);
	const replayedAskRow = app.locator("[data-tool-call-id]").filter({ has: app.getByText("Pick a color?") });
	await expect(replayedAskRow).toHaveCount(1);
	await expect(replayedAskRow.getByTestId("ask-summary")).toContainText("Pick a color?");
});
