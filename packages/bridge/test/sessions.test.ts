import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { parseSessionHead, parseTranscript, SessionScanner } from "../src/sessions";
import { tempDir } from "./helpers";

const TITLE_PAD = " ".repeat(120);

function sessionFile(id: string, title: string, cwd: string, extra = ""): string {
	return [
		JSON.stringify({ type: "title", v: 1, title, source: "auto", updatedAt: "2026-09-04T02:56:04.938Z", pad: TITLE_PAD }),
		JSON.stringify({ type: "session", version: 3, id, timestamp: "2026-09-04T02:54:50.911Z", cwd, title }),
		extra,
	]
		.filter(line => line.length > 0)
		.join("\n");
}

function messageEntry(id: string, parentId: string | null, text: string): string {
	return JSON.stringify({
		type: "message",
		id,
		parentId,
		timestamp: "2026-09-04T02:56:00.556Z",
		message: { role: "user", content: [{ type: "text", text }], timestamp: 1788490560505 },
	});
}

describe("parseSessionHead", () => {
	test("parses the padded title slot and session header", () => {
		const head = sessionFile("id-1", "My session", "C:\\proj");
		const header = parseSessionHead(head);
		expect(header).toBeDefined();
		expect(header!.id).toBe("id-1");
		expect(header!.title).toBe("My session");
		expect(header!.cwd).toBe("C:\\proj");
		expect(header!.createdAt).toBe("2026-09-04T02:54:50.911Z");
		expect(header!.titleUpdatedAt).toBe("2026-09-04T02:56:04.938Z");
	});

	test("returns undefined without a session header", () => {
		expect(parseSessionHead(JSON.stringify({ type: "title", title: "x" }))).toBeUndefined();
	});
});

describe("parseTranscript", () => {
	test("follows the leaf back to the root, current branch only", () => {
		const content = [
			// main branch: a1 -> a2 -> a3
			messageEntry("a1", null, "first"),
			messageEntry("a2", "a1", "second"),
			messageEntry("a3", "a2", "third (old tip)"),
			// branched off a1 later; b2 is the last entry = the active leaf
			messageEntry("b1", "a1", "branch start"),
			JSON.stringify({ type: "custom", id: "cx", parentId: "b1", customType: "tool_execution_start" }),
			messageEntry("b2", "cx", "branch tip"),
		].join("\n");
		const messages = parseTranscript(content);
		const texts = messages.map(m => (m.role === "user" && Array.isArray(m.content) ? m.content[0] : null));
		expect(messages.map(m => m.role)).toEqual(["user", "user", "user"]);
		expect(texts.map(c => (c && c.type === "text" ? c.text : null))).toEqual([
			"first",
			"branch start",
			"branch tip",
		]);
	});

	test("tolerates malformed lines", () => {
		const content = `${messageEntry("a1", null, "ok")}\n{"type":"message","id":"broken"\n`;
		expect(parseTranscript(content)).toHaveLength(1);
	});
});

describe("SessionScanner", () => {
	test("scans sessions/**, caches by mtime, marks live and archived", async () => {
		const agentDir = tempDir("agent");
		const sessionsDir = path.join(agentDir, "sessions", "-C--proj");
		fs.mkdirSync(sessionsDir, { recursive: true });
		fs.writeFileSync(
			path.join(sessionsDir, "2026-09-04T02-54-50-911Z_id-1.jsonl"),
			sessionFile("id-1", "First", "C:\\proj"),
		);
		fs.writeFileSync(
			path.join(sessionsDir, "2026-09-05T02-54-50-911Z_id-2.jsonl"),
			sessionFile("id-2", "Second", "C:\\proj"),
		);
		const scanner = new SessionScanner({
			agentDir,
			isLive: id => id === "id-2",
			isArchived: id => id === "id-1",
		});
		const items = await scanner.scan();
		expect(items).toHaveLength(2);
		expect(items.map(i => i.id).sort()).toEqual(["id-1", "id-2"]);
		const first = items.find(i => i.id === "id-1")!;
		expect(first.title).toBe("First");
		expect(first.archived).toBe(true);
		expect(first.live).toBe(false);
		expect(items.find(i => i.id === "id-2")!.live).toBe(true);
		expect(first.sizeBytes).toBeGreaterThan(0);

		// cached second scan returns identical data
		const again = await scanner.scan();
		expect(again.map(i => i.id).sort()).toEqual(["id-1", "id-2"]);

		const projects = await scanner.projects();
		expect(projects).toHaveLength(1);
		expect(projects[0]!.cwd).toBe("C:\\proj");
		expect(projects[0]!.sessionCount).toBe(2);
		scanner.close();
	});

	test("transcript returns the current branch for a session id", async () => {
		const agentDir = tempDir("agent");
		const sessionsDir = path.join(agentDir, "sessions", "-C--proj");
		fs.mkdirSync(sessionsDir, { recursive: true });
		fs.writeFileSync(
			path.join(sessionsDir, "2026-09-04T02-54-50-911Z_id-9.jsonl"),
			sessionFile("id-9", "T", "C:\\proj", `${messageEntry("a1", null, "hello")}\n${messageEntry("a2", "a1", "world")}`),
		);
		const scanner = new SessionScanner({ agentDir });
		const messages = await scanner.transcript("id-9");
		expect(messages).toHaveLength(2);
		expect(await scanner.transcript("unknown")).toBeUndefined();
		scanner.close();
	});
});
