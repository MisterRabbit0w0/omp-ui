import { describe, expect, test } from "bun:test";
import { ProcessPool, type PoolProcess } from "../src/pool";

class FakeProc implements PoolProcess {
	streaming = false;
	settled = true;
	pendingUi = new Map<string, unknown>();
	stopped = 0;
	async stop(): Promise<void> {
		this.stopped++;
	}
}

// Eviction off set() is a timer-free promise chain; flushing microtasks is
// deterministic (no wall clock involved).
async function flushMicrotasks(): Promise<void> {
	for (let i = 0; i < 20; i++) await Promise.resolve();
}

describe("ProcessPool", () => {
	test("evicts the least recently used settled process when over capacity", async () => {
		const pool = new ProcessPool<FakeProc>(2);
		const a = new FakeProc();
		const b = new FakeProc();
		const c = new FakeProc();
		pool.set("a", a);
		pool.set("b", b);
		await flushMicrotasks();
		pool.touch("a"); // b is now the LRU
		pool.set("c", c);
		await flushMicrotasks();
		expect(b.stopped).toBe(1);
		expect(a.stopped).toBe(0);
		expect(c.stopped).toBe(0);
		expect(pool.keys().sort()).toEqual(["a", "c"]);
	});

	test("never evicts streaming processes; pool may overflow", async () => {
		const pool = new ProcessPool<FakeProc>(1);
		const streaming = new FakeProc();
		streaming.streaming = true;
		streaming.settled = false;
		pool.set("s", streaming);
		const other = new FakeProc();
		pool.set("o", other);
		await flushMicrotasks();
		expect(streaming.stopped).toBe(0);
		expect(other.stopped).toBe(0);
		expect(pool.size).toBe(2);
	});

	test("never evicts processes with open UI requests", async () => {
		const pool = new ProcessPool<FakeProc>(1);
		const busy = new FakeProc();
		busy.pendingUi.set("ui-1", {});
		pool.set("busy", busy);
		pool.set("other", new FakeProc());
		await flushMicrotasks();
		expect(busy.stopped).toBe(0);
		expect(pool.size).toBe(2);
	});

	test("unsettled processes are not evicted", async () => {
		const pool = new ProcessPool<FakeProc>(1);
		const unsettled = new FakeProc();
		unsettled.settled = false;
		pool.set("u", unsettled);
		pool.set("n", new FakeProc());
		await flushMicrotasks();
		expect(unsettled.stopped).toBe(0);
		expect(pool.size).toBe(2);
	});

	test("remove stops the process", async () => {
		const pool = new ProcessPool<FakeProc>(5);
		const proc = new FakeProc();
		pool.set("x", proc);
		await pool.remove("x");
		expect(proc.stopped).toBe(1);
		expect(pool.size).toBe(0);
	});
});
