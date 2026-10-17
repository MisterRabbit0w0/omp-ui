/**
 * E2E fixture: boots the real bridge (src/main.ts) against the fake omp on a
 * random port, with temp OMP_UI_HOME and PI_CODING_AGENT_DIR (fixture sessions).
 * Every test gets its own bridge; console errors fail the test.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test as base, expect, type Page } from "@playwright/test";

const ROOT = path.resolve(import.meta.dirname, "..");
const FAKE_OMP = path.join(ROOT, "packages/bridge/test/fake-omp.ts").replaceAll("\\", "/");

export interface Bridge {
	url: string;
	origin: string;
	token: string;
	agentDir: string;
	homeDir: string;
	cwd: string;
	/** JSON lines `{argv, cwd}` appended by every fake omp launch (FAKE_OMP_ARGV_LOG). */
	argvLog: string;
	fixtureIds: { plain: string; rich: string; long: string; pua: string };
}

export function writeFixtureSessions(agentDir: string, cwd: string): Bridge["fixtureIds"] {
	const longContent = Array.from({ length: 120 }, (_, i) => `const line${i + 1} = ${i + 1};`).join("\n");
	const dir = path.join(agentDir, "sessions", "--fixture-proj--");
	fs.mkdirSync(dir, { recursive: true });
	const ids = { plain: "01a00000-0000-7000-8000-00000000aaaa", rich: "01a00000-0000-7000-8000-00000000bbbb", long: "01a00000-0000-7000-8000-00000000cccc", pua: "01a00000-0000-7000-8000-00000000dddd" };
	const pad = " ".repeat(120);
	const build = (id: string, title: string, ts: string, body: unknown[]): string => {
		const lines: unknown[] = [
			{ type: "title", v: 1, title, updatedAt: ts, pad },
			{ type: "session", version: 3, id, timestamp: ts, cwd },
			...body,
		];
		return `${lines.map(l => JSON.stringify(l)).join("\n")}\n`;
	};
	const msg = (id: string, parentId: string | null, message: unknown) => ({
		type: "message",
		id,
		parentId,
		timestamp: "2026-09-01T10:00:00.000Z",
		message,
	});
	const usage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
	fs.writeFileSync(
		path.join(dir, `2026-09-01T10-00-00-000Z_${ids.plain}.jsonl`),
		build(ids.plain, "Fixture plain session", "2026-09-01T10:00:00.000Z", [
			msg("a1", null, { role: "user", content: [{ type: "text", text: "hello fixture" }], timestamp: 1 }),
			msg("a2", "a1", {
				role: "assistant",
				content: [{ type: "text", text: "fixture assistant reply" }],
				api: "fake", provider: "fake", model: "fake/model", usage, stopReason: "stop", timestamp: 2,
			}),
		]),
	);
	fs.writeFileSync(
		path.join(dir, `2026-09-02T10-00-00-000Z_${ids.rich}.jsonl`),
		build(ids.rich, "Fixture rich session", "2026-09-02T10:00:00.000Z", [
			msg("b1", null, { role: "user", content: [{ type: "text", text: "edit the file" }], timestamp: 1 }),
			msg("b2", "b1", {
				role: "assistant",
				content: [
					{ type: "text", text: "Reading then editing." },
					{ type: "toolCall", id: "t1", name: "read", arguments: { path: "src/a.ts" } },
					{ type: "toolCall", id: "t2", name: "bash", arguments: { command: "echo rich-output" } },
				],
				api: "fake", provider: "fake", model: "fake/model", usage, stopReason: "toolUse", timestamp: 2,
			}),
			msg("b3", "b2", { role: "toolResult", toolCallId: "t1", toolName: "read", content: [{ type: "text", text: "const a = 1;\n" }], isError: false, timestamp: 3 }),
			msg("b4", "b3", { role: "toolResult", toolCallId: "t2", toolName: "bash", content: [{ type: "text", text: "rich-output" }], isError: false, timestamp: 4 }),
			msg("b5", "b4", {
				role: "assistant",
				content: [{ type: "text", text: "Done.\n\n```ts\nconst answer = 42;\n```" }],
				api: "fake", provider: "fake", model: "fake/model", usage, stopReason: "stop", timestamp: 5,
			}),
		]),
	);
	fs.writeFileSync(
		path.join(dir, `2026-09-03T10-00-00-000Z_${ids.long}.jsonl`),
		build(ids.long, "Fixture long write", "2026-09-03T10:00:00.000Z", [
			msg("c1", null, { role: "user", content: [{ type: "text", text: "write a big file" }], timestamp: 1 }),
			msg("c2", "c1", {
				role: "assistant",
				content: [{ type: "toolCall", id: "w1", name: "write", arguments: { path: "big.ts", content: longContent } }],
				api: "fake", provider: "fake", model: "fake/model", usage, stopReason: "toolUse", timestamp: 2,
			}),
			msg("c3", "c2", { role: "toolResult", toolCallId: "w1", toolName: "write", content: [{ type: "text", text: "ok" }], isError: false, timestamp: 3 }),
		]),
	);
	fs.writeFileSync(
		path.join(dir, `2026-09-04T10-00-00-000Z_${ids.pua}.jsonl`),
		build(ids.pua, "\u{F08AE} Nerd glyph title", "2026-09-04T10:00:00.000Z", [
			msg("d1", null, { role: "user", content: [{ type: "text", text: "hi glyph" }], timestamp: 1 }),
		]),
	);
	return ids;
}

function sleep(ms: number): Promise<void> {
	const { promise, resolve } = Promise.withResolvers<void>();
	setTimeout(resolve, ms);
	return promise;
}

function resolveBun(): string {
	if (process.env.BUN_PATH) return process.env.BUN_PATH;
	const exts = process.platform === "win32" ? [".exe", ".cmd", ""] : [""];
	for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
		for (const ext of exts) {
			const candidate = path.join(dir, `bun${ext}`);
			if (dir && fs.existsSync(candidate)) return candidate;
		}
	}
	throw new Error("bun not found on PATH (set BUN_PATH)");
}

async function startBridge(): Promise<{ bridge: Bridge; stop: () => Promise<void> }> {
	const base = fs.mkdtempSync(path.join(os.tmpdir(), "omp-ui-e2e-"));
	const homeDir = path.join(base, "home");
	const agentDir = path.join(base, "agent");
	const cwd = path.join(base, "work");
	for (const d of [homeDir, agentDir, cwd]) fs.mkdirSync(d, { recursive: true });
	const argvLog = path.join(base, "argv.log");
	const fixtureIds = writeFixtureSessions(agentDir, cwd);

	const bun = resolveBun();
	const { spawn } = await import("node:child_process");
	const child = spawn(bun, [path.join(ROOT, "packages/bridge/src/main.ts"), "--port", "0"], {
		cwd: ROOT,
		env: {
			...process.env,
			OMP_UI_OMP_BIN: `"${bun.replaceAll("\\", "/")}" "${FAKE_OMP}"`,
			OMP_UI_HOME: homeDir,
			PI_CODING_AGENT_DIR: agentDir,
			INIT_CWD: cwd,
			FAKE_OMP_RICH: "1",
			FAKE_OMP_ARGV_LOG: argvLog,
		},
		stdio: ["ignore", "pipe", "pipe"],
		windowsHide: true,
	});
	let stderr = "";
	child.stderr.on("data", d => (stderr += String(d)));
	const { promise: urlPromise, resolve: resolveUrl, reject: rejectUrl } = Promise.withResolvers<string>();
	let out = "";
	const startTimer = setTimeout(() => rejectUrl(new Error(`bridge did not start: ${out}\n${stderr}`)), 20_000);
	child.stdout.on("data", d => {
		out += String(d);
		const m = /(http:\/\/127\.0\.0\.1:\d+\/#token=[0-9a-f]+)/.exec(out);
		if (m) {
			clearTimeout(startTimer);
			resolveUrl(m[1]!);
		}
	});
	child.on("exit", code => rejectUrl(new Error(`bridge exited ${code}: ${out}\n${stderr}`)));
	const url = await urlPromise;
	const u = new URL(url);
	const bridge: Bridge = {
		url,
		origin: u.origin,
		token: u.hash.replace("#token=", ""),
		agentDir,
		homeDir,
		cwd,
		argvLog,
		fixtureIds,
	};
	return {
		bridge,
		stop: async () => {
			child.removeAllListeners("exit");
			const exited = new Promise<void>(resolve => child.once("exit", () => resolve()));
			if (process.platform === "win32" && child.pid !== undefined) {
				// child.kill() only ends the bridge; its fake-omp children would keep the temp dir locked (EPERM).
				const { spawnSync } = await import("node:child_process");
				spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
			} else {
				child.kill();
			}
			await Promise.race([exited, sleep(3000)]);
			await sleep(150);
			// Best effort: a leftover temp dir must never fail a test.
			try {
				fs.rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
			} catch {
				/* the OS temp cleaner will get it */
			}
		},
	};
}

/** Records every error toast (the UI surfaces failures such as `e is not iterable` only as toasts). */
const TOAST_WATCHER = `
new MutationObserver(() => {
	for (const el of document.querySelectorAll('[data-toast-kind="error"]')) {
		if (!el.__seen) { el.__seen = true; console.debug("__ERROR_TOAST__ " + el.textContent); }
	}
}).observe(document, { childList: true, subtree: true });
`;

export function watchPage(page: Page, errors: string[]): void {
	page.on("console", m => {
		if (m.type() === "error") errors.push(`console.error: ${m.text()}`);
		if (m.type() === "debug" && m.text().startsWith("__ERROR_TOAST__")) errors.push(m.text());
	});
	page.on("pageerror", e => errors.push(`pageerror: ${e.message}`));
}

export const test = base.extend<{ bridge: Bridge; app: Page; consoleErrors: string[] }>({
	bridge: async ({}, use) => {
		const { bridge, stop } = await startBridge();
		await use(bridge);
		await stop();
	},
	consoleErrors: async ({}, use) => {
		await use([]);
	},
	app: async ({ page, bridge, consoleErrors }, use) => {
		await page.context().addInitScript(TOAST_WATCHER);
		watchPage(page, consoleErrors);
		await page.goto(bridge.url);
		await expect(page.getByText("已连接")).toBeVisible();
		await use(page);
		expect(consoleErrors, "console errors / error toasts").toEqual([]);
	},
});

export { expect };

/** Type into the composer and press Enter. */
export async function send(page: Page, text: string): Promise<void> {
	const box = page.getByRole("textbox", { name: "消息" });
	await box.fill(text);
	await box.press("Enter");
}

export interface OmpLaunch {
	argv: string[];
	cwd: string;
}

/** Every omp launch the bridge made so far, oldest first. Real launches only (model-catalog calls are `models --json`). */
export function launches(bridge: Bridge): OmpLaunch[] {
	if (!fs.existsSync(bridge.argvLog)) return [];
	const parsed: OmpLaunch[] = fs
		.readFileSync(bridge.argvLog, "utf8")
		.split("\n")
		.filter(line => line.trim().length > 0)
		.map(line => JSON.parse(line));
	return parsed.filter(l => l.argv.includes("--mode"));
}

/** Value following a CLI flag in a launch's argv. */
export function flagValue(launch: OmpLaunch, flag: string): string | undefined {
	const i = launch.argv.indexOf(flag);
	return i >= 0 ? launch.argv[i + 1] : undefined;
}

export const composerBox = (page: Page) => page.getByRole("textbox", { name: "消息" });

export const sidebar = (page: Page) => page.getByRole("complementary", { name: "会话" });
export const approvalCard = (page: Page) => page.getByRole("alertdialog");
export const approveBtn = (page: Page) => approvalCard(page).getByRole("button", { name: /^允许/ });
export const denyBtn = (page: Page) => approvalCard(page).getByRole("button", { name: /^拒绝/ });

/** Visible transcript text; omp also mirrors messages into an sr-only live region, so take the first match. */
export const text = (page: Page, value: string) => page.getByText(value).first();

/** True when a computed box-shadow paints nothing (Tailwind stacks transparent layers instead of "none"). */
export function shadowIsInvisible(shadow: string): boolean {
	if (shadow === "none") return true;
	return [...shadow.matchAll(/rgba?\(([^)]*)\)/g)].every(m => {
		const parts = m[1]!.split(",").map(x => x.trim());
		return parts.length === 4 && Number(parts[3]) === 0;
	});
}
