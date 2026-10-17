import { describe, expect, test } from "bun:test";
import { ChunkReassembler, isRpcChunkFrame, type RpcChunkFrame } from "../src/chunks";

const MAX = 64 * 1024;

function chunkify(frame: unknown, parts: number, overrides?: Partial<RpcChunkFrame>): RpcChunkFrame[] {
	const bytes = Buffer.from(JSON.stringify(frame), "utf8");
	const size = Math.ceil(bytes.byteLength / parts);
	const chunks: RpcChunkFrame[] = [];
	for (let index = 0; index < parts; index++) {
		chunks.push({
			type: "rpc_chunk",
			chunkId: "c1",
			index,
			count: parts,
			byteLength: bytes.byteLength,
			data: bytes.subarray(index * size, (index + 1) * size).toString("base64"),
			...overrides,
		});
	}
	return chunks;
}

describe("ChunkReassembler", () => {
	test("reassembles an in-order sequence", () => {
		const r = new ChunkReassembler({ maxReassembledFrameBytes: MAX });
		const frame = { type: "message_end", message: { text: "hello".repeat(100) } };
		const chunks = chunkify(frame, 4);
		for (const chunk of chunks.slice(0, -1)) expect(r.push(chunk)).toBeNull();
		expect(r.push(chunks[3]!)).toEqual(frame);
		expect(r.pendingCount).toBe(0);
	});

	test("reassembles out-of-order chunks", () => {
		const r = new ChunkReassembler({ maxReassembledFrameBytes: MAX });
		const frame = { type: "notice", level: "info", message: "oob".repeat(50) };
		const chunks = chunkify(frame, 3);
		expect(r.push(chunks[2]!)).toBeNull();
		expect(r.push(chunks[0]!)).toBeNull();
		expect(r.push(chunks[1]!)).toEqual(frame);
	});

	test("drops an incomplete sequence when its timer fires", () => {
		const drops: string[] = [];
		// Manual scheduler: the test fires the timer itself, no wall clock.
		let pendingTimer: (() => void) | null = null;
		const r = new ChunkReassembler({
			maxReassembledFrameBytes: MAX,
			chunkTimeoutMs: 40,
			onDrop: reason => drops.push(reason),
			schedule: fn => {
				pendingTimer = fn;
				return null;
			},
			unschedule: () => undefined,
		});
		const chunks = chunkify({ type: "x", pad: "y".repeat(500) }, 3);
		expect(r.push(chunks[0]!)).toBeNull();
		expect(r.pendingCount).toBe(1);
		expect(pendingTimer).not.toBeNull();
		pendingTimer!();
		expect(r.pendingCount).toBe(0);
		expect(drops.some(reason => reason.includes("timed out"))).toBe(true);
	});

	test("drops on byteLength mismatch once complete", () => {
		const drops: string[] = [];
		const r = new ChunkReassembler({ maxReassembledFrameBytes: MAX, onDrop: reason => drops.push(reason) });
		// declared byteLength is larger than the actual payload sum
		const chunks = chunkify({ type: "x", pad: "z".repeat(500) }, 2, { byteLength: 10_000 });
		expect(r.push(chunks[0]!)).toBeNull();
		expect(r.push(chunks[1]!)).toBeNull();
		expect(drops.some(reason => reason.includes("byteLength mismatch"))).toBe(true);
		expect(r.pendingCount).toBe(0);
	});

	test("drops a sequence whose declared size exceeds the limit", () => {
		const drops: string[] = [];
		const r = new ChunkReassembler({ maxReassembledFrameBytes: 1024, onDrop: reason => drops.push(reason) });
		const chunks = chunkify({ type: "x" }, 2, { byteLength: 4096 });
		expect(r.push(chunks[0]!)).toBeNull();
		expect(drops.some(reason => reason.includes("exceeds limit"))).toBe(true);
		expect(r.pendingCount).toBe(0);
	});

	test("drops on duplicate chunk index", () => {
		const drops: string[] = [];
		const r = new ChunkReassembler({ maxReassembledFrameBytes: MAX, onDrop: reason => drops.push(reason) });
		const chunks = chunkify({ type: "x", pad: "q".repeat(500) }, 2);
		expect(r.push(chunks[0]!)).toBeNull();
		expect(r.push(chunks[0]!)).toBeNull();
		expect(drops.some(reason => reason.includes("duplicate"))).toBe(true);
	});

	test("rejects reassembled payloads that are not valid JSON", () => {
		const drops: string[] = [];
		const r = new ChunkReassembler({ maxReassembledFrameBytes: MAX, onDrop: reason => drops.push(reason) });
		const raw = Buffer.from("this is not json, padded out a bit", "utf8");
		const chunk0: RpcChunkFrame = {
			type: "rpc_chunk",
			chunkId: "c9",
			index: 0,
			count: 2,
			byteLength: raw.byteLength,
			data: raw.subarray(0, 10).toString("base64"),
		};
		const chunk1: RpcChunkFrame = { ...chunk0, index: 1, data: raw.subarray(10).toString("base64") };
		expect(r.push(chunk0)).toBeNull();
		expect(r.push(chunk1)).toBeNull();
		expect(drops.some(reason => reason.includes("not valid JSON"))).toBe(true);
	});

	test("isRpcChunkFrame narrows", () => {
		expect(isRpcChunkFrame({ type: "rpc_chunk" })).toBe(true);
		expect(isRpcChunkFrame({ type: "response" })).toBe(false);
		expect(isRpcChunkFrame(null)).toBe(false);
	});
});
