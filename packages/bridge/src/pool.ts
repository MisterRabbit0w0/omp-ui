/**
 * Elastic process pool (docs/DESIGN.md §3.1).
 *
 * - **Soft cap** (default 6): idle processes beyond it are released, least recently used first.
 * - **Hard cap** (default: sized from free memory and CPU count, never below the soft cap): the pool grows past
 *   the soft cap only while the extra processes are busy (running, settling, waiting on a dialog) or pinned
 *   (a browser tab is looking at them). Admission beyond the hard cap first releases evictable processes and
 *   fails if none can go — active work is never killed.
 * - **Idle TTL** (default 10 min): an unpinned, settled process with no use for that long is released even
 *   below the soft cap, so a quiet bridge hands its memory back.
 *
 * Eviction requires `settled`, not `streaming`, no open UI requests and no running subagents (they run in-process,
 * and background ones outlive the parent's settle). Unpinned processes go before pinned ones.
 */
import * as os from "node:os";

/** Minimal surface the pool needs; OmpProcess satisfies it. */
export interface PoolProcess {
	readonly streaming: boolean;
	readonly settled: boolean;
	readonly pendingUi: { readonly size: number };
	/** In-process subagents still running (background jobs outlive the parent's settle). */
	readonly runningSubagents: { readonly size: number };
	stop(): Promise<void>;
}

interface PoolEntry<T> {
	proc: T;
	tick: number;
	/** Wall clock of the last use (insert, get, touch), for the idle TTL. */
	usedAt: number;
}

export const DEFAULT_POOL_MAX = 6;
export const DEFAULT_IDLE_TTL_MS = 10 * 60_000;
/** Rough resident size of one omp process, for the default hard cap. */
const PROC_BUDGET_BYTES = 300 * 1024 * 1024;
/** Memory left for everything else before the pool stops growing. */
const MEMORY_RESERVE_BYTES = 1024 * 1024 * 1024;
const HARD_CAP_CEILING = 32;

/**
 * Default hard cap: the current size plus as many processes as free memory (minus a reserve) fits, bounded by
 * 4× the CPU count and {@link HARD_CAP_CEILING}; never below the soft cap.
 */
export function resourceHardCap(soft: number, size: number): number {
	const headroom = Math.floor(Math.max(0, os.freemem() - MEMORY_RESERVE_BYTES) / PROC_BUDGET_BYTES);
	const ceiling = Math.max(soft, Math.min(HARD_CAP_CEILING, os.cpus().length * 4));
	return Math.max(soft, Math.min(ceiling, size + headroom));
}

export class PoolFullError extends Error {
	constructor(readonly limit: number) {
		super(`进程池已满：${limit} 个会话进程都在工作中，请等待其中一个结束或停止后再试`);
		this.name = "PoolFullError";
	}
}

export interface PoolOptions<T> {
	/** Idle processes beyond this are released. Default {@link DEFAULT_POOL_MAX}. */
	softMax?: number;
	/** Absolute ceiling (a number, or computed from the current size). Default {@link resourceHardCap}. */
	hardMax?: number | ((size: number) => number);
	/** Release unpinned idle processes unused for this long; `0` disables. Default {@link DEFAULT_IDLE_TTL_MS}. */
	idleTtlMs?: number;
	/** Pinned processes (a client is viewing them) are released only when the hard cap demands it, and never by the TTL. */
	isPinned?: (key: string) => boolean;
	/** Called right before the pool itself stops a process (eviction / TTL), not on `remove`/`stopAll`. */
	onEvict?: (key: string, proc: T) => void;
	/** Test seam. */
	now?: () => number;
}

export class ProcessPool<T extends PoolProcess> {
	/** Soft cap. */
	readonly max: number;
	readonly idleTtlMs: number;
	#hardMax: number | ((size: number) => number);
	#isPinned: (key: string) => boolean;
	#onEvict: ((key: string, proc: T) => void) | undefined;
	#now: () => number;
	#entries = new Map<string, PoolEntry<T>>();
	/** Spawns admitted but not yet inserted (a process takes a while to start). */
	#reserved = 0;
	#tick = 0;

	constructor(options: number | PoolOptions<T> = {}) {
		const opts: PoolOptions<T> = typeof options === "number" ? { softMax: options } : options;
		this.max = Math.max(1, opts.softMax ?? DEFAULT_POOL_MAX);
		this.idleTtlMs = opts.idleTtlMs ?? DEFAULT_IDLE_TTL_MS;
		this.#hardMax = opts.hardMax ?? (size => resourceHardCap(this.max, size));
		this.#isPinned = opts.isPinned ?? (() => false);
		this.#onEvict = opts.onEvict;
		this.#now = opts.now ?? Date.now;
	}

	get size(): number {
		return this.#entries.size;
	}

	/** Current hard cap (resource-based caps move with free memory). */
	get hardMax(): number {
		const raw = typeof this.#hardMax === "number" ? this.#hardMax : this.#hardMax(this.#entries.size);
		return Math.max(this.max, raw);
	}

	keys(): string[] {
		return [...this.#entries.keys()];
	}

	get(key: string): T | undefined {
		const entry = this.#entries.get(key);
		if (entry) this.#use(entry);
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
		if (entry) this.#use(entry);
	}

	/**
	 * Reserve a slot for a process about to be spawned. Over the hard cap, evictable processes are released first
	 * (unpinned, then pinned); throws {@link PoolFullError} when everything left is busy. `replacing` names a key
	 * whose process the new one supersedes (it frees its own slot). Call the returned function once the spawn
	 * finished (inserted or failed).
	 */
	async reserve(replacing?: string): Promise<() => void> {
		const replaces = (): number => (replacing !== undefined && this.#entries.has(replacing) ? 1 : 0);
		const occupied = (): number => this.#entries.size + this.#reserved - replaces();
		if (occupied() >= this.hardMax) {
			await this.evictDownTo(this.hardMax - 1 - this.#reserved + replaces(), replacing, { includePinned: true });
		}
		const limit = this.hardMax;
		if (occupied() >= limit) throw new PoolFullError(limit);
		this.#reserved++;
		let released = false;
		return () => {
			if (released) return;
			released = true;
			this.#reserved--;
		};
	}

	/** Insert (or replace) and release idle entries over the caps. */
	set(key: string, proc: T): void {
		const replaced = this.#entries.get(key);
		const entry: PoolEntry<T> = { proc, tick: 0, usedAt: 0 };
		this.#use(entry);
		this.#entries.set(key, entry);
		if (replaced) void replaced.proc.stop();
		void this.rebalance(key);
	}

	async remove(key: string): Promise<void> {
		const entry = this.#entries.get(key);
		if (!entry) return;
		this.#entries.delete(key);
		await entry.proc.stop();
	}

	/**
	 * Shrink toward the caps: unpinned idle processes go down to the soft cap; pinned idle ones only while the
	 * pool is over the hard cap. Call when a process goes idle or loses its pin. Returns released keys.
	 */
	async rebalance(protectKey?: string): Promise<string[]> {
		const evicted = await this.evictDownTo(this.max, protectKey);
		if (this.#entries.size > this.hardMax) {
			evicted.push(...(await this.evictDownTo(this.hardMax, protectKey, { includePinned: true })));
		}
		return evicted;
	}

	/** Release unpinned idle processes unused for the TTL. Returns released keys. */
	async reapIdle(): Promise<string[]> {
		if (this.idleTtlMs <= 0) return [];
		const cutoff = this.#now() - this.idleTtlMs;
		const stale = [...this.#entries].filter(
			([key, entry]) => entry.usedAt <= cutoff && this.#evictable(entry.proc) && !this.#isPinned(key),
		);
		await Promise.all(stale.map(([key, entry]) => this.#evict(key, entry)));
		return stale.map(([key]) => key);
	}

	/**
	 * Evict evictable entries (LRU first, unpinned before pinned) until size <= target. Pinned entries are only
	 * considered with `includePinned`. Returns evicted keys.
	 */
	async evictDownTo(target: number, protectKey?: string, opts: { includePinned?: boolean } = {}): Promise<string[]> {
		const evicted: string[] = [];
		while (this.#entries.size > target) {
			const victim = this.#pickVictim(protectKey, false) ?? (opts.includePinned ? this.#pickVictim(protectKey, true) : null);
			if (victim === null) break; // nothing evictable: overflow, never kill active work
			evicted.push(victim);
			await this.#evict(victim, this.#entries.get(victim)!);
		}
		return evicted;
	}

	async stopAll(): Promise<void> {
		const entries = [...this.#entries.values()];
		this.#entries.clear();
		await Promise.all(entries.map(entry => entry.proc.stop()));
	}

	#pickVictim(protectKey: string | undefined, pinned: boolean): string | null {
		let oldestKey: string | null = null;
		let oldestTick = Number.POSITIVE_INFINITY;
		for (const [key, entry] of this.#entries) {
			if (key === protectKey || !this.#evictable(entry.proc) || this.#isPinned(key) !== pinned) continue;
			if (entry.tick < oldestTick) {
				oldestTick = entry.tick;
				oldestKey = key;
			}
		}
		return oldestKey;
	}

	async #evict(key: string, entry: PoolEntry<T>): Promise<void> {
		if (this.#entries.get(key) !== entry) return;
		this.#entries.delete(key);
		this.#onEvict?.(key, entry.proc);
		await entry.proc.stop();
	}

	#use(entry: PoolEntry<T>): void {
		entry.tick = ++this.#tick;
		entry.usedAt = this.#now();
	}

	#evictable(proc: T): boolean {
		return proc.settled && !proc.streaming && proc.pendingUi.size === 0 && proc.runningSubagents.size === 0;
	}
}
