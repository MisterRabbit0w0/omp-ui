import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import type { B2C } from "@omp-ui/protocol";
import { createBridge, type BridgeHandle } from "../src/server";
import { FAKE_OMP_COMMAND, tempDir, TestWs, waitFor } from "./helpers";

const TOKEN = "test-token";
let bridge: BridgeHandle;
let base: string;
let cwd: string;
let agentDir: string;
let configDir: string;

beforeAll(async () => {
	cwd = tempDir("server-cwd");
	agentDir = tempDir("agent");
	configDir = tempDir("config");
	bridge = await createBridge({
		port: 0,
		token: TOKEN,
		ompCommand: FAKE_OMP_COMMAND,
		ompVersion: "18.11.1",
		agentDir,
		configDir,
	});
	base = `http://127.0.0.1:${bridge.port}`;
});

afterAll(async () => {
	await bridge.close();
});

function api(pathname: string, init?: RequestInit): Promise<Response> {
	return fetch(`${base}${pathname}`, {
		...init,
		headers: { authorization: `Bearer ${TOKEN}`, ...(init?.headers ?? {}) },
	});
}

async function connectAuthed(): Promise<TestWs> {
	const ws = TestWs.connect(`ws://127.0.0.1:${bridge.port}/ws`);
	await ws.ready();
	ws.hello(TOKEN);
	await ws.waitMessage(msg => msg.t === "welcome");
	return ws;
}

async function startSession(ws: TestWs, reqId: string): Promise<string> {
	ws.send({ t: "start", reqId, cwd });
	const started = await ws.waitMessage(msg => msg.t === "started" && msg.reqId === reqId);
	if (started.t !== "started") throw new Error("unexpected");
	return started.sessionId;
}

/** Send a prompt and answer the approval select; resolves when settled. */
async function runPrompt(ws: TestWs, sessionId: string, reqId: string, message: string): Promise<void> {
	ws.send({ t: "rpc", reqId, sessionId, cmd: { type: "prompt", message } });
	const request = await ws.waitMessage(
		msg => msg.t === "frame" && msg.frame.type === "extension_ui_request" && msg.frame.method === "select",
	);
	if (request.t !== "frame" || request.frame.type !== "extension_ui_request") throw new Error("unexpected");
	ws.send({
		t: "ui_response",
		sessionId,
		frame: { type: "extension_ui_response", id: request.frame.id, value: "Approve" },
	});
	await ws.waitMessage(
		msg => msg.t === "frame" && msg.frame.type === "prompt_result",
	);
	await ws.waitMessage(msg => msg.t === "rpc_result" && msg.reqId === reqId);
}

describe("auth and origin", () => {
	test("HTTP without bearer token is 401", async () => {
		const res = await fetch(`${base}/api/sessions`);
		expect(res.status).toBe(401);
	});

	test("HTTP with a foreign Origin is 403", async () => {
		const res = await fetch(`${base}/api/sessions`, {
			headers: { authorization: `Bearer ${TOKEN}`, origin: "http://evil.example.com" },
		});
		expect(res.status).toBe(403);
	});

	test("HTTP with token succeeds", async () => {
		const res = await api("/api/sessions");
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual([]);
	});

	test("WS with a bad token is closed immediately", async () => {
		const ws = TestWs.connect(`ws://127.0.0.1:${bridge.port}/ws`);
		await ws.ready();
		ws.hello("wrong-token");
		const code = await ws.closed;
		expect(code).toBe(4001);
	});

	test("WS with a foreign Origin never upgrades", async () => {
		// The WS handshake goes through fetch upgrade; a forbidden origin gets 403.
		const res = await fetch(`${base}/ws`, {
			headers: {
				origin: "http://evil.example.com",
				connection: "upgrade",
				upgrade: "websocket",
			},
		});
		expect(res.status).toBe(403);
	});

	test("WS hello yields welcome", async () => {
		const ws = await connectAuthed();
		const welcome = ws.messages.find(msg => msg.t === "welcome");
		expect(welcome).toBeDefined();
		if (welcome?.t === "welcome") {
			expect(welcome.ompVersion).toBe("18.11.1");
			expect(welcome.protocolVersion).toBe(2);
		}
		ws.close();
	});
});

describe("ws session flow", () => {
	test("start replies started and attach replays from seq 0", async () => {
		const ws = await connectAuthed();
		const sessionId = await startSession(ws, "r1");
		expect(sessionId).toBe("fake-00000000-0000-4000-8000-000000000000");

		ws.send({ t: "attach", sessionId, sinceSeq: 0 });
		await ws.waitMessage(msg => msg.t === "proc" && msg.sessionId === sessionId && msg.state === "ready");
		ws.close();
	});

	test("rpc forwards with bridge-assigned ids and replies rpc_result", async () => {
		const ws = await connectAuthed();
		const sessionId = await startSession(ws, "r2");
		ws.send({ t: "rpc", reqId: "client-1", sessionId, cmd: { type: "get_state" } });
		const result = await ws.waitMessage(msg => msg.t === "rpc_result" && msg.reqId === "client-1");
		if (result.t !== "rpc_result") throw new Error("unexpected");
		expect(result.response.success).toBe(true);
		expect(result.response.id).toMatch(/^b-\d+$/);
		ws.close();
	});

	test("rpc to an unknown session is an error", async () => {
		const ws = await connectAuthed();
		ws.send({ t: "rpc", reqId: "client-x", sessionId: "nope", cmd: { type: "get_state" } });
		const err = await ws.waitMessage(msg => msg.t === "error" && msg.reqId === "client-x");
		expect(err.t).toBe("error");
		ws.close();
	});

	test("end-to-end prompt: deltas, approval, tool call, settle", async () => {
		const ws = await connectAuthed();
		const sessionId = await startSession(ws, "r3");
		ws.send({ t: "attach", sessionId, sinceSeq: 0 });
		await runPrompt(ws, sessionId, "p1", "say hi");
		const frames = ws.frames().map(f => f.frame);
		expect(frames.some(f => f.type === "agent_start")).toBe(true);
		expect(
			frames.some(f => f.type === "message_update" && f.assistantMessageEvent.type === "text_delta"),
		).toBe(true);
		expect(frames.some(f => f.type === "tool_execution_start" && f.toolName === "bash")).toBe(true);
		expect(frames.some(f => f.type === "tool_execution_end")).toBe(true);
		expect(frames.some(f => f.type === "prompt_result")).toBe(true);
		expect(frames.some(f => f.type === "session_settled")).toBe(true);
		ws.close();
	});

	test("attach replays the ring buffer after reconnect", async () => {
		const ws = await connectAuthed();
		const sessionId = await startSession(ws, "r4");
		ws.send({ t: "attach", sessionId, sinceSeq: 0 });
		await runPrompt(ws, sessionId, "p2", "replay me");
		const seen = ws.frames().length;
		expect(seen).toBeGreaterThan(0);
		ws.close();

		const ws2 = await connectAuthed();
		ws2.send({ t: "attach", sessionId, sinceSeq: 0 });
		await waitFor(() => ws2.frames().length >= seen);
		expect(ws2.frames().map(f => f.seq)).toEqual(ws.frames().map(f => f.seq));
		ws2.close();
	});

	test("attach with a stale sinceSeq gets resync", async () => {
		// A separate bridge with a tiny ring forces eviction after one prompt.
		const small = await createBridge({
			port: 0,
			token: TOKEN,
			ompCommand: FAKE_OMP_COMMAND,
			ompVersion: "18.11.1",
			agentDir: tempDir("agent"),
			configDir: tempDir("config"),
			ringMaxFrames: 3,
		});
		try {
			const ws = TestWs.connect(`ws://127.0.0.1:${small.port}/ws`);
			await ws.ready();
			ws.hello(TOKEN);
			await ws.waitMessage(msg => msg.t === "welcome");
			ws.send({ t: "start", reqId: "s1", cwd });
			const started = await ws.waitMessage(msg => msg.t === "started");
			if (started.t !== "started") throw new Error("unexpected");
			ws.send({ t: "attach", sessionId: started.sessionId, sinceSeq: 0 });
			await runPrompt(ws, started.sessionId, "p3", "fill ring");
			ws.send({ t: "attach", sessionId: started.sessionId, sinceSeq: 1 });
			await ws.waitMessage(msg => msg.t === "resync" && msg.sessionId === started.sessionId);
			ws.close();
		} finally {
			await small.close();
		}
	});

	test("pendingUi is re-sent on attach; first response wins across clients", async () => {
		const wsA = await connectAuthed();
		const sessionId = await startSession(wsA, "r5");
		wsA.send({ t: "attach", sessionId, sinceSeq: 0 });
		wsA.send({ t: "rpc", reqId: "p4", sessionId, cmd: { type: "prompt", message: "need approval" } });
		const requestMsg = await wsA.waitMessage(
			(msg): msg is Extract<B2C, { t: "frame" }> =>
				msg.t === "frame" && msg.frame.type === "extension_ui_request",
		);
		if (requestMsg.frame.type !== "extension_ui_request") throw new Error("unexpected");
		const requestId = requestMsg.frame.id;

		// A second client attaches mid-approval: the pending request is re-sent.
		const wsB = await connectAuthed();
		wsB.send({ t: "attach", sessionId, sinceSeq: Number.MAX_SAFE_INTEGER });
		const resent = await wsB.waitMessage(
			msg => msg.t === "frame" && msg.frame.type === "extension_ui_request" && msg.frame.id === requestId,
		);
		expect(resent.t).toBe("frame");

		// B answers first; A is told it was resolved; A's late answer is dropped.
		wsB.send({
			t: "ui_response",
			sessionId,
			frame: { type: "extension_ui_response", id: requestId, value: "Approve" },
		});
		await wsA.waitMessage(
			msg => msg.t === "ui_resolved" && msg.sessionId === sessionId && msg.id === requestId,
		);
		wsA.send({
			t: "ui_response",
			sessionId,
			frame: { type: "extension_ui_response", id: requestId, value: "Deny" },
		});
		// A's duplicate gets a ui_resolved back (dialog cleanup), no crash, run completes.
		await wsA.waitMessage(msg => msg.t === "frame" && msg.frame.type === "session_settled");
		wsA.close();
		wsB.close();
	});

	test("replay marks already-answered ui requests resolved; still-pending ones stay pending", async () => {
		const wsA = await connectAuthed();
		const sessionId = await startSession(wsA, "r5b");
		wsA.send({ t: "attach", sessionId, sinceSeq: 0 });
		wsA.send({ t: "rpc", reqId: "p4b", sessionId, cmd: { type: "prompt", message: "need approval" } });
		const requestMsg = await wsA.waitMessage(
			(msg): msg is Extract<B2C, { t: "frame" }> =>
				msg.t === "frame" && msg.frame.type === "extension_ui_request",
		);
		if (requestMsg.frame.type !== "extension_ui_request") throw new Error("unexpected");
		const requestId = requestMsg.frame.id;

		// Still pending: a reattaching client must not be told it was resolved.
		const wsPending = await connectAuthed();
		wsPending.send({ t: "attach", sessionId, sinceSeq: 0 });
		await wsPending.waitMessage(msg => msg.t === "proc" && msg.sessionId === sessionId);
		expect(wsPending.messages.some(msg => msg.t === "ui_resolved" && msg.id === requestId)).toBe(false);
		wsPending.close();

		wsA.send({ t: "ui_response", sessionId, frame: { type: "extension_ui_response", id: requestId, value: "Approve" } });
		await wsA.waitMessage(msg => msg.t === "frame" && msg.frame.type === "session_settled");

		// Answered: the replayed request is followed by ui_resolved for the same id.
		const wsB = await connectAuthed();
		wsB.send({ t: "attach", sessionId, sinceSeq: 0 });
		await wsB.waitMessage(msg => msg.t === "proc" && msg.sessionId === sessionId);
		const order = wsB.messages.flatMap(msg =>
			msg.t === "frame" && msg.frame.type === "extension_ui_request" && msg.frame.id === requestId
				? ["request"]
				: msg.t === "ui_resolved" && msg.id === requestId
					? ["resolved"]
					: [],
		);
		expect(order).toEqual(["request", "resolved"]);
		wsA.close();
		wsB.close();
	});

	test("auto_approve answers matching approval selects", async () => {
		const ws = await connectAuthed();
		const sessionId = await startSession(ws, "r6");
		ws.send({ t: "attach", sessionId, sinceSeq: 0 });
		ws.send({ t: "auto_approve", sessionId, toolName: "bash" });
		ws.send({ t: "rpc", reqId: "p5", sessionId, cmd: { type: "prompt", message: "auto please" } });
		const resolved = await ws.waitMessage(
			(msg): msg is Extract<B2C, { t: "ui_resolved" }> => msg.t === "ui_resolved",
		);
		expect(resolved.auto).toBe(true);
		await ws.waitMessage(msg => msg.t === "frame" && msg.frame.type === "session_settled");
		ws.close();
	});

	test("stop ends the process and broadcasts proc exited", async () => {
		const ws = await connectAuthed();
		const sessionId = await startSession(ws, "r7");
		ws.send({ t: "attach", sessionId, sinceSeq: 0 });
		ws.send({ t: "stop", sessionId });
		await ws.waitMessage(
			msg => msg.t === "proc" && msg.sessionId === sessionId && (msg.state === "exited" || msg.state === "crashed"),
		);
		ws.close();
	});

	test("a replaced process's exit is not broadcast over its successor (permission restart)", async () => {
		const ws = await connectAuthed();
		const first = await startSession(ws, "r7b-1");
		ws.send({ t: "attach", sessionId: first, sinceSeq: 0 });
		// FAKE_OMP_SESSION_ID is fixed, so a second start reuses the key and replaces the first process.
		const second = await startSession(ws, "r7b-2");
		expect(second).toBe(first);
		ws.send({ t: "stop", sessionId: second });
		const isExit = (msg: B2C): boolean =>
			msg.t === "proc" && msg.sessionId === first && (msg.state === "exited" || msg.state === "crashed");
		await ws.waitMessage(isExit);
		// Barrier: once the pool entry is gone, this rpc errors. Replies are ordered on the socket, so any
		// exit broadcast by the replaced process has been delivered by the time it arrives.
		ws.send({ t: "rpc", reqId: "barrier", sessionId: first, cmd: { type: "get_state" } });
		await ws.waitMessage(msg => msg.t === "error" && msg.reqId === "barrier");
		expect(ws.messages.filter(isExit)).toHaveLength(1);
		ws.close();
	});

	test("stop followed by start under the same id (the client's permission restart) keeps the successor alive in the UI", async () => {
		const ws = await connectAuthed();
		const first = await startSession(ws, "r7c-1");
		ws.send({ t: "attach", sessionId: first, sinceSeq: 0 });
		ws.send({ t: "stop", sessionId: first });
		const second = await startSession(ws, "r7c-2");
		expect(second).toBe(first);
		// A round trip through the new process: the old process's exit, if it were going to be broadcast late,
		// has been delivered by the time it answers, since both ride the same ordered socket.
		ws.send({ t: "rpc", reqId: "restart-barrier", sessionId: second, cmd: { type: "get_state" } });
		await ws.waitMessage(msg => msg.t === "rpc_result" && msg.reqId === "restart-barrier");
		// An exit before `started` is the stopped process finishing and is expected (the client ignores it while
		// restarting). One after `started` would mark the live successor dead.
		const startedAt = ws.messages.findIndex(msg => msg.t === "started" && msg.reqId === "r7c-2");
		expect(startedAt).toBeGreaterThanOrEqual(0);
		const lateExits = ws.messages
			.slice(startedAt + 1)
			.filter(msg => msg.t === "proc" && msg.sessionId === first && (msg.state === "exited" || msg.state === "crashed"));
		expect(lateExits).toEqual([]);
		ws.close();
	});
});

describe("http api", () => {
	test("GET /api/dir-exists reports existence and directory-ness, requires auth", async () => {
		const dir = await api(`/api/dir-exists?path=${encodeURIComponent(cwd)}`);
		expect(dir.status).toBe(200);
		expect(await dir.json()).toEqual({ exists: true, isDir: true });

		const file = path.join(cwd, "plain.txt");
		fs.writeFileSync(file, "x");
		expect(await (await api(`/api/dir-exists?path=${encodeURIComponent(file)}`)).json()).toEqual({ exists: true, isDir: false });

		const missing = path.join(cwd, "does-not-exist");
		expect(await (await api(`/api/dir-exists?path=${encodeURIComponent(missing)}`)).json()).toEqual({ exists: false, isDir: false });
		expect(await (await api("/api/dir-exists?path=relative/dir")).json()).toEqual({ exists: false, isDir: false });

		expect((await api("/api/dir-exists")).status).toBe(400);
		const anon = await fetch(`${base}/api/dir-exists?path=${encodeURIComponent(cwd)}`);
		expect(anon.status).toBe(401);
	});

	test("config round-trip", async () => {
		const res = await api("/api/config", {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ theme: "dark" }),
		});
		expect(res.status).toBe(200);
		const updated = (await res.json()) as { theme?: string; archived: string[] };
		expect(updated.theme).toBe("dark");
		const get = await api("/api/config");
		expect(((await get.json()) as { theme?: string }).theme).toBe("dark");
	});

	test("export only serves paths returned by export_html", async () => {
		const ws = await connectAuthed();
		const sessionId = await startSession(ws, "r8");
		const forbidden = await api(`/api/export?path=${encodeURIComponent(path.join(cwd, "nope.html"))}`);
		expect(forbidden.status).toBe(403);

		ws.send({ t: "rpc", reqId: "e1", sessionId, cmd: { type: "export_html" } });
		const result = await ws.waitMessage(msg => msg.t === "rpc_result" && msg.reqId === "e1");
		if (result.t !== "rpc_result") throw new Error("unexpected");
		expect(result.response.success).toBe(true);
		const data = result.response.data;
		if (typeof data !== "object" || data === null || !("path" in data) || typeof data.path !== "string") {
			throw new Error("export_html returned no path");
		}
		const allowed = await api(`/api/export?path=${encodeURIComponent(data.path)}`);
		expect(allowed.status).toBe(200);
		expect(await allowed.text()).toContain("fake export");
		fs.rmSync(data.path, { force: true });
		ws.close();
	});

	test("diagnostics for live and unknown sessions", async () => {
		const ws = await connectAuthed();
		const sessionId = await startSession(ws, "r9");
		const res = await api(`/api/diagnostics/${encodeURIComponent(sessionId)}`);
		expect(res.status).toBe(200);
		const diag = (await res.json()) as { sessionId: string; frameCount: number; stderrTail: string };
		expect(diag.sessionId).toBe(sessionId);
		expect(await (await api("/api/diagnostics/nope")).status).toBe(404);
		ws.close();
	});

	test("/api/file reads inside cwd and rejects .. traversal with 403", async () => {
		fs.writeFileSync(path.join(cwd, "ok.txt"), "hello");
		const ok = await api(`/api/file?cwd=${encodeURIComponent(cwd)}&path=ok.txt`);
		expect(ok.status).toBe(200);
		const body: unknown = await ok.json();
		expect(typeof body === "object" && body !== null && "content" in body ? body.content : null).toBe("hello");

		const outside = tempDir("outside-http");
		fs.writeFileSync(path.join(outside, "secret.txt"), "no");
		const bad = await api(
			`/api/file?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(`../${path.basename(outside)}/secret.txt`)}`,
		);
		expect(bad.status).toBe(403);
	});

	test("sessions list, transcript, archive, and trash delete (refusing live)", async () => {
		const dir = path.join(agentDir, "sessions", "-C--proj");
		fs.mkdirSync(dir, { recursive: true });
		const file = path.join(dir, "2026-09-04T02-54-50-911Z_sess-1.jsonl");
		fs.writeFileSync(
			file,
			[
				JSON.stringify({ type: "title", v: 1, title: "Hello", updatedAt: "2026-09-04T02:56:04.938Z" }),
				JSON.stringify({ type: "session", version: 3, id: "sess-1", timestamp: "2026-09-04T02:54:50.911Z", cwd: "C:\\proj" }),
				JSON.stringify({
					type: "message",
					id: "m1",
					parentId: null,
					timestamp: "2026-09-04T02:56:00.556Z",
					message: { role: "user", content: [{ type: "text", text: "hi" }], timestamp: 1 },
				}),
			].join("\n"),
		);

		const list = (await (await api("/api/sessions")).json()) as { id: string }[];
		expect(list.some(s => s.id === "sess-1")).toBe(true);

		const transcript = (await (await api("/api/sessions/sess-1/transcript")).json()) as { role: string }[];
		expect(transcript).toHaveLength(1);
		expect(transcript[0]!.role).toBe("user");

		await api("/api/sessions/sess-1/archive", { method: "POST" });
		const withoutArchived = (await (await api("/api/sessions")).json()) as { id: string }[];
		expect(withoutArchived.some(s => s.id === "sess-1")).toBe(false);
		const onlyArchived = (await (await api("/api/sessions?archived=true")).json()) as { id: string }[];
		expect(onlyArchived.some(s => s.id === "sess-1")).toBe(true);
		await api("/api/sessions/sess-1/unarchive", { method: "POST" });

		const ws = await connectAuthed();
		const liveId = await startSession(ws, "r10");
		const liveDel = await api(`/api/sessions/${encodeURIComponent(liveId)}`, { method: "DELETE" });
		expect(liveDel.status).toBe(409);
		ws.close();

		const del = await api("/api/sessions/sess-1", { method: "DELETE" });
		expect(del.status).toBe(200);
		expect(fs.existsSync(file)).toBe(false);
		expect(fs.readdirSync(path.join(configDir, "trash")).length).toBeGreaterThan(0);
	});
});

describe("GET /api/models", () => {
	test("serves the chat-model catalog from `omp models --json` and drops non-chat kinds", async () => {
		const bridge = await createBridge({ port: 0, token: TOKEN, ompCommand: FAKE_OMP_COMMAND, configDir: tempDir("models-cfg"), agentDir: tempDir("models-agent") });
		try {
			const res = await fetch(`${bridge.origin}/api/models`, { headers: { authorization: `Bearer ${TOKEN}` } });
			expect(res.status).toBe(200);
			const models = (await res.json()) as { selector: string; name: string }[];
			expect(models.map(m => m.selector)).toEqual(["fake/model", "fake/model-mini"]);
			const unauth = await fetch(`${bridge.origin}/api/models`);
			expect(unauth.status).toBe(401);
		} finally {
			await bridge.close();
		}
	});
});
