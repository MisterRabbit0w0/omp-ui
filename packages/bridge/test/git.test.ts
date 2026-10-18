import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { listGitBranches, readGitChanges, switchGitBranch } from "../src/git";
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

describe("listGitBranches / switchGitBranch", () => {
	function repoWithBranches(): string {
		const cwd = initRepo();
		fs.writeFileSync(path.join(cwd, "a.txt"), "one\n");
		git(cwd, "add", "a.txt");
		git(cwd, "commit", "-m", "initial");
		git(cwd, "branch", "feature");
		return cwd;
	}

	test("reports repo: false outside a work tree", async () => {
		expect(await listGitBranches(tempDir("branches-none"))).toMatchObject({ repo: false, current: null, branches: [] });
	});

	test("lists local branches and the checked-out one", async () => {
		const cwd = repoWithBranches();
		const result = await listGitBranches(cwd);
		expect(result.repo).toBe(true);
		expect(result.current).not.toBeNull();
		expect(result.branches).toContain("feature");
		expect(result.branches).toContain(result.current!);
	});

	test("switches to an existing branch and refuses unknown or option-like names", async () => {
		const cwd = repoWithBranches();
		expect(await switchGitBranch(cwd, "feature")).toEqual({ ok: true });
		expect((await listGitBranches(cwd)).current).toBe("feature");
		expect(await switchGitBranch(cwd, "does-not-exist")).toMatchObject({ ok: false, status: 404 });
		expect(await switchGitBranch(cwd, "--detach")).toMatchObject({ ok: false, status: 404 });
		expect((await listGitBranches(cwd)).current).toBe("feature");
	});

	test("git's refusal on conflicting local changes comes back as 409 and the branch is unchanged", async () => {
		const cwd = repoWithBranches();
		const start = (await listGitBranches(cwd)).current!;
		git(cwd, "switch", "feature");
		fs.writeFileSync(path.join(cwd, "a.txt"), "feature change\n");
		git(cwd, "commit", "-am", "feature change");
		git(cwd, "switch", start);
		fs.writeFileSync(path.join(cwd, "a.txt"), "dirty\n");
		const result = await switchGitBranch(cwd, "feature");
		expect(result).toMatchObject({ ok: false, status: 409 });
		expect((await listGitBranches(cwd)).current).toBe(start);
	});
});
