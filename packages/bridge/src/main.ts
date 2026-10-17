/**
 * Bridge entry point: prints `http://127.0.0.1:<port>/#token=<token>`.
 *
 * Flags: `--port N` (default 4317, auto-increments when busy), `--open`
 * (open the browser). This service is equivalent to local code execution —
 * never expose it through a reverse proxy (docs/DESIGN.md §3.7).
 */
import { createBridge } from "./server";
import { checkOmpVersion, resolveOmpCommand } from "./process";

const args = process.argv.slice(2);
const open = args.includes("--open");
const portIndex = args.indexOf("--port");
const port = portIndex !== -1 ? Number(args[portIndex + 1]) : undefined;
if (port !== undefined && (!Number.isInteger(port) || port < 0 || port > 65535)) {
	console.error(`Invalid --port value: ${args[portIndex + 1]}`);
	process.exit(1);
}

const ompCommand = resolveOmpCommand();
let ompVersion: string;
try {
	ompVersion = await checkOmpVersion(ompCommand);
} catch (error) {
	console.error((error as Error).message);
	process.exit(1);
}

const bridge = await createBridge({
	...(port !== undefined ? { port } : {}),
	ompCommand,
	ompVersion,
});

console.log(`omp-ui bridge (omp ${ompVersion})`);
console.log(bridge.url);
console.log("Local single-user service with code execution capability — do not expose it.");

if (open) {
	const url = bridge.url;
	const cmd =
		process.platform === "win32"
			? ["cmd", "/c", "start", "", url]
			: process.platform === "darwin"
				? ["open", url]
				: ["xdg-open", url];
	try {
		Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" });
	} catch {
		console.error("Could not open a browser; open the URL above manually.");
	}
}

process.on("SIGINT", () => {
	void bridge.close().finally(() => process.exit(0));
});
process.on("SIGTERM", () => {
	void bridge.close().finally(() => process.exit(0));
});
