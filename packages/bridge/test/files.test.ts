import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { FileAccessError, fuzzyScore, readSessionFile, searchFiles } from "../src/files";
import { tempDir } from "./helpers";

describe("fuzzyScore", () => {
	test("subsequence match scores, non-match is -1", () => {
		expect(fuzzyScore("abc", "a/b/c.ts")).toBeGreaterThan(0);
		expect(fuzzyScore("xyz", "a/b/c.ts")).toBe(-1);
		expect(fuzzyScore("", "anything")).toBe(0);
		expect(fuzzyScore("mfu", "src/my-file-utils.ts")).toBeGreaterThan(0);
	});
});

describe("searchFiles", () => {
	test("walk fallback excludes node_modules and .git, returns FileHits", async () => {
		const cwd = tempDir("files");
		fs.mkdirSync(path.join(cwd, "src", "deep"), { recursive: true });
		fs.mkdirSync(path.join(cwd, "node_modules", "pkg"), { recursive: true });
		fs.mkdirSync(path.join(cwd, ".git"), { recursive: true });
		fs.writeFileSync(path.join(cwd, "src", "deep", "alpha.ts"), "a");
		fs.writeFileSync(path.join(cwd, "src", "beta.ts"), "b");
		fs.writeFileSync(path.join(cwd, "node_modules", "pkg", "gamma.ts"), "g");
		fs.writeFileSync(path.join(cwd, ".git", "delta.ts"), "d");

		const hits = await searchFiles(cwd, "alpha");
		expect(hits).toHaveLength(1);
		expect(hits[0]!.path).toBe("src/deep/alpha.ts");
		expect(hits[0]!.name).toBe("alpha.ts");
		expect(hits[0]!.dir).toBe("src/deep");

		const all = await searchFiles(cwd, "");
		const paths = all.map(h => h.path);
		expect(paths).toContain("src/beta.ts");
		expect(paths.some(p => p.includes("node_modules"))).toBe(false);
		expect(paths.some(p => p.includes(".git"))).toBe(false);
	});

	test("matches against the basename too", async () => {
		const cwd = tempDir("files");
		fs.writeFileSync(path.join(cwd, "tsconfig.json"), "{}");
		const hits = await searchFiles(cwd, "tsconf");
		expect(hits.map(h => h.path)).toContain("tsconfig.json");
	});
});

describe("readSessionFile", () => {
	test("reads a file inside the cwd", async () => {
		const cwd = tempDir("read");
		fs.mkdirSync(path.join(cwd, "sub"), { recursive: true });
		fs.writeFileSync(path.join(cwd, "sub", "note.txt"), "hello");
		const result = await readSessionFile(cwd, "sub/note.txt");
		expect(result.content).toBe("hello");
		expect(result.path).toBe("sub/note.txt");
	});

	test("rejects .. traversal outside the cwd", async () => {
		const cwd = tempDir("read");
		const outside = tempDir("outside");
		fs.writeFileSync(path.join(outside, "secret.txt"), "nope");
		await expect(readSessionFile(cwd, `../${path.basename(outside)}/secret.txt`)).rejects.toMatchObject({
			code: "outside_cwd",
		});
		await expect(readSessionFile(cwd, "../../etc/passwd")).rejects.toBeInstanceOf(FileAccessError);
		await expect(readSessionFile(cwd, path.join(outside, "secret.txt"))).rejects.toMatchObject({
			code: "outside_cwd",
		});
	});

	test("rejects files over 1MB", async () => {
		const cwd = tempDir("read");
		fs.writeFileSync(path.join(cwd, "big.bin"), Buffer.alloc(1024 * 1024 + 1));
		await expect(readSessionFile(cwd, "big.bin")).rejects.toMatchObject({ code: "too_large" });
	});

	test("rejects symlink escapes", async () => {
		const cwd = tempDir("read");
		const outside = tempDir("outside");
		fs.writeFileSync(path.join(outside, "secret.txt"), "nope");
		let linked = true;
		try {
			fs.symlinkSync(path.join(outside, "secret.txt"), path.join(cwd, "link.txt"));
		} catch {
			linked = false; // no symlink privilege on this machine
		}
		if (linked) {
			await expect(readSessionFile(cwd, "link.txt")).rejects.toMatchObject({ code: "outside_cwd" });
		}
	});

	test("rejects missing files", async () => {
		const cwd = tempDir("read");
		await expect(readSessionFile(cwd, "nope.txt")).rejects.toMatchObject({ code: "not_found" });
	});
});
