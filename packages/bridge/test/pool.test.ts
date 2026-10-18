import { describe, expect, test } from "bun:test";
import { PoolFullError, ProcessPool, type PoolProcess } from "../src/pool";

class FakeProc implements PoolProcess {
	streaming = false;
	settled = true;
	pendingUi = new Map<string, unknown>();
	runningSubagents = new Set<string>();
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

	test("processes with running (background) subagents are not evicted", async () => {
		let now = 0;
		const pool = new ProcessPool<FakeProc>({ softMax: 1, hardMax: 1, idleTtlMs: 1, now: () => now });
		const parent = new FakeProc(); // settled, but a detached subagent still works in-process
		parent.runningSubagents.add("Bg");
		pool.set("parent", parent);
		pool.set("other", new FakeProc());
		await flushMicrotasks();
		now = 10;
		expect(await pool.reapIdle()).not.toContain("parent");
		await expect(pool.reserve()).rejects.toBeInstanceOf(PoolFullError);
		expect(parent.stopped).toBe(0);
		parent.runningSubagents.clear();
		expect(await pool.reapIdle()).toContain("parent");
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

describe("ProcessPool elastic caps", () => {
	const busy = (): FakeProc => {
		const proc = new FakeProc();
		proc.streaming = true;
		proc.settled = false;
		return proc;
	};

	test("idle unpinned processes are released down to the soft cap, pinned ones stay", async () => {
		const pinned = new Set(["a"]);
		const pool = new ProcessPool<FakeProc>({ softMax: 2, hardMax: 10, isPinned: key => pinned.has(key) });
		const a = new FakeProc();
		const b = new FakeProc();
		const c = new FakeProc();
		pool.set("a", a); // oldest, but pinned (the tab shows it)
		pool.set("b", b);
		pool.set("c", c);
		await flushMicrotasks();
		expect(a.stopped).toBe(0);
		expect(b.stopped).toBe(1);
		expect(pool.keys().sort()).toEqual(["a", "c"]);
	});

	test("grows past the soft cap while everything is busy, shrinks back once runs settle", async () => {
		const pool = new ProcessPool<FakeProc>({ softMax: 1, hardMax: 4 });
		const x = busy();
		const y = busy();
		pool.set("x", x);
		pool.set("y", y);
		await flushMicrotasks();
		expect(pool.size).toBe(2);
		x.streaming = false;
		x.settled = true;
		y.streaming = false;
		y.settled = true;
		expect(await pool.rebalance()).toEqual(["x"]);
		expect(pool.keys()).toEqual(["y"]);
	});

	test("admission at the hard cap releases an idle process first (unpinned before pinned)", async () => {
		const pool = new ProcessPool<FakeProc>({ softMax: 1, hardMax: 3, isPinned: key => key === "p" });
		const p = new FakeProc();
		const q = new FakeProc();
		pool.set("p", p);
		pool.set("busy", busy());
		pool.set("q", q); // p is pinned and q (newest) protected: the pool overflows its soft cap to 3
		await flushMicrotasks();
		expect(pool.size).toBe(3);
		const done = await pool.reserve();
		expect(q.stopped).toBe(1); // the unpinned idle one went first
		expect(p.stopped).toBe(0);
		done();
	});

	test("admission fails when every slot at the hard cap is busy, and slots are released after spawn", async () => {
		const pool = new ProcessPool<FakeProc>({ softMax: 1, hardMax: 2 });
		pool.set("a", busy());
		const release = await pool.reserve(); // one free slot, now reserved by a spawn in flight
		await expect(pool.reserve()).rejects.toBeInstanceOf(PoolFullError);
		release();
		const again = await pool.reserve();
		again();
	});

	test("the idle reaper releases unpinned idle processes after the TTL only", async () => {
		let now = 0;
		const evicted: string[] = [];
		const pool = new ProcessPool<FakeProc>({
			softMax: 6,
			hardMax: 10,
			idleTtlMs: 1000,
			now: () => now,
			isPinned: key => key === "viewed",
			onEvict: key => evicted.push(key),
		});
		const old = new FakeProc();
		const viewed = new FakeProc();
		const running = busy();
		pool.set("old", old);
		pool.set("viewed", viewed);
		pool.set("running", running);
		now = 500;
		pool.touch("running");
		expect(await pool.reapIdle()).toEqual([]);
		now = 1600;
		expect(await pool.reapIdle()).toEqual(["old"]);
		expect(evicted).toEqual(["old"]);
		expect(old.stopped).toBe(1);
		expect(viewed.stopped).toBe(0);
		expect(running.stopped).toBe(0);
		// remove() is the caller's own stop, not an eviction
		await pool.remove("viewed");
		expect(evicted).toEqual(["old"]);
	});

	test("the resource-based hard cap never drops below the soft cap", () => {
		const pool = new ProcessPool<FakeProc>({ softMax: 4 });
		expect(pool.hardMax).toBeGreaterThanOrEqual(4);
		expect(new ProcessPool<FakeProc>({ softMax: 4, hardMax: 2 }).hardMax).toBe(4);
	});
});
