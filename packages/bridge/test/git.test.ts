import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { readGitChanges } from "../src/git";
import { tempDir } from "./helpers";

function git(cwd: string, ...args: string[]): void {
	const result = Bun.spawnSync(["git", "-C", cwd, ...args], { stdout: "ignore", stderr: "ignore" });
	if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed`);
}

function initRepo(): string {
	const cwd = tempDir("git-changes");
	git(cwd, "init");
	git(cwd, "config", "core.autocrlf", "false");
	git(cwd, "config", "user.email", "omp-ui@example.test");
	git(cwd, "config", "user.name", "omp-ui test");
	git(cwd, "config", "commit.gpgsign", "false");
	return cwd;
}

describe("readGitChanges", () => {
	test("reports repo: false outside a git work tree", async () => {
		const cwd = tempDir("not-repo");
		expect(await readGitChanges(cwd, "unstaged")).toMatchObject({ repo: false, files: [] });
	});

	test("unstaged includes modified and untracked files, staged only cached diffs", async () => {
		const cwd = initRepo();
		fs.writeFileSync(path.join(cwd, "tracked.txt"), "one\n");
		git(cwd, "add", "tracked.txt");
		git(cwd, "commit", "-m", "initial");
		fs.writeFileSync(path.join(cwd, "tracked.txt"), "one\ntwo\n");
		fs.writeFileSync(path.join(cwd, "fresh.txt"), "hello\nworld\n");

		const unstaged = await readGitChanges(cwd, "unstaged");
		expect(unstaged.repo).toBe(true);
		const tracked = unstaged.files.find(f => f.path === "tracked.txt");
		expect(tracked?.status).toBe("M");
		expect(tracked?.additions).toBe(1);
		expect(tracked?.diff).toContain("+two");
		const fresh = unstaged.files.find(f => f.path === "fresh.txt");
		expect(fresh?.status).toBe("?");
		expect(fresh?.additions).toBe(2);
		expect(fresh?.diff).toContain("+hello");

		git(cwd, "add", "tracked.txt");
		const staged = await readGitChanges(cwd, "staged");
		expect(staged.files.map(f => f.path)).toEqual(["tracked.txt"]);
		expect(staged.files[0]?.additions).toBe(1);
		expect(staged.files[0]?.diff).toContain("+two");
	});

	test("marks binary files and deleted files", async () => {
		const cwd = initRepo();
		const file = path.join(cwd, "gone.txt");
		fs.writeFileSync(file, "bye\n");
		git(cwd, "add", "gone.txt");
		fs.rmSync(file);
		fs.writeFileSync(path.join(cwd, "blob.bin"), Buffer.from([0, 1, 2, 3]));

		const result = await readGitChanges(cwd, "unstaged");
		const gone = result.files.find(f => f.path === "gone.txt");
		expect(gone?.status).toBe("D");
		expect(gone?.diff).toContain("-bye");
		const blob = result.files.find(f => f.path === "blob.bin");
		expect(blob?.binary).toBe(true);
	});

	test("does not read untracked symlink targets", async () => {
		const cwd = initRepo();
		const outside = tempDir("git-secret");
		const secret = path.join(outside, "secret.txt");
		fs.writeFileSync(secret, "top secret\n");
		try {
			fs.symlinkSync(secret, path.join(cwd, "link.txt"));
		} catch {
			return; // symlink privilege not available on this machine
		}
		const result = await readGitChanges(cwd, "unstaged");
		expect(result.files.some(f => f.path === "link.txt")).toBe(false);
		expect(JSON.stringify(result)).not.toContain("top secret");
	});
});
