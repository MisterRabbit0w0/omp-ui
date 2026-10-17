import type { Page } from "@playwright/test";
import { expect, send, sidebar, test } from "./fixtures";

const scroller = (page: Page) => page.locator(".scroll.flex-1.overflow-auto").first();
const distFromBottom = (page: Page) =>
	scroller(page).evaluate((el: HTMLElement) => el.scrollHeight - el.scrollTop - el.clientHeight);
const scrollTop = (page: Page) => scroller(page).evaluate((el: HTMLElement) => el.scrollTop);
const prose = (page: Page, text: string) => page.getByRole("paragraph").filter({ hasText: text });

test("streaming follows while at the bottom and stays put after scrolling up; one arrow on the button", async ({ app }) => {
	await send(app, "LONG follow");
	await expect(prose(app, "paragraph 20:")).toBeVisible();
	// at the bottom: every sample while streaming stays pinned (run indicator included)
	for (let i = 0; i < 5; i++) {
		expect(await distFromBottom(app)).toBeLessThanOrEqual(2);
		await app.waitForTimeout(120);
	}

	// user scrolls up: the view must not move while content keeps arriving
	await scroller(app).hover();
	await app.mouse.wheel(0, -600);
	await app.waitForTimeout(200);
	const top = await scrollTop(app);
	await app.waitForTimeout(600);
	expect(await scrollTop(app)).toBe(top);

	const button = app.getByRole("button", { name: /^(新消息|回到底部)$/ });
	await expect(button).toBeVisible();
	await expect(button).not.toContainText("↓");
	await button.click();
	await expect.poll(() => distFromBottom(app)).toBeLessThanOrEqual(2);
	await expect(prose(app, "LONG DONE")).toBeVisible();
});

test("switching sessions mid-run and back keeps the history visible and pinned", async ({ app }) => {
	await send(app, "first prompt");
	await app.getByRole("button", { name: /^允许/ }).click();
	await expect(prose(app, "Command finished: hi")).toBeVisible();
	await send(app, "LONG switch");
	await expect(prose(app, "paragraph 5:")).toBeVisible();

	await sidebar(app).getByText("Fixture plain session").click();
	await expect(prose(app, "fixture assistant reply")).toBeVisible();
	await sidebar(app).getByText("first prompt").click();

	await expect(prose(app, "LONG DONE")).toBeVisible();
	await expect(prose(app, "paragraph 1:")).toHaveCount(1);
	await expect.poll(() => distFromBottom(app)).toBeLessThanOrEqual(2);
	// history above the running turn is rendered once scrolled to
	await scroller(app).evaluate((el: HTMLElement) => (el.scrollTop = 0));
	await expect(prose(app, "fake reply to: first prompt")).toBeVisible();
});

test("todo tab: single plus on the add row", async ({ app }) => {
	await send(app, "ASK me");
	await app.getByRole("tab", { name: /待办/ }).click();
	const add = app.getByRole("button", { name: "添加", exact: true });
	await expect(add).toBeVisible();
	await expect(add).not.toContainText("+");
});
