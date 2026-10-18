/**
 * Read-only git working-tree diffs for the 变更 panel.
 *
 * Spawns git with explicit argv (no shell) inside a session cwd, caps output,
 * and never writes to the repository. `unstaged` includes untracked files
 * (synthesized added-file diffs); `staged` mirrors `git diff --cached`.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import type { GitChangedFile, GitChangeScope, GitChangesResult } from "@omp-ui/protocol";

const GIT_TIMEOUT_MS = 8_000;
const MAX_DIFF_BYTES = 2_000_000;
const MAX_FILES = 200;
const MAX_UNTRACKED_BYTES = 256 * 1024;
const MAX_UNTRACKED_LINES = 1_000;

interface GitRun {
	code: number;
	stdout: string;
	truncated: boolean;
}

async function readCapped(stream: ReadableStream<Uint8Array>, maxBytes: number): Promise<{ text: string; truncated: boolean }> {
	const reader = stream.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	let truncated = false;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			if (total + value.byteLength > maxBytes) {
				chunks.push(value.subarray(0, maxBytes - total));
				total = maxBytes;
				truncated = true;
				await reader.cancel();
				break;
			}
			chunks.push(value);
			total += value.byteLength;
		}
	} finally {
		reader.releaseLock();
	}
	const merged = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		merged.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return { text: new TextDecoder().decode(merged), truncated };
}

async function runGit(cwd: string, args: string[]): Promise<GitRun | null> {
	let proc: Bun.Subprocess<"ignore", "pipe", "ignore">;
	try {
		proc = Bun.spawn(["git", "-C", cwd, ...args], {
			stdout: "pipe",
			stderr: "ignore",
			env: { ...process.env, GIT_PAGER: "cat", GIT_OPTIONAL_LOCKS: "0" },
		});
	} catch {
		return null;
	}
	const outcome = await Promise.race([
		(async () => {
			const [stdout, code] = await Promise.all([readCapped(proc.stdout, MAX_DIFF_BYTES), proc.exited]);
			return { stdout, code };
		})(),
		Bun.sleep(GIT_TIMEOUT_MS).then(() => null),
	]);
	if (outcome === null) {
		proc.kill();
		return null;
	}
	return { code: outcome.code, stdout: outcome.stdout.text, truncated: outcome.stdout.truncated };
}

/** Decode a git C-quoted path ("a/foo\tbar") and drop the a//b/ prefix. */
function normalizePatchPath(raw: string): string | undefined {
	const trimmed = raw.replace(/\t.*$/, "").trim();
	if (!trimmed || trimmed === "/dev/null") return undefined;
	let value: string;
	if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
		let out = "";
		for (let i = 1; i < trimmed.length - 1; i++) {
			const ch = trimmed[i]!;
			if (ch !== "\\") {
				out += ch;
				continue;
			}
			const next = trimmed[++i] ?? "";
			if (next === "n") out += "\n";
			else if (next === "t") out += "\t";
			else if (next === "r") out += "\r";
			else if (next === "b") out += "\b";
			else if (next === "f") out += "\f";
			else if (next === "v") out += "\v";
			else if (/[0-7]/.test(next)) {
				let oct = next;
				while (oct.length < 3 && /[0-7]/.test(trimmed[i + 1] ?? "")) oct += trimmed[++i];
				out += String.fromCharCode(Number.parseInt(oct, 8));
			} else out += next;
		}
		value = out;
	} else {
		value = trimmed;
	}
	return value.replace(/^[ab]\//, "");
}

interface ParsedDiffFile {
	path?: string;
	status: string;
	lines: string[];
	binary: boolean;
}

function parseDiffFiles(diffText: string): ParsedDiffFile[] {
	const files: ParsedDiffFile[] = [];
	let current: ParsedDiffFile | null = null;
	let renameTo: string | undefined;

	const flush = (): void => {
		if (current) {
			if (!current.path && renameTo) current.path = renameTo;
			if (current.path) files.push(current);
		}
		current = null;
		renameTo = undefined;
	};

	for (const line of diffText.split("\n")) {
		if (line.startsWith("diff --git ")) {
			flush();
			current = { status: "M", lines: [line], binary: false };
			continue;
		}
		if (!current) continue;
		current.lines.push(line);
		if (line.startsWith("new file mode")) current.status = "A";
		else if (line.startsWith("deleted file mode")) current.status = "D";
		else if (line.startsWith("rename to ")) {
			renameTo = normalizePatchPath(line.slice("rename to ".length));
			current.status = "R";
		} else if (line.startsWith("copy to ")) {
			renameTo = normalizePatchPath(line.slice("copy to ".length));
			current.status = "C";
		} else if (line.startsWith("+++ ")) {
			const p = normalizePatchPath(line.slice(4));
			if (p) current.path = p;
		} else if (line.startsWith("--- ")) {
			const p = normalizePatchPath(line.slice(4));
			if (p && !current.path) current.path = p;
		} else if (line.startsWith("Binary files ")) {
			current.binary = true;
		}
	}
	flush();
	return files;
}

function countDiffLines(lines: readonly string[]): { additions: number; deletions: number } {
	let additions = 0;
	let deletions = 0;
	for (const line of lines) {
		if (line.startsWith("+") && !line.startsWith("+++")) additions++;
		else if (line.startsWith("-") && !line.startsWith("---")) deletions++;
	}
	return { additions, deletions };
}

async function untrackedFiles(cwd: string, root: string): Promise<{ files: GitChangedFile[]; truncated: boolean }> {
	const listing = await runGit(cwd, ["ls-files", "--others", "--exclude-standard", "-z"]);
	if (!listing || listing.code !== 0) return { files: [], truncated: false };
	const files: GitChangedFile[] = [];
	let truncated = false;
	for (const rel of listing.stdout.split("\0")) {
		if (!rel) continue;
		if (files.length >= MAX_FILES) {
			truncated = true;
			break;
		}
		const absolute = path.join(cwd, rel);
		let stat: fs.Stats;
		try {
			stat = await fs.promises.stat(absolute);
		} catch {
			continue;
		}
		if (!stat.isFile()) continue;
		let content: Buffer;
		try {
			content = await fs.promises.readFile(absolute);
		} catch {
			continue;
		}
		if (content.byteLength > MAX_UNTRACKED_BYTES) {
			content = content.subarray(0, MAX_UNTRACKED_BYTES);
			truncated = true;
		}
		const displayPath = path.relative(root, absolute).split("\\").join("/");
		if (content.subarray(0, Math.min(content.byteLength, 8_000)).includes(0)) {
			files.push({ path: displayPath, status: "?", additions: 0, deletions: 0, diff: "", binary: true });
			continue;
		}
		const lines = content.toString("utf8").replace(/\r\n/g, "\n").split("\n");
		if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
		const preview = lines.slice(0, MAX_UNTRACKED_LINES);
		if (preview.length < lines.length) truncated = true;
		const diff = [
			`@@ -0,0 +1,${lines.length} @@`,
			...preview.map(line => `+${line}`),
			...(preview.length < lines.length ? [`+… (${lines.length - preview.length} more lines)`] : []),
		].join("\n");
		files.push({ path: displayPath, status: "?", additions: lines.length, deletions: 0, diff });
	}
	return { files, truncated };
}

export async function readGitChanges(cwd: string, scope: GitChangeScope): Promise<GitChangesResult> {
	const rootRun = await runGit(cwd, ["rev-parse", "--show-toplevel"]);
	const root = rootRun?.code === 0 ? rootRun.stdout.trim() : "";
	if (!root) return { repo: false, scope, files: [] };

	const diffRun = await runGit(cwd, [
		"diff",
		...(scope === "staged" ? ["--cached"] : []),
		"--no-color",
		"--no-ext-diff",
		"--find-renames",
		"--unified=3",
	]);
	if (!diffRun || diffRun.code !== 0) {
		return { repo: true, root, scope, files: [], ...(diffRun?.truncated ? { truncated: true } : {}) };
	}

	const parsed = parseDiffFiles(diffRun.stdout);
	const files: GitChangedFile[] = parsed.slice(0, MAX_FILES).map(file => {
		const { additions, deletions } = countDiffLines(file.lines);
		return {
			path: file.path!,
			status: file.status,
			additions,
			deletions,
			diff: file.lines.join("\n"),
			...(file.binary ? { binary: true } : {}),
		};
	});
	let truncated = diffRun.truncated || parsed.length > files.length;

	if (scope === "unstaged") {
		const untracked = await untrackedFiles(cwd, root);
		files.push(...untracked.files);
		truncated = truncated || untracked.truncated;
	}

	files.sort((a, b) => a.path.localeCompare(b.path));
	return { repo: true, root, scope, files, ...(truncated ? { truncated: true } : {}) };
}
