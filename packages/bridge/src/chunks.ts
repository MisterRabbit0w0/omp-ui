/**
 * Protocol v2 `rpc_chunk` reassembly (docs/DESIGN.md §3.2.3).
 *
 * omp emits chunks strictly in order, but the reassembler tolerates
 * out-of-order arrival so a future transport does not break it. Incomplete
 * sequences are dropped after a timeout; every drop is reported.
 */

export interface RpcChunkFrame {
	type: "rpc_chunk";
	chunkId: string;
	index: number;
	count: number;
	byteLength: number;
	/** base64 payload slice of the serialized JSON frame */
	data: string;
}

export interface ChunkReassemblerOptions {
	/** Hard ceiling for one reassembled frame (from `ready.maxReassembledFrameBytes`). */
	maxReassembledFrameBytes: number;
	/** Drop an incomplete sequence after this long. */
	chunkTimeoutMs?: number;
	/** Called when a sequence is dropped; the frame is lost. */
	onDrop?: (reason: string, chunkId: string) => void;
	/** Test seam: timer injection. */
	schedule?: (fn: () => void, ms: number) => unknown;
	unschedule?: (handle: unknown) => void;
}

interface PendingChunks {
	count: number;
	byteLength: number;
	parts: (Buffer | null)[];
	receivedCount: number;
	receivedBytes: number;
	timer: unknown;
}

const DEFAULT_CHUNK_TIMEOUT_MS = 30_000;
const CHUNK_ID_MAX_LENGTH = 128;

export function isRpcChunkFrame(value: unknown): value is RpcChunkFrame {
	if (typeof value !== "object" || value === null) return false;
	const v = value as Record<string, unknown>;
	return v.type === "rpc_chunk";
}

export class ChunkReassembler {
	readonly #maxBytes: number;
	readonly #timeoutMs: number;
	readonly #onDrop?: (reason: string, chunkId: string) => void;
	readonly #schedule: (fn: () => void, ms: number) => unknown;
	readonly #unschedule: (handle: unknown) => void;
	readonly #pending = new Map<string, PendingChunks>();

	constructor(options: ChunkReassemblerOptions) {
		this.#maxBytes = options.maxReassembledFrameBytes;
		this.#timeoutMs = options.chunkTimeoutMs ?? DEFAULT_CHUNK_TIMEOUT_MS;
		this.#onDrop = options.onDrop;
		this.#schedule =
			options.schedule ??
			((fn, ms) => {
				const timer = setTimeout(fn, ms);
				timer.unref?.();
				return timer;
			});
		this.#unschedule = options.unschedule ?? (handle => clearTimeout(handle as Parameters<typeof clearTimeout>[0]));
	}

	get pendingCount(): number {
		return this.#pending.size;
	}

	/**
	 * Feed one parsed `rpc_chunk` frame. Returns the reassembled, parsed frame
	 * once the sequence completes, otherwise null. Invalid or oversized
	 * sequences are dropped (and reported) instead of throwing.
	 */
	push(chunk: RpcChunkFrame): unknown | null {
		const { chunkId, index, count, byteLength } = chunk;
		if (
			typeof chunkId !== "string" ||
			chunkId.length === 0 ||
			chunkId.length > CHUNK_ID_MAX_LENGTH ||
			!Number.isSafeInteger(index) ||
			!Number.isSafeInteger(count) ||
			!Number.isSafeInteger(byteLength) ||
			index < 0 ||
			count < 2 ||
			index >= count
		) {
			this.#drop(chunkId ?? "?", "invalid chunk metadata");
			return null;
		}
		if (byteLength > this.#maxBytes) {
			this.#drop(chunkId, `declared byteLength ${byteLength} exceeds limit ${this.#maxBytes}`);
			return null;
		}
		const bytes = Buffer.from(chunk.data, "base64");
		if (bytes.byteLength > byteLength) {
			this.#drop(chunkId, "chunk payload exceeds declared byteLength");
			return null;
		}

		let pending = this.#pending.get(chunkId);
		if (pending && (pending.count !== count || pending.byteLength !== byteLength)) {
			this.#drop(chunkId, "chunk metadata changed mid-sequence");
			pending = undefined;
		}
		if (!pending) {
			if (this.#pending.size >= 8) {
				// Bound memory: concurrent sequences are not expected from omp.
				this.#drop(chunkId, "too many concurrent chunk sequences");
				return null;
			}
			const timer = this.#schedule(() => this.#drop(chunkId, "chunk sequence timed out"), this.#timeoutMs);
			pending = {
				count,
				byteLength,
				parts: new Array<Buffer | null>(count).fill(null),
				receivedCount: 0,
				receivedBytes: 0,
				timer,
			};
			this.#pending.set(chunkId, pending);
		}
		if (pending.parts[index] !== null) {
			this.#drop(chunkId, `duplicate chunk index ${index}`);
			return null;
		}
		pending.parts[index] = bytes;
		pending.receivedCount++;
		pending.receivedBytes += bytes.byteLength;
		if (pending.receivedBytes > pending.byteLength) {
			this.#drop(chunkId, "reassembled bytes exceed declared byteLength");
			return null;
		}
		if (pending.receivedCount < pending.count) return null;

		this.#unschedule(pending.timer);
		this.#pending.delete(chunkId);
		if (pending.receivedBytes !== pending.byteLength) {
			this.#onDrop?.(
				`byteLength mismatch: declared ${pending.byteLength}, received ${pending.receivedBytes}`,
				chunkId,
			);
			return null;
		}
		const text = Buffer.concat(pending.parts as Buffer[]).toString("utf8");
		try {
			return JSON.parse(text);
		} catch (error) {
			this.#onDrop?.(`reassembled frame is not valid JSON: ${(error as Error).message}`, chunkId);
			return null;
		}
	}

	/** Drop all incomplete sequences (process exit). */
	reset(): void {
		for (const pending of this.#pending.values()) this.#unschedule(pending.timer);
		this.#pending.clear();
	}

	#drop(chunkId: string, reason: string): void {
		const pending = this.#pending.get(chunkId);
		if (pending) {
			this.#unschedule(pending.timer);
			this.#pending.delete(chunkId);
		}
		this.#onDrop?.(reason, chunkId);
	}
}
