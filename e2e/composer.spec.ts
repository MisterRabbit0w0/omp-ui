import * as fs from "node:fs";
import * as path from "node:path";
import type { Page } from "@playwright/test";
import {
	approvalCard,
	approveBtn,
	composerBox,
	expect,
	flagValue,
	launches,
	send,
	sidebar,
	test,
	text,
	type Bridge,
} from "./fixtures";

const RESULTS = path.join(import.meta.dirname, "smoke-results");

/**
 * The bridge cannot show a native folder picker here: answer 501 so the menu falls back to the typed path.
 * Chrome logs every non-2xx fetch as a console error; that one expected entry is dropped from the fixture's list.
 */
async function noNativePicker(page: Page, consoleErrors: string[]): Promise<void> {
	await page.route("**/api/pick-dir", route => route.fulfill({ status: 501, contentType: "application/json", body: '{"error":"no picker"}' }));
	page.on("console", m => {
		if (m.type() !== "error" || !m.text().includes("status of 501")) return;
		const i = consoleErrors.findIndex(e => e.includes("status of 501"));
		if (i >= 0) consoleErrors.splice(i, 1);
	});
}

const rightPanel = (page: Page) => page.locator("aside.right");

const popover = (page: Page) => page.getByRole("dialog").last();
const projectButton = (page: Page) => page.getByRole("button", { name: /^项目：|^选择项目$/ });
const permissionChip = (page: Page) => page.getByRole("button", { name: /^权限：/ });

/** Welcome page -> typed project path (via the 501 fallback of 选择文件夹…). */
async function pickTypedProject(page: Page, dir: string): Promise<void> {
	await projectButton(page).click();
	await popover(page).getByRole("button", { name: "选择文件夹…" }).click();
	const input = popover(page).getByRole("textbox", { name: "项目目录路径" });
	await expect(input).toBeVisible();
	await input.fill(dir);
	await input.press("Enter");
}

function otherProject(bridge: Bridge): string {
	const dir = path.join(path.dirname(bridge.cwd), "elsewhere");
	fs.mkdirSync(dir, { recursive: true });
	return dir;
}

test("welcome page: no project line, no right panel, header shows only the title; strip lists the recent project", async ({ app, bridge }) => {
	await expect(app.getByText("今天做点什么？")).toBeVisible();
	await expect(app.locator("main").getByText("在", { exact: true })).toHaveCount(0);
	await expect(rightPanel(app)).toHaveCount(0);
	await expect(app.locator(".hdr .title")).toHaveText("新对话");
	await expect(app.locator(".hdr .chip.mono")).toHaveCount(0);
	await expect(app.getByRole("button", { name: "更多" })).toHaveCount(0);
	await expect(app.getByRole("button", { name: "右侧面板" })).toHaveCount(0);

	const strip = app.getByTestId("composer-context-strip");
	await expect(strip).toBeVisible();
	await expect(projectButton(app)).toHaveAccessibleName(`项目：${path.basename(bridge.cwd)}`);

	await projectButton(app).click();
	await expect(popover(app).getByRole("textbox", { name: "搜索项目" })).toBeVisible();
	await expect(popover(app).getByText(path.basename(bridge.cwd), { exact: true }).first()).toBeVisible();
	await popover(app).getByRole("textbox", { name: "搜索项目" }).fill("zzz-nothing");
	await expect(popover(app).getByText("没有匹配的项目")).toBeVisible();
});

test("welcome -> project menu -> 完全访问 -> model + thinking -> send: bridge starts omp with exactly those args", async ({ app, bridge, consoleErrors }) => {
	await noNativePicker(app, consoleErrors);
	const dir = otherProject(bridge);

	// project: an invalid path is rejected by the bridge, a valid one is accepted
	await projectButton(app).click();
	await popover(app).getByRole("button", { name: "选择文件夹…" }).click();
	const input = popover(app).getByRole("textbox", { name: "项目目录路径" });
	await input.fill(path.join(dir, "missing"));
	await input.press("Enter");
	await expect(popover(app).getByRole("alert")).toHaveText("目录不存在");
	await input.fill(dir);
	await input.press("Enter");
	await expect(projectButton(app)).toHaveAccessibleName("项目：elsewhere");

	// permission
	await permissionChip(app).click();
	await expect(popover(app).getByText("作用于这次新建的会话")).toBeVisible();
	await popover(app).getByRole("menuitemradio", { name: /完全访问/ }).click();
	await expect(permissionChip(app)).toHaveAccessibleName("权限：完全访问");

	// model + thinking in the one merged button; the menu stays open after picking a model
	await expect(app.getByRole("button", { name: /^思考级别/ })).toHaveCount(0);
	await app.getByRole("button", { name: /^模型：/ }).click();
	await popover(app).getByRole("button", { name: /model-mini/ }).click();
	await expect(popover(app).getByRole("textbox", { name: "搜索模型" })).toBeVisible();
	await popover(app).getByRole("radio", { name: "低", exact: true }).click();
	await expect(popover(app).getByRole("radio", { name: "低", exact: true })).toHaveAttribute("aria-checked", "true");
	await app.keyboard.press("Escape");
	await expect(app.getByRole("button", { name: /^模型：/ })).toHaveAccessibleName("模型：model-mini，思考：低");

	expect(launches(bridge)).toHaveLength(0);
	await send(app, "hello");
	await expect.poll(() => launches(bridge).length).toBe(1);
	const [launch] = launches(bridge);
	expect(path.basename(launch!.cwd)).toBe("elsewhere");
	expect(flagValue(launch!, "--model")).toBe("fake/model-mini");
	expect(flagValue(launch!, "--thinking")).toBe("low");
	expect(flagValue(launch!, "--approval-mode")).toBe("yolo");

	await approveBtn(app).click();
	await expect(text(app, "Command finished: hi")).toBeVisible();
	// the session shows the mode it was started with, and the context strip is gone (cwd is fixed now)
	await expect(permissionChip(app)).toHaveAccessibleName("权限：完全访问");
	await expect(app.getByTestId("composer-context-strip")).toHaveCount(0);
});

test("the last used project, model and permission are remembered on the next welcome page", async ({ app, bridge, consoleErrors }) => {
	await noNativePicker(app, consoleErrors);
	const dir = otherProject(bridge);
	await pickTypedProject(app, dir);
	await permissionChip(app).click();
	await popover(app).getByRole("menuitemradio", { name: /每次询问/ }).click();
	await send(app, "remember me");
	await approveBtn(app).click();
	await expect(text(app, "Command finished: hi")).toBeVisible();

	await app.reload();
	await expect(app.getByText("已连接")).toBeVisible();
	await sidebar(app).getByRole("button", { name: /^新对话/ }).click();
	await expect(projectButton(app)).toHaveAccessibleName("项目：elsewhere");
	await expect(permissionChip(app)).toHaveAccessibleName("权限：每次询问");
});

test("live session: switching permission restarts with --resume, keeps the transcript, and is locked while a run is active", async ({ app, bridge }) => {
	await send(app, "hello");
	await expect(approvalCard(app)).toBeVisible();

	// run in progress: the menu opens but every row is disabled with the hint
	await permissionChip(app).click();
	await expect(popover(app).getByText("运行结束后可切换")).toBeVisible();
	for (const row of await popover(app).getByRole("menuitemradio").all()) await expect(row).toBeDisabled();
	await app.keyboard.press("Escape");

	await approveBtn(app).click();
	await expect(text(app, "Command finished: hi")).toBeVisible();
	await expect(approvalCard(app)).toHaveCount(0);
	expect(launches(bridge)).toHaveLength(1);
	expect(flagValue(launches(bridge)[0]!, "--approval-mode")).toBe("write");

	await permissionChip(app).click();
	await expect(popover(app).getByText("切换会重启会话进程，历史不受影响")).toBeVisible();
	await popover(app).getByRole("menuitemradio", { name: /完全访问/ }).click();

	await expect.poll(() => launches(bridge).length).toBe(2);
	const second = launches(bridge)[1]!;
	expect(flagValue(second, "--approval-mode")).toBe("yolo");
	expect(flagValue(second, "--resume")).toMatch(/\.jsonl$/);

	// back to ready: chip reflects the new mode, input is usable, no process-exit banner, history intact
	await expect(permissionChip(app)).toHaveAccessibleName("权限：完全访问");
	await expect(composerBox(app)).toBeEnabled();
	await expect(app.getByText(/会话进程已退出/)).toHaveCount(0);
	await expect(text(app, "fake reply to: hello")).toBeVisible();
	await expect(text(app, "Command finished: hi")).toBeVisible();

	// and the resumed process keeps working on the same transcript
	await send(app, "second turn");
	await expect(approvalCard(app)).toBeVisible();
	await approveBtn(app).click();
	await expect(text(app, "fake reply to: second turn")).toBeVisible();
	await expect(text(app, "fake reply to: hello")).toBeVisible();
	await expect(sidebar(app).getByText("hello", { exact: true })).toHaveCount(1);
});

test("新对话 (sidebar, Ctrl+N, palette, group +) opens no dialog: welcome page, composer focused", async ({ app, bridge }) => {
	const noDialog = app.getByRole("dialog");
	const expectWelcome = async () => {
		await expect(app.getByTestId("composer-context-strip")).toBeVisible();
		await expect(composerBox(app)).toBeFocused();
		await expect(noDialog).toHaveCount(0);
		await expect(app.locator(".hdr .title")).toHaveText("新对话");
	};
	const openFixture = async () => {
		await sidebar(app).getByText("Fixture rich session").click();
		await expect(app.getByTestId("composer-context-strip")).toHaveCount(0);
		await expect(rightPanel(app)).toBeVisible();
	};

	await openFixture();
	await sidebar(app).getByRole("button", { name: /^新对话/ }).click();
	await expectWelcome();
	await expect(rightPanel(app)).toHaveCount(0);

	await openFixture();
	await app.locator("main").click({ position: { x: 5, y: 300 } }); // focus leaves the composer
	await app.keyboard.press("Control+n");
	await expectWelcome();

	await openFixture();
	await app.keyboard.press("Control+k");
	await app.getByRole("textbox", { name: "命令面板搜索" }).fill("新对话");
	await app.getByRole("dialog", { name: "命令面板" }).getByText("新对话", { exact: true }).click();
	await expect(app.getByRole("dialog", { name: "命令面板" })).toHaveCount(0);
	await expectWelcome();

	// group "+" preselects that group's project, overriding the remembered one
	const remembered = path.join(path.dirname(bridge.cwd), "elsewhere");
	await app.evaluate(dir => localStorage.setItem("omp-ui:new-session-config", JSON.stringify({ cwd: dir })), remembered);
	await app.reload();
	await expect(app.getByText("已连接")).toBeVisible();
	await expect(projectButton(app)).toHaveAccessibleName("项目：elsewhere");
	await openFixture();
	const group = sidebar(app).getByText(path.basename(bridge.cwd), { exact: true }).first();
	await group.hover();
	await sidebar(app).getByRole("button", { name: "在此项目新建会话" }).first().click();
	await expectWelcome();
	await expect(projectButton(app)).toHaveAccessibleName(`项目：${path.basename(bridge.cwd)}`);
});

test("sending without any project asks for one instead of starting in '.'", async ({ app, bridge }) => {
	// no session files -> no projects; nothing remembered
	for (const f of fs.readdirSync(path.join(bridge.agentDir, "sessions"))) fs.rmSync(path.join(bridge.agentDir, "sessions", f), { recursive: true, force: true });
	await app.reload();
	await expect(app.getByText("已连接")).toBeVisible();
	await expect(projectButton(app)).toHaveAccessibleName("选择项目");
	await composerBox(app).fill("hello");
	await composerBox(app).press("Enter");
	await expect(app.getByText("请先选择一个项目")).toBeVisible();
	await expect(popover(app).getByRole("textbox", { name: "搜索项目" })).toBeVisible();
	expect(launches(bridge)).toHaveLength(0);
});

test("screenshots: welcome + live composer, light and dark", async ({ app }) => {
	fs.mkdirSync(RESULTS, { recursive: true });
	// Settled captures: the reconnect bar has faded out, transitions/animations are fast-forwarded.
	const shoot = async (name: string) => {
		await expect(app.locator("main").getByRole("status")).toHaveCount(0);
		await app.mouse.move(700, 120);
		await app.screenshot({ path: path.join(RESULTS, name), animations: "disabled" });
	};
	const theme = async (mode: "light" | "dark") => {
		await app.evaluate(m => localStorage.setItem("omp-ui-theme", m), mode);
		await app.reload();
		await expect(app.getByText("已连接")).toBeVisible();
		await expect.poll(() => app.locator("html").evaluate(el => el.classList.contains("dark"))).toBe(mode === "dark");
	};

	for (const mode of ["light", "dark"] as const) {
		await theme(mode);
		await expect(app.getByTestId("composer-context-strip")).toBeVisible();
		await expect(app.getByRole("button", { name: /^解释这个仓库的结构|^找出并修复失败的测试|^审查未提交的改动/ })).not.toHaveCount(0);
		await shoot(`composer-welcome-${mode}.png`);
	}

	// Live session: start it in each theme (a reload returns to the welcome page).
	for (const mode of ["light", "dark"] as const) {
		await theme(mode);
		await send(app, `hello ${mode}`);
		await approveBtn(app).click();
		await expect(text(app, "Command finished: hi")).toBeVisible();
		await expect(app.getByTestId("run-indicator")).toHaveCount(0);
		await shoot(`composer-live-${mode}.png`);
	}
});
