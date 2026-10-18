import { expect, send, sidebar, test, approveBtn, approvalCard, text } from "./fixtures";

/** FRONTEND §2.5/§3/§6: rem-based sizes must not be scaled by the "base font size" setting (M2). */
test("key sizes match the spec at 16px root", async ({ app }) => {
	expect(await app.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe("16px");
	expect(await app.evaluate(() => getComputedStyle(document.body).fontSize)).toBe("13px");

	const box = async (loc: ReturnType<typeof app.locator>) => {
		const b = (await loc.first().boundingBox())!;
		return { w: Math.round(b.width * 100) / 100, h: Math.round(b.height * 100) / 100 };
	};
	// header 44
	expect((await box(app.locator(".hdr"))).h).toBe(44);
	// session row 32 (fixture sessions)
	await expect(sidebar(app).getByText("Fixture rich session")).toBeVisible();
	expect((await box(app.locator("[data-hl-item]").first())).h).toBe(32);

	// tool row 28 (open a fixture session that has tool calls)
	await sidebar(app).getByText("Fixture rich session").click();
	await expect(app.locator("[data-tool-call-id]").first()).toBeVisible();
	expect((await box(app.locator("[data-tool-call-id] > button").first())).h).toBe(28);
});

test("the font-size setting scales arbitrary px text but never the rem root or 44px header", async ({ app }) => {
	await app.evaluate(() => {
		localStorage.setItem("omp-ui:appearance-prefs", JSON.stringify({ fontSize: 14, compact: false, sound: false }));
	});
	await app.reload();
	await expect(app.getByText("已连接")).toBeVisible();
	expect(await app.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe("16px");
	expect(await app.evaluate(() => getComputedStyle(document.body).fontSize)).toBe("14px");
	expect((await app.locator(".hdr").first().boundingBox())!.height).toBe(44);

	// UI chrome uses Tailwind arbitrary px sizes; the setting scales those too.
	const rowTitle = sidebar(app).getByText("Fixture rich session");
	expect(await rowTitle.evaluate(el => getComputedStyle(el).fontSize)).toBe("14px");
});

test("compact mode tightens transcript spacing without shrinking row hit areas", async ({ app }) => {
	await app.evaluate(() => {
		localStorage.setItem("omp-ui:appearance-prefs", JSON.stringify({ fontSize: 13, compact: true, sound: false }));
	});
	await app.reload();
	await expect(app.getByText("已连接")).toBeVisible();
	await sidebar(app).getByText("Fixture rich session").click();
	await expect(app.locator("[data-tool-call-id]").first()).toBeVisible();

	const margin = await app.evaluate(() => {
		const el = document.querySelector(".col .my-6");
		return el ? getComputedStyle(el).marginTop : null;
	});
	expect(margin).toBe("12px");
	expect((await app.locator("[data-tool-call-id] > button").first().boundingBox())!.height).toBe(28);
});

test("approval card has no countdown bar without a timeout and no focus ring (M4/M5)", async ({ app }) => {
	await send(app, "hello");
	const card = approvalCard(app);
	await expect(card).toBeVisible();
	await expect(card.locator('[style*="countdown"]')).toHaveCount(0);
	await expect(card.locator("div.h-\\[2px\\]")).toHaveCount(0);
	await card.focus();
	const shadow = await card.evaluate(el => getComputedStyle(el).boxShadow);
	expect(shadow === "none" || /rgba\(0, 0, 0, 0\)/.test(shadow)).toBe(true);
	await approveBtn(app).click();
	await expect(text(app, "Command finished: hi")).toBeVisible();
	// awaiting row had no 等待批准 label (m15)
	await expect(app.getByText("等待批准")).toHaveCount(0);
});

test("long write diff is capped at 480px with an expand button, line numbers are muted (M3/m10)", async ({ app }) => {
	await sidebar(app).getByText("Fixture long write").click();
	const row = app.locator("[data-tool-call-id]").first();
	await row.getByRole("button").first().click();
	const body = app.getByTestId("diff-body");
	await expect(body).toBeVisible();
	expect((await body.boundingBox())!.height).toBeLessThanOrEqual(480);
	const expand = app.getByRole("button", { name: /展开（共 \d+ 行）/ });
	await expect(expand).toBeVisible();

	// §6.9: 11px, ink-3 at 60% opacity
	const num = body.locator("span.tabular-nums").first();
	const style = await num.evaluate(el => ({ size: getComputedStyle(el).fontSize, opacity: getComputedStyle(el).opacity }));
	expect(style).toEqual({ size: "11px", opacity: "0.6" });

	await expand.click();
	await expect(expand).toHaveCount(0);
	expect((await body.boundingBox())!.height).toBeGreaterThan(480);
});
