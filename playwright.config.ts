import { defineConfig } from "@playwright/test";
import { resolveChromium } from "./e2e/chromium";

const executablePath = resolveChromium();

export default defineConfig({
	testDir: "./e2e",
	testMatch: "**/*.spec.ts",
	timeout: 60_000,
	expect: { timeout: 10_000 },
	fullyParallel: true,
	workers: 4,
	retries: 0,
	reporter: [["list"]],
	outputDir: "./e2e/.results",
	use: {
		headless: true,
		viewport: { width: 1440, height: 900 },
		trace: "retain-on-failure",
		screenshot: "only-on-failure",
		launchOptions: executablePath ? { executablePath } : {},
	},
});
