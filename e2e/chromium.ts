import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { chromium } from "@playwright/test";

/**
 * Prefer the Chromium revision Playwright expects; when it is not installed
 * fall back to the newest installed one (avoids a download in offline/CI-less setups).
 */
export function resolveChromium(): string | undefined {
	if (process.env.PW_CHROMIUM_PATH) return process.env.PW_CHROMIUM_PATH;
	const expected = chromium.executablePath();
	if (fs.existsSync(expected)) return undefined;
	const root =
		process.env.PLAYWRIGHT_BROWSERS_PATH ??
		(process.platform === "win32"
			? path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local"), "ms-playwright")
			: process.platform === "darwin"
				? path.join(os.homedir(), "Library", "Caches", "ms-playwright")
				: path.join(os.homedir(), ".cache", "ms-playwright"));
	if (!fs.existsSync(root)) return undefined;
	const dirs = fs
		.readdirSync(root)
		.filter(d => /^chromium-\d+$/.test(d))
		.sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
	const exe = process.platform === "win32" ? ["chrome-win64", "chrome.exe"] : process.platform === "darwin" ? [] : ["chrome-linux", "chrome"];
	for (const d of dirs) {
		const candidate = path.join(root, d, ...exe);
		if (exe.length > 0 && fs.existsSync(candidate)) return candidate;
	}
	return undefined;
}
