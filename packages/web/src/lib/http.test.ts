import { afterEach, describe, expect, test } from "bun:test";
import { BridgeHttp } from "./http";

const realFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = realFetch;
});

describe("BridgeHttp default fetch", () => {
	test("calls global fetch unbound from the instance (browsers throw 'Illegal invocation' otherwise)", async () => {
		let receiver: unknown = "unset";
		globalThis.fetch = (function (this: unknown) {
			receiver = this;
			return Promise.resolve(new Response("[]", { headers: { "content-type": "application/json" } }));
		}) as unknown as typeof fetch;
		const http = new BridgeHttp({ token: "t" });
		await http.listSessions();
		expect(receiver).not.toBe(http);
		expect(receiver === undefined || receiver === globalThis).toBe(true);
	});
});
