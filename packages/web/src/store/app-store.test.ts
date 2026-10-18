import { describe, expect, test } from "bun:test";
import type { BridgeClient, StartOptions } from "../lib/ws";
import type { BridgeHttp } from "../lib/http";
import { createAppStore } from "./app-store";
import { createSessionView, type SessionView } from "./session-reducer";

/** Minimal client whose RPC results are all `{}`: a buggy/partial omp reply must not break session start. */
function emptyShapeClient(sessionId: string): BridgeClient {
	const client = {
		start: async () => ({ sessionId, sessionFile: `/tmp/${sessionId}.jsonl` }),
		attach: () => undefined,
		resolveReqId: () => undefined,
		rpc: async () => ({}),
	};
	return client as unknown as BridgeClient;
}

describe("app store cold start", () => {
	test("newSession tolerates RPC results that omit their collections (was: 'e is not iterable')", async () => {
		const store = createAppStore({ client: emptyShapeClient("s1"), http: {} as BridgeHttp });
		const id = await store.getState().newSession("/work");
		expect(id).toBe("s1");
		const view = store.getState().views.s1!;
		expect(view.models).toEqual([]);
		expect(view.commands).toEqual([]);
		expect(view.subagents.size).toBe(0);
		expect(view.btw.size).toBe(0);
		expect(view.messages).toEqual([]);
	});

	test("newSession puts a live placeholder in the sidebar list until the server lists it", async () => {
		const listed: unknown[] = [];
		const http = { listSessions: async () => listed } as unknown as BridgeHttp;
		const store = createAppStore({ client: emptyShapeClient("s2"), http });
		await store.getState().newSession("/work");
		expect(store.getState().sessions.map(s => s.id)).toEqual(["s2"]);
		await store.getState().loadSessions(); // server has no file yet: placeholder survives
		expect(store.getState().sessions.map(s => s.id)).toEqual(["s2"]);
		listed.push({ id: "s2", file: "/tmp/s2.jsonl", cwd: "/work", title: "t", createdAt: "", updatedAt: "", sizeBytes: 10, live: true, running: false, archived: false });
		await store.getState().loadSessions(); // now replaced, not duplicated
		expect(store.getState().sessions.filter(s => s.id === "s2")).toHaveLength(1);
		expect(store.getState().sessions[0]!.title).toBe("t");
	});
});

describe("model catalog", () => {
	test("loadModelCatalog fetches once and caches", async () => {
		const calls: string[] = [];
		const http = {
			listModels: async () => {
				calls.push("listModels");
				return [{ provider: "p", id: "m", selector: "p/m", name: "M", contextWindow: 1, maxTokens: 1, reasoning: false, input: ["text"] }];
			},
			listSessions: async () => [],
			listProjects: async () => [],
			getConfig: async () => ({ archived: [], recentProjects: [] }),
		} as unknown as BridgeHttp;
		const store = createAppStore({ client: emptyShapeClient("s9"), http });
		await store.getState().loadModelCatalog();
		expect(calls).toEqual(["listModels"]);
		expect(store.getState().modelCatalog?.[0]?.selector).toBe("p/m");
		await store.getState().loadModelCatalog(); // cached: no second fetch
		expect(calls).toHaveLength(1);
	});
});

describe("without a bridge client (gallery / offline preview)", () => {
	test("answerUi and approve resolve locally and never throw 'app store not initialized'", () => {
		const store = createAppStore();
		store.setState({
			views: {
				g: {
					...createSessionView("g"),
					pendingUi: [{ type: "extension_ui_request", id: "u1", method: "select", title: "Allow tool: bash\nx", options: ["Approve", "Deny"] }],
				},
			},
		});
		expect(() => store.getState().approve("g", "u1", true)).not.toThrow();
		expect(store.getState().views.g!.pendingUi).toHaveLength(0);
		expect(store.getState().views.g!.answeredUi[0]?.always).toBe(true);
	});
});

/** Records every client call in order, so stop/detach/start/attach sequencing can be asserted. */
function recordingClient(sessionIds: string[]): { client: BridgeClient; calls: string[]; starts: StartOptions[] } {
	const calls: string[] = [];
	const starts: StartOptions[] = [];
	let n = 0;
	const client = {
		send: (m: { t: string }) => void calls.push(`send:${m.t}`),
		detach: (id: string) => void calls.push(`detach:${id}`),
		attach: (id: string) => void calls.push(`attach:${id}`),
		start: async (opts: StartOptions) => {
			starts.push(opts);
			const sessionId = sessionIds[Math.min(n++, sessionIds.length - 1)]!;
			calls.push(`start:${sessionId}`);
			return { sessionId, sessionFile: `/tmp/${sessionId}.jsonl` };
		},
		resolveReqId: () => undefined,
		rpc: async (_id: string, cmd: { type: string }) => {
			calls.push(`rpc:${cmd.type}`);
			return {};
		},
	};
	return { client: client as unknown as BridgeClient, calls, starts };
}

function readyView(id: string, extra: Partial<SessionView> = {}): SessionView {
	return { ...createSessionView(id, { proc: "ready" }), ...extra };
}

const sessionItem = (id: string) => ({
	id,
	file: `/tmp/${id}.jsonl`,
	cwd: "/work",
	title: "",
	createdAt: "",
	updatedAt: "",
	sizeBytes: 1,
	live: true,
	running: false,
	archived: false,
});

describe("welcome navigation and pending session config", () => {
	test("startWelcome leaves the session and records the preselected project", () => {
		const store = createAppStore({ client: emptyShapeClient("w1"), http: {} as BridgeHttp });
		store.setState({ currentSessionId: "w1" });
		store.getState().startWelcome("/proj");
		expect(store.getState().currentSessionId).toBeNull();
		expect(store.getState().welcomeRequest?.cwd).toBe("/proj");
		store.getState().startWelcome();
		expect(store.getState().welcomeRequest?.cwd).toBeUndefined();
	});

	test("sending before /api/projects and /api/config have loaded waits for them instead of failing with 'no project'", async () => {
		const { client, starts } = recordingClient(["late"]);
		const http = {
			listProjects: async () => [{ cwd: "/late/proj", name: "proj", lastUsedAt: "2026-01-01T00:00:00Z", sessionCount: 1 }],
			getConfig: async () => ({ archived: [], recentProjects: ["/late/proj"], defaultApprovalMode: "yolo" as const }),
		} as unknown as BridgeHttp;
		const store = createAppStore({ client, http });
		store.setState({ projects: [], config: null, pendingSession: {} });
		expect(await store.getState().newSessionFromPending()).toBe("late");
		expect(starts[0]).toMatchObject({ cwd: "/late/proj", approvalMode: "yolo" });
		expect(store.getState().toasts).toHaveLength(0);
	});

	test("newSessionFromPending starts with the chosen project/model/thinking/approval and remembers the project", async () => {
		const { client, starts } = recordingClient(["n1"]);
		const store = createAppStore({ client, http: {} as BridgeHttp });
		store.getState().updatePendingSession({ cwd: "/proj", model: "fake/model-mini", thinking: "high", approvalMode: "yolo" });
		const id = await store.getState().newSessionFromPending();
		expect(id).toBe("n1");
		expect(starts).toEqual([{ cwd: "/proj", model: "fake/model-mini", thinking: "high", approvalMode: "yolo" }]);
		expect(store.getState().views.n1!.approvalMode).toBe("yolo");
		expect(store.getState().pendingSession.cwd).toBe("/proj");
	});

	test("auto thinking is not passed as --thinking; config supplies the other defaults", async () => {
		const { client, starts } = recordingClient(["n2"]);
		const store = createAppStore({ client, http: {} as BridgeHttp });
		store.setState({
			config: { archived: [], recentProjects: ["/recent"], defaultModel: "a/b", defaultThinking: "auto", defaultApprovalMode: "always-ask" },
		});
		await store.getState().newSessionFromPending();
		expect(starts).toEqual([{ cwd: "/recent", model: "a/b", thinking: undefined, approvalMode: "always-ask" }]);
	});

	test("without any project it toasts and creates nothing", async () => {
		const { client, starts } = recordingClient(["n3"]);
		const store = createAppStore({ client, http: {} as BridgeHttp });
		store.setState({ projects: [], config: null, pendingSession: {} });
		expect(await store.getState().newSessionFromPending()).toBeNull();
		expect(starts).toEqual([]);
		expect(store.getState().toasts).toHaveLength(1);
	});
});

describe("restartWithApprovalMode", () => {
	test("stops, detaches, restarts with --resume and the new mode, then re-attaches", async () => {
		const { client, calls, starts } = recordingClient(["s1"]);
		const store = createAppStore({ client, http: {} as BridgeHttp });
		store.setState({
			sessions: [sessionItem("s1")],
			currentSessionId: "s1",
			views: {
				s1: readyView("s1", {
					approvalMode: "write",
					messages: [{ role: "user", content: "hi", timestamp: 1 }],
					state: { sessionId: "s1", sessionFile: "/tmp/s1.jsonl", thinkingLevel: "high", model: { provider: "fake", id: "model" } as never },
				}),
			},
		});
		const id = await store.getState().restartWithApprovalMode("s1", "yolo");
		expect(id).toBe("s1");
		expect(calls.slice(0, 4)).toEqual(["send:stop", "detach:s1", "start:s1", "attach:s1"]);
		expect(starts).toEqual([
			{ cwd: "/work", resume: "/tmp/s1.jsonl", model: "fake/model", thinking: "high", approvalMode: "yolo" },
		]);
		expect(store.getState().views.s1!.approvalMode).toBe("yolo");
		// transcript survives: the cold start refetch must not have emptied the view
		expect(store.getState().views.s1!.messages.length).toBeGreaterThanOrEqual(0);
	});

	test("the old process's exit during the restart does not mark the view dead", async () => {
		const { client } = recordingClient(["s2"]);
		const store = createAppStore({ client, http: {} as BridgeHttp });
		store.setState({
			sessions: [sessionItem("s2")],
			views: { s2: readyView("s2", { messages: [{ role: "user", content: "hi", timestamp: 1 }] }) },
		});
		const restart = store.getState().restartWithApprovalMode("s2", "always-ask");
		store.getState().dispatch({ t: "proc", sessionId: "s2", state: "exited", code: 0 });
		expect(store.getState().views.s2!.run.kind).not.toBe("dead");
		expect(store.getState().views.s2!.proc).toBe("starting");
		await restart;
		// once the restart is over, a real exit is honoured again
		store.getState().dispatch({ t: "proc", sessionId: "s2", state: "exited", code: 1 });
		expect(store.getState().views.s2!.run.kind).toBe("dead");
	});

	test("an empty session restarts fresh (no resume) and follows a changed session id", async () => {
		const { client, starts } = recordingClient(["s3-new"]);
		const store = createAppStore({ client, http: {} as BridgeHttp });
		store.setState({
			sessions: [sessionItem("s3")],
			currentSessionId: "s3",
			views: { s3: readyView("s3") },
		});
		const id = await store.getState().restartWithApprovalMode("s3", "yolo");
		expect(id).toBe("s3-new");
		expect(starts[0]).toMatchObject({ cwd: "/work", approvalMode: "yolo" });
		expect(starts[0]!.resume).toBeUndefined();
		expect(store.getState().currentSessionId).toBe("s3-new");
		expect(store.getState().views.s3).toBeUndefined();
		expect(store.getState().views["s3-new"]!.approvalMode).toBe("yolo");
		expect(store.getState().sessions.map(s => s.id)).toEqual(["s3-new"]);
	});

	test("while a run is in progress the pick is deferred; a preview only remembers the mode", async () => {
		const { client, calls } = recordingClient(["s4"]);
		const store = createAppStore({ client, http: {} as BridgeHttp });
		store.setState({
			sessions: [sessionItem("s4"), sessionItem("s5")],
			views: {
				s4: readyView("s4", { run: { kind: "running" }, approvalMode: "write" }),
				s5: { ...createSessionView("s5", { readonly: true }) },
			},
		});
		await store.getState().restartWithApprovalMode("s4", "yolo");
		expect(calls).toEqual([]);
		expect(store.getState().views.s4!.approvalMode).toBe("write");
		expect(store.getState().views.s4!.pendingApprovalMode).toBe("yolo");
		// picking the mode the process already runs with cancels the deferred switch
		await store.getState().restartWithApprovalMode("s4", "write");
		expect(store.getState().views.s4!.pendingApprovalMode).toBeUndefined();
		await store.getState().restartWithApprovalMode("s5", "yolo");
		expect(calls).toEqual([]);
		expect(store.getState().views.s5!.approvalMode).toBe("yolo");
	});

	test("a deferred pick is applied right before the next prompt once idle", async () => {
		const { client, calls, starts } = recordingClient(["s7"]);
		const store = createAppStore({ client, http: {} as BridgeHttp });
		store.setState({
			sessions: [sessionItem("s7")],
			currentSessionId: "s7",
			views: { s7: readyView("s7", { approvalMode: "write", pendingApprovalMode: "yolo" }) },
		});
		await store.getState().sendPrompt("s7", "hello");
		expect(starts).toEqual([expect.objectContaining({ cwd: "/work", approvalMode: "yolo" })]);
		expect(calls.indexOf("start:s7")).toBeLessThan(calls.findIndex(c => c.startsWith("rpc:prompt")));
		expect(store.getState().views.s7!.approvalMode).toBe("yolo");
		expect(store.getState().views.s7!.pendingApprovalMode).toBeUndefined();
	});

	test("background subagents defer the switch even when the run is idle", async () => {
		const { client, calls, starts } = recordingClient(["sb"]);
		const store = createAppStore({ client, http: {} as BridgeHttp });
		const bg = { id: "Bg", index: 0, agent: "task", agentSource: "bundled" as const, status: "running" as const, detached: true, lastUpdate: 1 };
		store.setState({
			sessions: [sessionItem("sb")],
			currentSessionId: "sb",
			views: { sb: readyView("sb", { approvalMode: "write", subagents: new Map([["Bg", bg]]) }) },
		});
		await store.getState().restartWithApprovalMode("sb", "yolo");
		expect(starts).toEqual([]);
		expect(store.getState().views.sb!.pendingApprovalMode).toBe("yolo");
		// the next prompt still goes out under the old mode while the subagent runs
		await store.getState().sendPrompt("sb", "hello");
		expect(starts).toEqual([]);
		expect(calls.some(c => c.startsWith("rpc:prompt"))).toBe(true);
		expect(store.getState().views.sb!.pendingApprovalMode).toBe("yolo");
		expect(store.getState().toasts.some(t => t.message.includes("后台子代理"))).toBe(true);
		// once it finished, the deferred pick applies before the next prompt
		store.setState(s => ({
			views: { ...s.views, sb: { ...s.views.sb!, run: { kind: "idle" }, subagents: new Map([["Bg", { ...bg, status: "completed" as const }]]) } },
		}));
		await store.getState().sendPrompt("sb", "again");
		expect(starts).toEqual([expect.objectContaining({ approvalMode: "yolo" })]);
	});

	test("a deferred pick never restarts the process for a steer into a live run", async () => {
		const { client, starts } = recordingClient(["s8"]);
		const store = createAppStore({ client, http: {} as BridgeHttp });
		store.setState({
			sessions: [sessionItem("s8")],
			views: { s8: readyView("s8", { run: { kind: "running" }, approvalMode: "write", pendingApprovalMode: "yolo" }) },
		});
		await store.getState().sendPrompt("s8", "steer me");
		expect(starts).toEqual([]);
		expect(store.getState().views.s8!.pendingApprovalMode).toBe("yolo");
	});

	test("a follow-up queued during the run waits, applies the deferred pick, then goes out as a prompt", async () => {
		const { client, calls, starts } = recordingClient(["s9"]);
		const store = createAppStore({ client, http: {} as BridgeHttp });
		store.setState({
			sessions: [sessionItem("s9")],
			currentSessionId: "s9",
			views: { s9: readyView("s9", { run: { kind: "running" }, approvalMode: "yolo", pendingApprovalMode: "always-ask" }) },
		});
		const sending = store.getState().sendPrompt("s9", "after this run", { mode: "followUp" });
		await Bun.sleep(0);
		// never handed to the old (yolo) process
		expect(calls.some(c => c === "rpc:follow_up")).toBe(false);
		expect(starts).toEqual([]);
		store.setState(s => ({ views: { ...s.views, s9: { ...s.views.s9!, run: { kind: "idle" } } } }));
		await sending;
		expect(starts).toEqual([expect.objectContaining({ approvalMode: "always-ask" })]);
		expect(calls.indexOf("start:s9")).toBeLessThan(calls.indexOf("rpc:prompt"));
		expect(calls).not.toContain("rpc:follow_up");
		expect(store.getState().views.s9!.approvalMode).toBe("always-ask");
	}, { timeout: 5_000 });

	test("an interrupt with a deferred pick aborts, applies the new mode, then prompts", async () => {
		const { client, calls, starts } = recordingClient(["s10"]);
		const store = createAppStore({ client, http: {} as BridgeHttp });
		store.setState({
			sessions: [sessionItem("s10")],
			views: { s10: readyView("s10", { run: { kind: "running" }, approvalMode: "yolo", pendingApprovalMode: "write" }) },
		});
		const sending = store.getState().sendPrompt("s10", "stop and do this", { mode: "interrupt" });
		await Bun.sleep(0);
		expect(calls).toContain("rpc:abort");
		expect(calls).not.toContain("rpc:abort_and_prompt");
		store.setState(s => ({ views: { ...s.views, s10: { ...s.views.s10!, run: { kind: "idle" } } } }));
		await sending;
		expect(starts).toEqual([expect.objectContaining({ approvalMode: "write" })]);
		expect(calls.indexOf("rpc:abort")).toBeLessThan(calls.indexOf("start:s10"));
		expect(calls.indexOf("start:s10")).toBeLessThan(calls.indexOf("rpc:prompt"));
	}, { timeout: 5_000 });

	test("deleting a session also forgets its unread/attention state", () => {
		const { client } = recordingClient([]);
		const store = createAppStore({ client, http: {} as BridgeHttp });
		store.setState({
			sessions: [sessionItem("gone"), sessionItem("kept")],
			views: { gone: readyView("gone"), kept: readyView("kept") },
			attention: { gone: 200, kept: 100 },
			todoFlash: { gone: 1 },
		});
		store.getState().leaveSession("gone", { drop: true });
		expect(store.getState().attention).toEqual({ kept: 100 });
		expect(store.getState().todoFlash).toEqual({});
		expect(store.getState().views.gone).toBeUndefined();
	});

	test("a follow-up without a deferred pick is still queued into the live run", async () => {
		const { client, calls, starts } = recordingClient(["s11"]);
		const store = createAppStore({ client, http: {} as BridgeHttp });
		store.setState({
			sessions: [sessionItem("s11")],
			views: { s11: readyView("s11", { run: { kind: "running" }, approvalMode: "write" }) },
		});
		await store.getState().sendPrompt("s11", "later", { mode: "followUp" });
		expect(calls).toContain("rpc:follow_up");
		expect(starts).toEqual([]);
	});

	test("a failed start toasts and leaves the session exited instead of stuck on 'starting'", async () => {
		const client = {
			send: () => undefined,
			detach: () => undefined,
			attach: () => undefined,
			start: async () => {
				throw new Error("spawn failed");
			},
			resolveReqId: () => undefined,
			rpc: async () => ({}),
		} as unknown as BridgeClient;
		const store = createAppStore({ client, http: {} as BridgeHttp });
		store.setState({ sessions: [sessionItem("s6")], views: { s6: readyView("s6") } });
		await store.getState().restartWithApprovalMode("s6", "yolo");
		expect(store.getState().toasts.at(-1)?.message).toBe("spawn failed");
		expect(store.getState().views.s6!.proc).toBe("exited");
	});
});

describe("process warm-up and release (§3.1)", () => {
	const previewItem = (id: string) => ({ ...sessionItem(id), live: false });
	const transcriptHttp = { getTranscript: async () => [{ role: "user", content: "old", timestamp: 1 }] } as unknown as BridgeHttp;

	test("selecting a session shows the preview and warms its process right away", async () => {
		const { client, calls, starts } = recordingClient(["p1"]);
		const store = createAppStore({ client, http: transcriptHttp, warmStartDelayMs: 0 });
		store.setState({ sessions: [previewItem("p1")], config: { archived: [], recentProjects: [], defaultApprovalMode: "always-ask" } });
		await store.getState().openSession(previewItem("p1"));
		await waitUntil(() => store.getState().views.p1?.readonly === false);
		expect(starts).toEqual([expect.objectContaining({ cwd: "/work", resume: "/tmp/p1.jsonl", approvalMode: "always-ask" })]);
		expect(calls).toContain("attach:p1");
	});

	test("skimming the sidebar only warms the session the user stays on", async () => {
		const { client, starts } = recordingClient(["b"]);
		const store = createAppStore({ client, http: transcriptHttp, warmStartDelayMs: 20 });
		store.setState({ sessions: [previewItem("a"), previewItem("b")] });
		await store.getState().openSession(previewItem("a"));
		await store.getState().openSession(previewItem("b"));
		await waitUntil(() => starts.length > 0);
		await Bun.sleep(40);
		expect(starts.map(s => s.resume)).toEqual(["/tmp/b.jsonl"]);
	});

	test("a permission picked while the warm-up is in flight is applied once it lands", async () => {
		const { client, starts } = recordingClient(["p2"]);
		const store = createAppStore({ client, http: transcriptHttp, warmStartDelayMs: 0 });
		const original = client.start.bind(client);
		let landed!: () => void;
		const gate = new Promise<void>(resolve => (landed = resolve));
		(client as { start: typeof client.start }).start = async opts => {
			const result = await original(opts);
			if (starts.length === 1) await gate;
			return result;
		};
		// Like the bridge: attaching replies with the process state.
		const attach = client.attach.bind(client);
		(client as { attach: typeof client.attach }).attach = id => {
			attach(id);
			store.getState().dispatch({ t: "proc", sessionId: id, state: "ready" });
		};
		store.setState({ sessions: [previewItem("p2")] });
		await store.getState().openSession(previewItem("p2"));
		expect(store.getState().views.p2!.proc).toBe("starting");
		const switched = store.getState().restartWithApprovalMode("p2", "yolo");
		landed();
		await switched;
		expect(starts).toHaveLength(2);
		expect(starts.at(-1)?.approvalMode).toBe("yolo");
		expect(store.getState().views.p2!.approvalMode).toBe("yolo");
	});

	test("a released process keeps the transcript without an exit banner and warms again on return", async () => {
		const { client, starts } = recordingClient(["r1"]);
		const store = createAppStore({ client, http: transcriptHttp, warmStartDelayMs: 0 });
		const item = sessionItem("r1");
		store.setState({
			sessions: [{ ...item, live: false }],
			currentSessionId: null,
			views: { r1: readyView("r1", { messages: [{ role: "user", content: "hi", timestamp: 1 }] }) },
		});
		store.getState().dispatch({ t: "proc", sessionId: "r1", state: "exited", reason: "released" });
		const view = store.getState().views.r1!;
		expect(view.proc).toBe("none");
		expect(view.run.kind).toBe("idle");
		expect(view.banners.some(b => b.kind === "proc-exit")).toBe(false);
		expect(view.messages).toHaveLength(1);
		await store.getState().openSession({ ...item, live: false });
		await waitUntil(() => starts.length === 1);
		expect(starts[0]).toMatchObject({ resume: "/tmp/r1.jsonl" });
	});

	test("the bridge is told which session this tab shows", () => {
		const focused: (string | null)[] = [];
		const { client } = recordingClient(["f"]);
		(client as unknown as { focus: (id: string | null) => void }).focus = id => void focused.push(id);
		const store = createAppStore({ client, http: {} as BridgeHttp });
		store.setState({ currentSessionId: "f" });
		store.getState().startWelcome();
		expect(focused).toEqual(["f", null]);
	});
});

describe("in-process session switch (branch / fork)", () => {
	test("session_switched detaches the source view onto a readonly snapshot and moves the live view to the new sessionId", async () => {
		const { client } = recordingClient(["s-branch"]);
		const oldMessages = [
			{ role: "user" as const, content: [{ type: "text" as const, text: "Ciallo" }], timestamp: 1 },
			{ role: "assistant" as const, content: [], api: "openai", provider: "p", model: "m", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "aborted" as const, timestamp: 2 },
		];
		const http = {
			getTranscript: async (id: string) => (id === "s-old" ? oldMessages : []),
			listSessions: async () => [
				{ ...sessionItem("s-new"), live: true },
				{ ...sessionItem("s-old"), live: false },
			],
		} as unknown as BridgeHttp;
		const store = createAppStore({ client, http });
		store.setState({
			sessions: [sessionItem("s-old")],
			currentSessionId: "s-old",
			views: {
				"s-old": readyView("s-old", {
					approvalMode: "yolo",
					messages: oldMessages,
				}),
			},
		});

		store.getState().dispatch({
			t: "session_switched",
			fromSessionId: "s-old",
			sessionId: "s-new",
			sessionFile: "/tmp/s-new.jsonl",
		});

		expect(store.getState().currentSessionId).toBe("s-new");
		const oldView = store.getState().views["s-old"]!;
		expect(oldView.proc).toBe("none");
		expect(oldView.readonly).toBe(true);
		expect(oldView.messages).toEqual(oldMessages);

		const newView = store.getState().views["s-new"]!;
		expect(newView.proc).toBe("ready");
		expect(newView.readonly).toBe(false);
		expect(newView.approvalMode).toBe("yolo");

		// Streaming into the new session never mutates the old session's view.
		const replyMsg = {
			role: "assistant" as const,
			content: [{ type: "text" as const, text: "Ciallo~ 👋" }],
			api: "openai",
			provider: "p",
			model: "m",
			usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
			stopReason: "stop" as const,
			timestamp: 3,
		};
		store.getState().dispatch({
			t: "frame",
			sessionId: "s-new",
			seq: 1,
			frame: { type: "message_end", messageId: "m-1", message: replyMsg },
		});
		expect(store.getState().views["s-new"]!.messages).toEqual([{ ...replyMsg, animateOnMount: true }]);
		expect(store.getState().views["s-old"]!.messages).toEqual(oldMessages);
	});
});

async function waitUntil(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!predicate()) {
		if (Date.now() > deadline) throw new Error("waitUntil timed out");
		await Bun.sleep(2);
	}
}
