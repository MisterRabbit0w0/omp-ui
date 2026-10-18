/**
 * Process pool with LRU eviction (docs/DESIGN.md §3.1).
 *
 * Cap defaults to 6 live processes. When over capacity the least recently
 * used *evictable* process is stopped: eviction requires `settled`, not
 * `streaming`, and no open UI requests. If nothing is evictable the pool
 * temporarily overflows rather than killing active work.
 */

/** Minimal surface the pool needs; OmpProcess satisfies it. */
export interface PoolProcess {
	readonly streaming: boolean;
	readonly settled: boolean;
	readonly pendingUi: { readonly size: number };
	stop(): Promise<void>;
}

interface PoolEntry<T> {
	proc: T;
	tick: number;
}

export const DEFAULT_POOL_MAX = 6;

export class ProcessPool<T extends PoolProcess> {
	readonly max: number;
	#entries = new Map<string, PoolEntry<T>>();
	#tick = 0;

	constructor(max: number = DEFAULT_POOL_MAX) {
		this.max = max;
	}

	get size(): number {
		return this.#entries.size;
	}

	keys(): string[] {
		return [...this.#entries.keys()];
	}

	get(key: string): T | undefined {
		const entry = this.#entries.get(key);
		if (entry) entry.tick = ++this.#tick;
		return entry?.proc;
	}

	/** Read without counting as a use (no LRU bump). */
	peek(key: string): T | undefined {
		return this.#entries.get(key)?.proc;
	}

	has(key: string): boolean {
		return this.#entries.has(key);
	}

	touch(key: string): void {
		const entry = this.#entries.get(key);
		if (entry) entry.tick = ++this.#tick;
	}

	/** Insert (or replace) and evict LRU evictable entries down to the cap. */
	set(key: string, proc: T): void {
		const replaced = this.#entries.get(key);
		this.#entries.set(key, { proc, tick: ++this.#tick });
		if (replaced) void replaced.proc.stop();
		void this.evictDownTo(this.max, key);
	}

	async remove(key: string): Promise<void> {
		const entry = this.#entries.get(key);
		if (!entry) return;
		this.#entries.delete(key);
		await entry.proc.stop();
	}

	/** Evict evictable entries (LRU first) until size <= target. Returns evicted keys. */
	async evictDownTo(target: number, protectKey?: string): Promise<string[]> {
		const evicted: string[] = [];
		while (this.#entries.size > target) {
			let oldestKey: string | null = null;
			let oldestTick = Number.POSITIVE_INFINITY;
			for (const [key, entry] of this.#entries) {
				if (key === protectKey || !this.#evictable(entry.proc)) continue;
				if (entry.tick < oldestTick) {
					oldestTick = entry.tick;
					oldestKey = key;
				}
			}
			if (oldestKey === null) break; // nothing evictable: overflow, never kill active work
			const entry = this.#entries.get(oldestKey)!;
			this.#entries.delete(oldestKey);
			evicted.push(oldestKey);
			await entry.proc.stop();
		}
		return evicted;
	}

	async stopAll(): Promise<void> {
		const entries = [...this.#entries.values()];
		this.#entries.clear();
		await Promise.all(entries.map(entry => entry.proc.stop()));
	}

	#evictable(proc: T): boolean {
		return proc.settled && !proc.streaming && proc.pendingUi.size === 0;
	}
}
