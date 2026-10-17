import { afterEach, describe, expect, test, vi } from "bun:test";
import type { B2C, C2B } from "@omp-ui/protocol";
import { BridgeClient, BridgeRpcError, type ConnectionState, type WebSocketLike } from "./ws";
import { parsePartialJson } from "./partial-json";

class MockWS implements WebSocketLike {
	static instances: MockWS[] = [];
	readyState = 0;
	sent: C2B[] = [];
	onopen: (() => void) | null = null;
	onmessage: ((ev: { data: unknown }) => void) | null = null;
	onclose: (() => void) | null = null;
	onerror: (() => void) | null = null;

	constructor(readonly url: string) {
		MockWS.instances.push(this);
	}

	send(data: string): void {
		this.sent.push(JSON.parse(data) as C2B);
	}

	close(): void {
		this.readyState = 3;
		this.onclose?.();
	}

	// ── test drivers ──
	serverOpen(): void {
		this.readyState = 1;
		this.onopen?.();
	}

	serverSend(msg: B2C): void {
		this.onmessage?.({ data: JSON.stringify(msg) });
	}

	serverClose(): void {
		this.readyState = 3;
		this.onclose?.();
	}
}

function makeClient(overrides: {
	onMessage?: (msg: B2C) => void;
	onConnection?: (state: ConnectionState) => void;
}): BridgeClient {
	MockWS.instances = [];
	return new BridgeClient({
		url: "ws://test/ws",
		token: "tok",
		WebSocketImpl: MockWS,
		backoff: { initialMs: 1, maxMs: 4 },
		onMessage: overrides.onMessage,
		...(overrides.onConnection ? { onConnection: overrides.onConnection } : {}),
	});
}

function hello(socket: MockWS): void {
	socket.serverOpen();
	socket.serverSend({ t: "welcome", ompVersion: "18.11.1", protocolVersion: 2 });
}

afterEach(() => {
	vi.useRealTimers();
});

describe("BridgeClient", () => {
	test("connects, sends hello with the token, reports connected", () => {
		const states: ConnectionState[] = [];
		const client = makeClient({ onConnection: s => states.push(s) });
		const ws = MockWS.instances[0]!;
		ws.serverOpen();
		expect(ws.sent).toEqual([{ t: "hello", token: "tok" }]);
		ws.serverSend({ t: "welcome", ompVersion: "18.11.1", protocolVersion: 2 });
		expect(client.connectionState).toBe("connected");
		expect(states).toEqual(["connected"]);
		client.close();
	});

	test("rpc resolves via reqId correlation; failure rejects with code", async () => {
		const client = makeClient({});
		hello(MockWS.instances[0]!);
		const ok = client.rpc("s1", { type: "get_state" });
		const rpcFrame = MockWS.instances[0]!.sent.find(m => m.t === "rpc");
		if (rpcFrame?.t !== "rpc") throw new Error("rpc frame not sent");
		MockWS.instances[0]!.serverSend({
			t: "rpc_result",
			reqId: rpcFrame.reqId,
			response: { type: "response", command: "get_state", success: true, id: "b-1", data: { sessionId: "s1" } },
		});
		await expect(ok).resolves.toEqual({ sessionId: "s1" });
		// bridge-internal command id maps back to our reqId (prompt_result correlation)
		expect(client.resolveReqId("b-1")).toBe(rpcFrame.reqId);

		const bad = client.rpc("s1", { type: "abort" });
		const badFrame = MockWS.instances[0]!.sent.filter(m => m.t === "rpc")[1];
		if (badFrame?.t !== "rpc") throw new Error("second rpc frame not sent");
		MockWS.instances[0]!.serverSend({
			t: "rpc_result",
			reqId: badFrame.reqId,
			response: { type: "response", command: "abort", success: false, id: "b-2", error: "session busy", code: "session_busy" },
		});
		const err: unknown = await bad.catch((e: unknown) => e);
		expect(err).toBeInstanceOf(BridgeRpcError);
		expect((err as BridgeRpcError).message).toBe("session busy");
		expect((err as BridgeRpcError).code).toBe("session_busy");
		client.close();
	});

	test("reconnects and re-attaches sessions with sinceSeq = lastSeq", () => {
		vi.useFakeTimers();
		const frames: B2C[] = [];
		const states: ConnectionState[] = [];
		const client = makeClient({ onMessage: m => frames.push(m), onConnection: s => states.push(s) });
		hello(MockWS.instances[0]!);
		client.attach("s1");
		client.attach("s2");
		MockWS.instances[0]!.serverSend({ t: "frame", sessionId: "s1", seq: 5, frame: { type: "agent_start" } });
		MockWS.instances[0]!.serverSend({ t: "frame", sessionId: "s2", seq: 12, frame: { type: "agent_start" } });

		MockWS.instances[0]!.serverClose();
		expect(client.connectionState).toBe("reconnecting");

		vi.advanceTimersByTime(10); // past the 1ms initial backoff
		expect(MockWS.instances).toHaveLength(2);
		const ws2 = MockWS.instances[1]!;
		ws2.serverOpen();
		expect(ws2.sent[0]).toEqual({ t: "hello", token: "tok" });
		ws2.serverSend({ t: "welcome", ompVersion: "18.11.1", protocolVersion: 2 });
		expect(client.connectionState).toBe("connected");
		expect(ws2.sent).toContainEqual({ t: "attach", sessionId: "s1", sinceSeq: 5 });
		expect(ws2.sent).toContainEqual({ t: "attach", sessionId: "s2", sinceSeq: 12 });
		expect(states).toEqual(["connected", "reconnecting", "connected"]);
		client.close();
	});

	test("queues sends while reconnecting and flushes after welcome", async () => {
		vi.useFakeTimers();
		const client = makeClient({});
		hello(MockWS.instances[0]!);
		MockWS.instances[0]!.serverClose();
		expect(client.connectionState).toBe("reconnecting");
		const pending = client.rpc("s1", { type: "abort" });
		vi.advanceTimersByTime(10);
		expect(MockWS.instances).toHaveLength(2);
		const ws2 = MockWS.instances[1]!;
		hello(ws2);
		const flushed = ws2.sent.find(m => m.t === "rpc");
		if (flushed?.t !== "rpc") throw new Error("queued rpc not flushed");
		ws2.serverSend({ t: "rpc_result", reqId: flushed.reqId, response: { type: "response", command: "abort", success: true, id: "b-9", data: undefined } });
		await expect(pending).resolves.toBeUndefined();
		client.close();
	});

	test("close() is final: no reconnect, pending rejected", async () => {
		vi.useFakeTimers();
		const client = makeClient({});
		hello(MockWS.instances[0]!);
		const pending = client.rpc("s1", { type: "abort" });
		client.close();
		await expect(pending).rejects.toBeInstanceOf(BridgeRpcError);
		expect(client.connectionState).toBe("closed");
		vi.advanceTimersByTime(60_000);
		expect(MockWS.instances).toHaveLength(1);
	});
});

describe("parsePartialJson", () => {
	test("complete input parses directly", () => {
		expect(parsePartialJson('{"a":1}')).toEqual({ a: 1 });
		expect(parsePartialJson("[1,2]")).toEqual([1, 2]);
	});

	test("truncated string value is kept", () => {
		expect(parsePartialJson('{"command":"ls -l')).toEqual({ command: "ls -l" });
	});

	test("dangling separators drop back to the last complete value", () => {
		expect(parsePartialJson('{"command":"ls","timeout":')).toEqual({ command: "ls" });
		expect(parsePartialJson('{"a":1,')).toEqual({ a: 1 });
		expect(parsePartialJson('{"a": tru')).toEqual({});
	});

	test("open containers close", () => {
		expect(parsePartialJson('{"a":[1,2')).toEqual({ a: [1, 2] });
		expect(parsePartialJson("{")).toEqual({});
	});

	test("unparseable input yields undefined", () => {
		expect(parsePartialJson("")).toBeUndefined();
		expect(parsePartialJson("hello world")).toBeUndefined();
	});
});
