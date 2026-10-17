import { expect, sidebar, test } from "./fixtures";

test("m8: sidebar group labels are uppercase", async ({ app }) => {
	await expect(sidebar(app).getByText("Fixture rich session")).toBeVisible();
	const label = sidebar(app).locator("div.uppercase, span.uppercase").first();
	expect(await label.evaluate(el => getComputedStyle(el).textTransform)).toBe("uppercase");
});

test("m9: cwd chip never clips mid-character at 1280 wide", async ({ app }) => {
	await app.setViewportSize({ width: 1280, height: 800 });
	await sidebar(app).getByText("Fixture rich session").click();
	const chip = app.locator(".chip.mono").first();
	await expect(chip).toBeVisible();
	const m = await chip.evaluate(el => {
		const inner = el.firstElementChild as HTMLElement;
		return { chipW: el.getBoundingClientRect().width, textW: inner.getBoundingClientRect().width, text: inner.textContent ?? "" };
	});
	expect(m.chipW).toBeLessThanOrEqual(240);
	expect(m.textW).toBeLessThanOrEqual(m.chipW - 12 + 0.5); // fits inside the padding box: nothing clipped
	expect(m.text).toContain("…"); // temp path is longer than the budget: middle-ellipsis, keeps the tail
	expect(m.text.endsWith("/work")).toBe(true);
});

test("m11: private-use glyphs are stripped from titles (sidebar, header, palette)", async ({ app }) => {
	await sidebar(app).getByText("Nerd glyph title").click();
	await expect(app.locator(".hdr .title")).toHaveText("Nerd glyph title");
	const pua = /[\uE000-\uF8FF]|[\u{F0000}-\u{10FFFF}]/u;
	expect(pua.test(await sidebar(app).innerText())).toBe(false);
	await app.keyboard.press("Control+k");
	const palette = app.getByRole("dialog", { name: "命令面板" });
	await palette.getByRole("textbox", { name: "命令面板搜索" }).fill("Nerd");
	await expect(palette.getByText("Nerd glyph title")).toBeVisible();
	expect(pua.test(await palette.innerText())).toBe(false);
});

test("m12: highlight rests on the current session row after a keyboard switch (pointer never over the sidebar)", async ({ app }) => {
	await app.mouse.move(700, 450);
	await expect(sidebar(app).getByText("Fixture rich session")).toBeVisible();
	const hl = sidebar(app).locator(".hl");
	const activeTop = () => sidebar(app).locator("[data-hl-active]").evaluate(el => (el as HTMLElement).offsetTop);
	const hlTop = () => hl.evaluate(el => (el as HTMLElement).offsetTop);
	// Alt+Down selects a session without any pointer event over the list
	await app.keyboard.press("Alt+ArrowDown");
	await expect(sidebar(app).locator("[data-hl-active]")).toHaveCount(1);
	await expect.poll(() => hl.evaluate(el => getComputedStyle(el).opacity)).toBe("1");
	expect(await hlTop()).toBe(await activeTop());
	// and it follows the next switch
	const before = await activeTop();
	await app.keyboard.press("Alt+ArrowDown");
	await expect.poll(activeTop).not.toBe(before);
	await expect.poll(async () => (await hlTop()) === (await activeTop())).toBe(true);
});

test("m13: a restored '/' draft does not open the slash menu until the user types", async ({ app }) => {
	await app.evaluate(() => localStorage.setItem("omp-ui:draft:__welcome__", "/"));
	await app.reload();
	await expect(app.getByText("已连接")).toBeVisible();
	const box = app.getByRole("textbox", { name: "消息" });
	await expect(box).toHaveValue("/");
	await expect(app.getByRole("listbox", { name: "Slash 命令" })).toHaveCount(0);
	await box.press("Backspace");
	await box.type("/");
	await expect(app.getByRole("listbox", { name: "Slash 命令" })).toBeVisible();
});
