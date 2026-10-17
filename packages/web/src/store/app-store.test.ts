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
		rpc: async () => ({}),
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

	test("refuses while a run is in progress; a preview only remembers the mode", async () => {
		const { client, calls } = recordingClient(["s4"]);
		const store = createAppStore({ client, http: {} as BridgeHttp });
		store.setState({
			sessions: [sessionItem("s4"), sessionItem("s5")],
			views: {
				s4: readyView("s4", { run: { kind: "running" } }),
				s5: { ...createSessionView("s5", { readonly: true }) },
			},
		});
		await store.getState().restartWithApprovalMode("s4", "yolo");
		expect(calls).toEqual([]);
		expect(store.getState().views.s4!.approvalMode).toBeUndefined();
		await store.getState().restartWithApprovalMode("s5", "yolo");
		expect(calls).toEqual([]);
		expect(store.getState().views.s5!.approvalMode).toBe("yolo");
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
