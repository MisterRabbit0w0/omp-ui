/**
 * Manual smoke run against the REAL omp (no prompts are sent, so no model cost).
 *   bun run smoke:real        (needs `omp` on PATH and a built web app)
 * 1. opens an existing real session read-only and checks the transcript renders;
 * 2. starts a new session in a temp dir and waits until it is ready (model/thinking shown).
 * OMP_UI_HOME is a temp dir; ~/.omp/agent is only read.
 */
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { chromium } from "@playwright/test";
import { resolveChromium } from "../chromium.ts";

const ROOT = path.resolve(import.meta.dirname, "../..");
// Not under e2e/.results: Playwright wipes its outputDir on every run.
const OUT = path.join(ROOT, "e2e/smoke-results");
fs.mkdirSync(OUT, { recursive: true });
const SESSION_ID = process.env.SMOKE_SESSION_ID ?? "01a11b69-8c97-73d4-a1a4-e627e438652d";

const env: NodeJS.ProcessEnv = { ...process.env, OMP_UI_HOME: fs.mkdtempSync(path.join(os.tmpdir(), "omp-ui-smoke-home-")) };
delete env.OMP_UI_OMP_BIN;
const bun = process.env.BUN_PATH ?? "bun";
const child = spawn(bun, [path.join(ROOT, "packages/bridge/src/main.ts"), "--port", "0"], { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
const { promise: urlPromise, resolve: resolveUrl, reject: rejectUrl } = Promise.withResolvers<string>();
let out = "";
child.stdout.on("data", d => {
	out += String(d);
	const m = /(http:\/\/127\.0\.0\.1:\d+\/#token=[0-9a-f]+)/.exec(out);
	if (m) resolveUrl(m[1]!);
});
child.stderr.on("data", d => (out += String(d)));
child.on("exit", code => rejectUrl(new Error(`bridge exited ${code}: ${out}`)));

const problems: string[] = [];
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
	const url = await urlPromise;
	console.log("bridge:", out.split("\n")[0]);
	const executablePath = resolveChromium();
	browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
	const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
	await page.context().addInitScript(`
		new MutationObserver(() => { for (const el of document.querySelectorAll('[data-toast-kind="error"]')) { if (!el.__seen) { el.__seen = true; console.debug("__ERROR_TOAST__ " + el.textContent); } } }).observe(document, { childList: true, subtree: true });
	`);
	page.on("console", m => {
		if (m.type() === "error") problems.push(`console.error: ${m.text()}`);
		if (m.type() === "debug" && m.text().startsWith("__ERROR_TOAST__")) problems.push(m.text());
	});
	page.on("pageerror", e => problems.push(`pageerror: ${e.message}`));
	await page.goto(url);
	await page.getByText("已连接").waitFor({ timeout: 15_000 });

	// 1. read-only preview of an existing real session
	const res = await page.request.get(new URL("/api/sessions", url).toString(), { headers: { authorization: `Bearer ${new URL(url).hash.slice(7)}` } });
	const sessions = ((await res.json()) as { id: string; title: string; cwd: string }[]).map(s => ({
		...s,
		// The UI strips private-use glyphs (Nerd Font icons) from titles, so match on the displayed text.
		title: s.title.replace(/[\uE000-\uF8FF\u{F0000}-\u{10FFFF}]/gu, "").trim(),
	}));
	const target = sessions.find(s => s.id === SESSION_ID) ?? sessions[0]!;
	console.log(`sessions listed: ${sessions.length}; opening "${target.title}" (${target.id})`);
	await page.getByRole("complementary", { name: "会话" }).getByLabel("搜索会话").fill(target.title || target.cwd);
	await page.getByRole("complementary", { name: "会话" }).getByText(target.title || path.basename(target.cwd)).first().click();
	await page.locator("[data-tool-call-id]").first().waitFor({ timeout: 20_000 });
	const toolRows = await page.locator("[data-tool-call-id]").count();
	// expand the first few tool rows so diffs / code blocks are rendered
	const triggers = page.locator("[data-tool-call-id] > button[aria-expanded=false]");
	for (let i = 0; i < Math.min(6, await triggers.count()); i++) await triggers.nth(i).click({ timeout: 2000 }).catch(() => undefined);
	await page.waitForTimeout(800);
	const stats = await page.evaluate(() => ({
		toolRows: document.querySelectorAll("[data-tool-call-id]").length,
		codeBlocks: document.querySelectorAll("pre, code").length,
		// DiffView renders a 合并/并排 (unified/split) toggle and +N/−N counters
		diffViews: [...document.querySelectorAll("button")].filter(b => b.textContent?.trim() === "并排").length,
		composerDisabled: (document.querySelector('textarea[aria-label="消息"]') as HTMLTextAreaElement | null)?.disabled ?? null,
	}));
	console.log("transcript:", JSON.stringify({ ...stats, toolRowsAtOpen: toolRows }));
	await page.screenshot({ path: path.join(OUT, "real-readonly-session.png") });
	if (stats.toolRows === 0) problems.push("no tool rows rendered for the real session");
	if (stats.diffViews === 0) problems.push("no diff view rendered for the real session");

	// 2. welcome page (Ctrl+N): no dialog; project via typed path (native picker stubbed), model/permission controls present.
	// A session only starts on send now, and the smoke run must not prompt a real model, so it stops before sending.
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "omp-ui-smoke-cwd-"));
	await page.route("**/api/pick-dir", route => route.fulfill({ status: 501, contentType: "application/json", body: '{"error":"no picker"}' }));
	await page.reload();
	await page.getByText("已连接").waitFor();
	await page.keyboard.press("Control+n");
	await page.getByTestId("composer-context-strip").waitFor();
	if ((await page.getByRole("dialog").count()) > 0) problems.push("a dialog opened on 新对话");
	await page.getByRole("button", { name: /^项目：|^选择项目$/ }).click();
	await page.getByRole("button", { name: "选择文件夹…" }).click();
	const cwdInput = page.getByRole("textbox", { name: "项目目录路径" });
	await cwdInput.fill(tmp);
	await cwdInput.press("Enter");
	await page.getByRole("button", { name: `项目：${path.basename(tmp)}` }).waitFor({ timeout: 10_000 });
	const model = await page.getByRole("button", { name: /^模型：/ }).getAttribute("aria-label");
	const permission = await page.getByRole("button", { name: /^权限：/ }).getAttribute("aria-label");
	console.log("welcome composer ready:", model, "|", permission, "| cwd", tmp);
	await page.waitForTimeout(500);
	await page.screenshot({ path: path.join(OUT, "real-new-session-ready.png") });
} catch (error) {
	problems.push(`smoke failed: ${(error as Error).message}`);
} finally {
	await browser?.close();
	child.removeAllListeners("exit");
	child.kill();
}
console.log(problems.length === 0 ? "SMOKE OK (no console errors / error toasts)" : `SMOKE PROBLEMS:\n- ${problems.join("\n- ")}`);
process.exit(problems.length === 0 ? 0 : 1);
