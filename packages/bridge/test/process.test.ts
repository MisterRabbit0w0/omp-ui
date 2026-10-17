import { afterEach, describe, expect, test } from "bun:test";
import type { RpcServerFrame } from "@omp-ui/protocol";
import { OmpProcess, splitCommandLine, type OmpProcState } from "../src/process";
import { FAKE_OMP_COMMAND, tempDir, waitFor } from "./helpers";

interface Harness {
	proc: OmpProcess;
	frames: { seq: number; frame: RpcServerFrame }[];
	uiResolved: { id: string; auto: boolean }[];
	states: OmpProcState[];
	restoreEnv: () => void;
}

const running: Harness[] = [];

afterEach(async () => {
	const harnesses = running.splice(0);
	await Promise.all(harnesses.map(h => h.proc.stop()));
	for (const h of harnesses) h.restoreEnv();
});

async function startFake(extra?: {
	env?: Record<string, string>;
	ringMaxFrames?: number;
}): Promise<Harness> {
	const frames: Harness["frames"] = [];
	const uiResolved: Harness["uiResolved"] = [];
	const states: Harness["states"] = [];
	const savedEnv: Record<string, string | undefined> = {};
	for (const [key, value] of Object.entries(extra?.env ?? {})) {
		savedEnv[key] = process.env[key];
		process.env[key] = value;
	}
	const proc = new OmpProcess(
		{
			cwd: tempDir("proc"),
			command: FAKE_OMP_COMMAND,
			...(extra?.ringMaxFrames !== undefined ? { ringMaxFrames: extra.ringMaxFrames } : {}),
		},
		{
			onFrame: (seq, frame) => frames.push({ seq, frame }),
			onUiResolved: (id, auto) => uiResolved.push({ id, auto }),
			onStateChange: state => states.push(state),
		},
	);
	const harness: Harness = {
		proc,
		frames,
		uiResolved,
		states,
		restoreEnv: () => {
			for (const [key, value] of Object.entries(savedEnv)) {
				if (value === undefined) delete process.env[key];
				else process.env[key] = value;
			}
		},
	};
	running.push(harness);
	await proc.start();
	return harness;
}

async function runPromptWithApproval(harness: Harness, message = "hello"): Promise<void> {
	void harness.proc.send({ type: "prompt", message });
	await waitFor(() =>
		harness.frames.some(f => f.frame.type === "extension_ui_request" && f.frame.method === "select"),
	);
	const request = harness.frames.find(
		(f): f is { seq: number; frame: Extract<RpcServerFrame, { type: "extension_ui_request" }> } =>
			f.frame.type === "extension_ui_request",
	)!;
	harness.proc.respondUi({ type: "extension_ui_response", id: request.frame.id, value: "Approve" });
	await waitFor(() => harness.frames.some(f => f.frame.type === "session_settled"));
}

describe("splitCommandLine", () => {
	test("splits a command line with quotes", () => {
		expect(splitCommandLine("bun test/fake-omp.ts")).toEqual(["bun", "test/fake-omp.ts"]);
		expect(splitCommandLine('"C:\\Program Files\\omp\\omp.exe" --flag')).toEqual([
			"C:\\Program Files\\omp\\omp.exe",
			"--flag",
		]);
	});
});

describe("OmpProcess", () => {
	test("ready, negotiation, init sequence, get_state", async () => {
		const { proc } = await startFake();
		expect(proc.state).toBe("ready");
		expect(proc.protocolVersion).toBe(2);
		expect(proc.sessionId).toBe("fake-00000000-0000-4000-8000-000000000000");
		expect(proc.sessionFile).toContain("fake-session.jsonl");

		const state = await proc.send({ type: "get_state" });
		expect(state.success).toBe(true);
	});

	test("command id correlation with concurrent commands", async () => {
		const { proc } = await startFake();
		const [a, b] = await Promise.all([
			proc.send({ type: "get_messages_page", limit: 1 }),
			proc.send({ type: "bash", command: "echo hi" }),
		]);
		expect(a.success).toBe(true);
		expect(a.command).toBe("get_messages_page");
		expect(a.id).toMatch(/^b-\d+$/);
		expect(b.success).toBe(true);
		expect(b.command).toBe("bash");
		expect(b.id).not.toBe(a.id);
	});

	test("unanswered command times out with bridge_timeout", async () => {
		const { proc } = await startFake();
		// `hang` is a fake-omp command that never responds; the real (short)
		// timer under test here IS the behavior.
		const hang = await proc.send({ type: "hang" } as never, { timeoutMs: 100 });
		expect(hang.success).toBe(false);
		expect(hang.code).toBe("bridge_timeout");
		expect(hang.error).toContain("timed out");
	});

	test("pendingUi tracks approval requests; first response wins", async () => {
		const harness = await startFake();
		void harness.proc.send({ type: "prompt", message: "hi" });
		await waitFor(() => harness.proc.pendingUi.size === 1);
		const [id] = harness.proc.pendingUi.keys();
		expect(harness.proc.respondUi({ type: "extension_ui_response", id: id!, value: "Approve" })).toBe(true);
		expect(harness.proc.respondUi({ type: "extension_ui_response", id: id!, value: "Deny" })).toBe(false);
		await waitFor(() => harness.frames.some(f => f.frame.type === "session_settled"));
	});

	test("auto-approve answers matching selects and reports ui_resolved", async () => {
		const harness = await startFake();
		harness.proc.autoApprove.add("bash");
		void harness.proc.send({ type: "prompt", message: "hi" });
		await waitFor(() => harness.frames.some(f => f.frame.type === "session_settled"));
		expect(harness.proc.pendingUi.size).toBe(0);
		expect(harness.uiResolved).toHaveLength(1);
		expect(harness.uiResolved[0]!.auto).toBe(true);
		// the request frame still went out so clients can annotate it
		expect(harness.frames.some(f => f.frame.type === "extension_ui_request")).toBe(true);
	});

	test("ring buffer replays frames after sinceSeq", async () => {
		const harness = await startFake();
		await runPromptWithApproval(harness);
		const all = harness.proc.replay(0);
		expect(all.kind).toBe("replay");
		expect(all.frames.length).toBe(harness.frames.length);
		const latest = harness.proc.latestSeq;
		expect(harness.proc.replay(latest)).toEqual({ kind: "replay", frames: [] });
		expect(harness.proc.replay(latest - 1).frames).toHaveLength(1);
	});

	test("ring overflow drops old frames and forces resync", async () => {
		const harness = await startFake({ ringMaxFrames: 3 });
		await runPromptWithApproval(harness);
		expect(harness.frames.length).toBeGreaterThan(3);
		expect(harness.proc.droppedFrames).toBeGreaterThan(0);
		expect(harness.proc.replay(1).kind).toBe("resync");
	});

	test("oversized frames arrive reassembled via rpc_chunk", async () => {
		const harness = await startFake({ env: { FAKE_OMP_MAX_FRAME_BYTES: "1024" } });
		const request = harness.proc.send({ type: "prompt", message: "BIGFRAME" });
		await waitFor(() => harness.proc.pendingUi.size === 1);
		const [id] = harness.proc.pendingUi.keys();
		harness.proc.respondUi({ type: "extension_ui_response", id: id!, value: "Approve" });
		await waitFor(() => harness.frames.some(f => f.frame.type === "session_settled"));
		expect((await request).success).toBe(true);
		const textEnd = harness.frames.find(
			(
				f,
			): f is {
				seq: number;
				frame: Extract<RpcServerFrame, { type: "message_update" }>;
			} => f.frame.type === "message_update" && f.frame.assistantMessageEvent.type === "text_end",
		);
		expect(textEnd).toBeDefined();
		const event = textEnd!.frame.assistantMessageEvent;
		expect(event.type === "text_end" ? event.content.length : 0).toBe(2 * 1024 + 123);
		expect(harness.frames.some(f => f.frame.type === "prompt_result")).toBe(true);
	});

	test("cancelling OAuth code input aborts login instead of re-prompting infinitely", async () => {
		const harness = await startFake();
		const loginPromise = harness.proc.send({ type: "login", providerId: "anthropic" });
		await waitFor(() => harness.proc.pendingUi.size === 1);
		const [uiId] = harness.proc.pendingUi.keys();
		expect(harness.proc.respondUi({ type: "extension_ui_response", id: uiId!, cancelled: true })).toBe(true);
		const response = await loginPromise;
		expect(response.success).toBe(false);
		expect(response.code).toBe("cancelled");
		expect(response.error).toBe("已取消登录");
		expect(harness.proc.pendingUi.size).toBe(0);
		const inputRequests = harness.frames.filter(
			f => f.frame.type === "extension_ui_request" && f.frame.method === "input",
		);
		expect(inputRequests).toHaveLength(1);
	});

	test("automatic OAuth callback completion resolves dangling code input UI request", async () => {
		const harness = await startFake();
		const response = await harness.proc.send({ type: "login", providerId: "oauth-auto-callback" });
		expect(response.success).toBe(true);
		expect(harness.proc.pendingUi.size).toBe(0);
		expect(harness.uiResolved).toHaveLength(1);
		expect(harness.uiResolved[0]!.auto).toBe(false);
	});

	test("stop marks the process exited", async () => {
		const harness = await startFake();
		await harness.proc.stop();
		expect(harness.proc.state).toBe("exited");
		const response = await harness.proc.send({ type: "get_state" });
		expect(response.success).toBe(false);
		expect(response.error).toContain("exited");
	});
});
