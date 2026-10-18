/**
 * Read-only git working-tree diffs for the 变更 panel.
 *
 * Spawns git with explicit argv (no shell) inside a session cwd, caps output,
 * and never writes to the repository. `unstaged` includes untracked files
 * (synthesized added-file diffs); `staged` mirrors `git diff --cached`.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import type { GitBranchesResult, GitChangedFile, GitChangeScope, GitChangesResult } from "@omp-ui/protocol";

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
			const stdout = await readCapped(proc.stdout, MAX_DIFF_BYTES);
			// Hitting the cap closes the pipe while git may still be writing; stop it so `exited` settles
			// promptly, and keep the captured prefix (git's SIGPIPE/kill exit code says nothing about it).
			if (stdout.truncated) proc.kill();
			const code = await proc.exited;
			return { stdout, code: stdout.truncated ? 0 : code };
		})(),
		Bun.sleep(GIT_TIMEOUT_MS).then(() => null),
	]);
	if (outcome === null) {
		proc.kill();
		return null;
	}
	return { code: outcome.code, stdout: outcome.stdout.text, truncated: outcome.stdout.truncated };
}

const SIMPLE_ESCAPES: Record<string, number> = { n: 10, t: 9, r: 13, b: 8, f: 12, v: 11, a: 7 };

/**
 * Decode a git C-quoted string body (without the surrounding quotes). Octal escapes are raw bytes of a
 * UTF-8 path, so bytes are accumulated and decoded together (`\344\270\255` → 中).
 */
function unquoteGitPath(body: string): string {
	const encoder = new TextEncoder();
	const bytes: number[] = [];
	for (let i = 0; i < body.length; i++) {
		const ch = body[i]!;
		if (ch !== "\\") {
			for (const b of encoder.encode(ch)) bytes.push(b);
			continue;
		}
		const next = body[++i] ?? "";
		if (/[0-7]/.test(next)) {
			let oct = next;
			while (oct.length < 3 && /[0-7]/.test(body[i + 1] ?? "")) oct += body[++i];
			bytes.push(Number.parseInt(oct, 8) & 0xff);
		} else if (next in SIMPLE_ESCAPES) {
			bytes.push(SIMPLE_ESCAPES[next]!);
		} else {
			for (const b of encoder.encode(next)) bytes.push(b);
		}
	}
	return new TextDecoder().decode(new Uint8Array(bytes));
}

/** Decode a possibly C-quoted patch path ("a/foo\tbar") and drop the a/ / b/ prefix. */
function normalizePatchPath(raw: string): string | undefined {
	const trimmed = raw.startsWith('"') ? raw.trim() : raw.replace(/\t.*$/, "").trim();
	if (!trimmed || trimmed === "/dev/null") return undefined;
	const value =
		trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2
			? unquoteGitPath(trimmed.slice(1, -1))
			: trimmed;
	return value.replace(/^[ab]\//, "");
}

/** Split one leading (possibly quoted) token off `text`: returns [token, rest]. */
function takeToken(text: string): [string, string] | null {
	if (text.startsWith('"')) {
		for (let i = 1; i < text.length; i++) {
			if (text[i] === "\\") {
				i++;
				continue;
			}
			if (text[i] === '"') return [text.slice(0, i + 1), text.slice(i + 1).replace(/^ /, "")];
		}
		return null;
	}
	return null;
}

/**
 * Path from a `diff --git a/X b/Y` header (b side). Header-only patches (binary, mode-only) have no
 * `---`/`+++` lines, so this is their only source. Unquoted paths may contain spaces; when both sides are
 * the same path the header is split in the middle, otherwise at the last " b/".
 */
export function pathFromDiffHeader(line: string): string | undefined {
	const rest = line.slice("diff --git ".length);
	const first = takeToken(rest);
	if (first) {
		const second = takeToken(first[1]);
		return normalizePatchPath(second ? second[0] : first[1]);
	}
	if (rest.startsWith("a/") && rest.length % 2 === 1) {
		const half = (rest.length - 1) / 2;
		const a = rest.slice(2, half);
		if (rest.slice(half) === ` b/${a}`) return a || undefined;
	}
	const cut = rest.lastIndexOf(" b/");
	if (cut >= 0) return normalizePatchPath(rest.slice(cut + 1));
	if (rest.lastIndexOf(' "b/') >= 0) return normalizePatchPath(rest.slice(rest.lastIndexOf(' "b/') + 1));
	return undefined;
}

interface ParsedDiffFile {
	path?: string;
	status: string;
	lines: string[];
	binary: boolean;
	additions: number;
	deletions: number;
}

/**
 * Split `git diff` output per file. Hunk bodies are consumed by the line counts in their `@@` header, so
 * content lines that look like headers (a removed `-- comment` is `--- comment`, an added `++x` is `+++x`)
 * are never mistaken for `---`/`+++` file headers and are always counted.
 */
export function parseDiffFiles(diffText: string): ParsedDiffFile[] {
	const files: ParsedDiffFile[] = [];
	let current: ParsedDiffFile | null = null;
	let headerPath: string | undefined;
	let renameTo: string | undefined;
	let oldLeft = 0;
	let newLeft = 0;

	const flush = (): void => {
		if (current) {
			if (!current.path) current.path = renameTo ?? headerPath;
			if (current.path) files.push(current);
		}
		current = null;
		headerPath = undefined;
		renameTo = undefined;
		oldLeft = 0;
		newLeft = 0;
	};

	const lines = diffText.split("\n");
	if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
	for (const line of lines) {
		if (current && (oldLeft > 0 || newLeft > 0)) {
			current.lines.push(line);
			if (line.startsWith("+")) {
				current.additions++;
				newLeft--;
			} else if (line.startsWith("-")) {
				current.deletions++;
				oldLeft--;
			} else if (line.startsWith("\\")) {
				// "\ No newline at end of file": consumes neither side
			} else {
				oldLeft--;
				newLeft--;
			}
			continue;
		}
		if (line.startsWith("diff --git ")) {
			flush();
			current = { status: "M", lines: [line], binary: false, additions: 0, deletions: 0 };
			headerPath = pathFromDiffHeader(line);
			continue;
		}
		if (!current) continue;
		current.lines.push(line);
		const hunk = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/.exec(line);
		if (hunk) {
			oldLeft = hunk[1] === undefined ? 1 : Number(hunk[1]);
			newLeft = hunk[2] === undefined ? 1 : Number(hunk[2]);
		} else if (line.startsWith("new file mode")) current.status = "A";
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

/**
 * Untracked files of the whole work tree (listed from `root`, so a session opened in a subdirectory still
 * sees sibling/root files, matching `git diff`). `maxFiles` is the capacity left after tracked changes and
 * `maxBytes` bounds the total content read, so the combined response stays within the advertised caps.
 */
async function untrackedFiles(
	root: string,
	maxFiles: number,
	maxBytes: number,
): Promise<{ files: GitChangedFile[]; truncated: boolean }> {
	const listing = await runGit(root, ["ls-files", "--others", "--exclude-standard", "-z"]);
	if (!listing || listing.code !== 0) return { files: [], truncated: false };
	const files: GitChangedFile[] = [];
	let truncated = listing.truncated;
	let bytesLeft = maxBytes;
	for (const rel of listing.stdout.split("\0")) {
		if (!rel) continue;
		if (files.length >= maxFiles || bytesLeft <= 0) {
			truncated = true;
			break;
		}
		const absolute = path.join(root, rel);
		let stat: fs.Stats;
		try {
			// lstat: never follow a symlink out of the working tree while reading untracked content.
			stat = await fs.promises.lstat(absolute);
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
		const cap = Math.min(MAX_UNTRACKED_BYTES, bytesLeft);
		if (content.byteLength > cap) {
			content = content.subarray(0, cap);
			truncated = true;
		}
		bytesLeft -= content.byteLength;
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

	const diffRun = await runGit(root, [
		"diff",
		...(scope === "staged" ? ["--cached"] : []),
		"--no-color",
		"--no-ext-diff",
		"--no-textconv",
		"--find-renames",
		"--unified=3",
	]);
	if (!diffRun || diffRun.code !== 0) return { repo: true, root, scope, files: [] };

	const parsed = parseDiffFiles(diffRun.stdout);
	const files: GitChangedFile[] = parsed.slice(0, MAX_FILES).map(file => {
		return {
			path: file.path!,
			status: file.status,
			additions: file.additions,
			deletions: file.deletions,
			diff: file.lines.join("\n"),
			...(file.binary ? { binary: true } : {}),
		};
	});
	let truncated = diffRun.truncated || parsed.length > files.length;

	if (scope === "unstaged") {
		const usedBytes = files.reduce((sum, file) => sum + file.diff.length, 0);
		const untracked = await untrackedFiles(root, MAX_FILES - files.length, MAX_DIFF_BYTES - usedBytes);
		files.push(...untracked.files);
		truncated = truncated || untracked.truncated;
	}

	files.sort((a, b) => a.path.localeCompare(b.path));
	return { repo: true, root, scope, files, ...(truncated ? { truncated: true } : {}) };
}

/** Local branches plus the checked-out one. `repo:false` when `cwd` is not inside a work tree. */
export async function listGitBranches(cwd: string): Promise<GitBranchesResult> {
	const rootRun = await runGit(cwd, ["rev-parse", "--show-toplevel"]);
	const root = rootRun?.code === 0 ? rootRun.stdout.trim() : "";
	if (!root) return { repo: false, current: null, branches: [] };

	const [currentRun, listRun] = await Promise.all([
		runGit(cwd, ["branch", "--show-current"]),
		runGit(cwd, ["for-each-ref", "--sort=-committerdate", "--format=%(refname:short)", "refs/heads"]),
	]);
	const current = currentRun?.code === 0 && currentRun.stdout.trim() ? currentRun.stdout.trim() : null;
	const branches = listRun?.code === 0 ? listRun.stdout.split("\n").map(line => line.trim()).filter(line => line.length > 0) : [];
	let detachedAt: string | undefined;
	if (current === null) {
		const head = await runGit(cwd, ["rev-parse", "--short", "HEAD"]);
		if (head?.code === 0 && head.stdout.trim()) detachedAt = head.stdout.trim();
	}
	return { repo: true, root, current, ...(detachedAt !== undefined ? { detachedAt } : {}), branches };
}

export type SwitchBranchResult = { ok: true } | { ok: false; status: 400 | 404 | 409 | 502; error: string };

/**
 * `git switch <branch>` for an existing local branch. The name must match a listed branch exactly (never
 * created, never passed through as an option), and git's own refusal (dirty tree conflicts) is surfaced as-is.
 */
export async function switchGitBranch(cwd: string, branch: string): Promise<SwitchBranchResult> {
	const before = await listGitBranches(cwd);
	if (!before.repo) return { ok: false, status: 404, error: "not a git repository" };
	if (!before.branches.includes(branch)) return { ok: false, status: 404, error: `unknown local branch: ${branch}` };
	if (before.current === branch) return { ok: true };

	let proc: Bun.Subprocess<"ignore", "pipe", "pipe">;
	try {
		proc = Bun.spawn(["git", "-C", cwd, "switch", "--no-guess", branch], {
			stdout: "pipe",
			stderr: "pipe",
			env: { ...process.env, GIT_PAGER: "cat" },
		});
	} catch (error) {
		return { ok: false, status: 502, error: (error as Error).message };
	}
	const outcome = await Promise.race([
		Promise.all([new Response(proc.stderr).text(), proc.exited]).then(([stderr, code]) => ({ stderr, code })),
		Bun.sleep(GIT_TIMEOUT_MS).then(() => null),
	]);
	if (outcome === null) {
		proc.kill();
		return { ok: false, status: 502, error: "git switch timed out" };
	}
	if (outcome.code !== 0) {
		// Dirty-tree conflicts are the expected refusal; report them as a conflict, not a server fault.
		return { ok: false, status: 409, error: outcome.stderr.trim() || `git switch exited with code ${outcome.code}` };
	}
	return { ok: true };
}
