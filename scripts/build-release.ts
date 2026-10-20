/**
 * Assemble the publishable npm package in `release/`.
 *
 *   release/
 *     package.json   # generated, public, `bin: omp-ui`
 *     README.md
 *     LICENSE        # copied when present
 *     dist/cli.js    # bridge + protocol bundled into one Bun script
 *     dist/web/      # built React SPA
 *
 * Usage: `bun run release:build`, then `cd release && npm publish`.
 */
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dir, "..");
const out = path.join(root, "release");
const rootPkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

const run = (cmd: string[]) => {
	const proc = Bun.spawnSync(cmd, { cwd: root, stdout: "inherit", stderr: "inherit" });
	if (proc.exitCode !== 0) throw new Error(`Command failed: ${cmd.join(" ")}`);
};

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, "dist"), { recursive: true });

// 1. Frontend
run(["bun", "run", "build"]);
fs.cpSync(path.join(root, "packages/web/dist"), path.join(out, "dist/web"), { recursive: true });

// 2. Bridge -> single file (inlines @omp-ui/protocol, so no workspace deps remain)
const result = await Bun.build({
	entrypoints: [path.join(root, "packages/bridge/src/main.ts")],
	target: "bun",
	minify: false,
	sourcemap: "none",
});
if (!result.success) {
	for (const log of result.logs) console.error(log);
	throw new Error("Bundling the bridge failed");
}
const code = await result.outputs[0]!.text();
const cliPath = path.join(out, "dist/cli.js");
fs.writeFileSync(cliPath, code.startsWith("#!") ? code : `#!/usr/bin/env bun\n${code}`);
fs.chmodSync(cliPath, 0o755);

// 3. Docs
fs.copyFileSync(path.join(root, "README.md"), path.join(out, "README.md"));
for (const name of ["LICENSE", "LICENSE.md"]) {
	if (fs.existsSync(path.join(root, name))) fs.copyFileSync(path.join(root, name), path.join(out, name));
}

// 4. Public package.json
const pkg = {
	name: "omp-ui",
	version: rootPkg.version,
	description: "Desktop-style local GUI for the oh-my-pi (omp) coding agent",
	type: "module",
	bin: { "omp-ui": "dist/cli.js" },
	files: ["dist"],
	engines: { bun: ">=1.1.0" },
	keywords: ["omp", "oh-my-pi", "coding-agent", "gui"],
	repository: { type: "git", url: "git+https://github.com/MisterRabbit0w0/omp-ui.git" },
	homepage: "https://github.com/MisterRabbit0w0/omp-ui#readme",
	bugs: "https://github.com/MisterRabbit0w0/omp-ui/issues",
	...(rootPkg.license ? { license: rootPkg.license } : {}),
};
fs.writeFileSync(path.join(out, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);

console.log(`\nomp-ui@${pkg.version} assembled in release/`);
