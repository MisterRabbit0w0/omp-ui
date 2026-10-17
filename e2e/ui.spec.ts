import { approveBtn, approvalCard, expect, send, test, text, shadowIsInvisible } from "./fixtures";
import type { Page } from "@playwright/test";

/** A finished live session, so commands/models are loaded. */
async function liveSession(app: Page): Promise<void> {
	await send(app, "hello");
	await approveBtn(app).click();
	await expect(text(app, "Command finished: hi")).toBeVisible();
	await expect(approvalCard(app)).toHaveCount(0);
}

test("slash menu opens on /", async ({ app }) => {
	await liveSession(app);
	const box = app.getByRole("textbox", { name: "消息" });
	await box.fill("/");
	const menu = app.getByRole("listbox", { name: "Slash 命令" });
	await expect(menu).toBeVisible();
	await expect(menu.getByRole("option", { name: /compact/ })).toBeVisible();
	await box.fill("");
	await expect(menu).toHaveCount(0);
});

test("model menu opens", async ({ app }) => {
	await liveSession(app);
	await app.getByRole("button", { name: /^模型：/ }).click();
	await expect(app.getByRole("textbox", { name: "搜索模型" })).toBeVisible();
	await expect(app.getByRole("button", { name: /model-mini/ }).or(app.getByText("model-mini")).first()).toBeVisible();
});

test("panel tabs switch", async ({ app }) => {
	await liveSession(app);
	for (const name of ["子代理", "变更", "目标", "信息", "待办"]) {
		const tab = app.getByRole("tab", { name });
		await tab.click();
		await expect(tab).toHaveAttribute("aria-selected", "true");
	}
});

test("command palette via Ctrl+K and theme toggle", async ({ app }) => {
	const dialog = app.getByRole("dialog", { name: "命令面板" });
	const html = app.locator("html");
	// Theme cycles system -> light -> dark; headless "system" resolves to light, so toggle twice.
	const toggleTheme = async () => {
		await app.keyboard.press("Control+k");
		await expect(dialog).toBeVisible();
		await app.getByRole("textbox", { name: "命令面板搜索" }).fill("主题");
		await app.getByText("切换明暗主题").click();
		await expect(dialog).toHaveCount(0);
	};
	await toggleTheme();
	await expect.poll(() => app.evaluate(() => localStorage.getItem("omp-ui-theme"))).toBe("light");
	await toggleTheme();
	await expect.poll(() => app.evaluate(() => localStorage.getItem("omp-ui-theme"))).toBe("dark");
	await expect.poll(() => html.evaluate(el => el.classList.contains("dark"))).toBe(true);

	await app.keyboard.press("Control+k");
	await expect(dialog).toBeVisible();
	await app.keyboard.press("Escape");
	await expect(dialog).toHaveCount(0);
});

test("inputs inside composite controls show no inner focus ring (FRONTEND §2.2)", async ({ app }) => {
	const shadowOf = (loc: ReturnType<typeof app.locator>) => loc.evaluate(el => getComputedStyle(el).boxShadow);
	const box = app.getByRole("textbox", { name: "消息" });
	const composer = app.locator(".composer");
	const borderBefore = await composer.evaluate(el => getComputedStyle(el).borderTopColor);
	await box.focus();
	await app.keyboard.press("Shift+Tab");
	await app.keyboard.press("Tab"); // keyboard focus => :focus-visible
	await expect(box).toBeFocused();
	expect(shadowIsInvisible(await shadowOf(box))).toBe(true);
	await expect.poll(() => composer.evaluate(el => getComputedStyle(el).borderTopColor)).not.toBe(borderBefore);

	const search = app.getByRole("textbox", { name: "搜索会话" });
	await search.focus();
	expect(shadowIsInvisible(await shadowOf(search))).toBe(true);

	await app.keyboard.press("Control+k");
	const palette = app.getByRole("textbox", { name: "命令面板搜索" });
	await expect(palette).toBeFocused();
	expect(shadowIsInvisible(await shadowOf(palette))).toBe(true);
});

test("welcome composer: no hardcoded model; menu lists the bridge's model catalog (M7)", async ({ app }) => {
	const button = app.getByRole("button", { name: /^模型：/ });
	await expect(button).toBeVisible();
	await expect(button).not.toContainText("opus-5.5");
	await expect(button).toContainText("选择模型");
	await button.click();
	// catalog = `omp models --json` of the fake omp (embedding kind filtered out)
	await expect(app.getByText("model-mini").first()).toBeVisible();
	await expect(app.getByText("embed")).toHaveCount(0);
});
