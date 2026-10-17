/** Shared test helpers: temp dirs, ws client, async waits. */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { B2C, C2B } from "@omp-ui/protocol";

export const FAKE_OMP = path.join(import.meta.dir, "fake-omp.ts");
export const FAKE_OMP_COMMAND = [process.execPath, FAKE_OMP];

export function tempDir(prefix: string): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), `omp-ui-test-${prefix}-`));
}

export async function waitFor(predicate: () => boolean, timeoutMs = 10_000, intervalMs = 10): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (predicate()) return;
		await Bun.sleep(intervalMs);
	}
	throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}

/** Minimal WS test client speaking the C2B/B2C envelope. */
export class TestWs {
	readonly messages: B2C[] = [];
	#ws: WebSocket;
	#open: Promise<void>;
	#closed: Promise<number>;

	private constructor(ws: WebSocket, opened: Promise<void>, closed: Promise<number>) {
		this.#ws = ws;
		this.#open = opened;
		this.#closed = closed;
	}

	static connect(url: string): TestWs {
		let openResolve: () => void;
		let openReject: (error: Error) => void;
		let closeResolve: (code: number) => void;
		const opened = new Promise<void>((resolve, reject) => {
			openResolve = resolve;
			openReject = reject;
		});
		const closed = new Promise<number>(resolve => {
			closeResolve = resolve;
		});
		const ws = new WebSocket(url);
		const client = new TestWs(ws, opened, closed);
		ws.addEventListener("open", () => openResolve());
		ws.addEventListener("error", () => openReject(new Error("websocket error")));
		ws.addEventListener("close", event => closeResolve(event.code));
		ws.addEventListener("message", event => {
			if (typeof event.data === "string") client.messages.push(JSON.parse(event.data) as B2C);
		});
		return client;
	}

	async ready(): Promise<void> {
		await this.#open;
	}

	get closed(): Promise<number> {
		return this.#closed;
	}

	send(msg: C2B): void {
		this.#ws.send(JSON.stringify(msg));
	}

	hello(token: string): void {
		this.send({ t: "hello", token });
	}

	waitMessage<M extends B2C>(predicate: (msg: B2C) => msg is M, timeoutMs?: number): Promise<M>;
	waitMessage(predicate: (msg: B2C) => boolean, timeoutMs?: number): Promise<B2C>;
	async waitMessage(predicate: (msg: B2C) => boolean, timeoutMs = 10_000): Promise<B2C> {
		const deadline = Date.now() + timeoutMs;
		for (;;) {
			const found = this.messages.find(predicate);
			if (found) return found;
			if (Date.now() > deadline) throw new Error("waitMessage timed out");
			await Bun.sleep(10);
		}
	}

	frames(): Extract<B2C, { t: "frame" }>[] {
		return this.messages.filter((msg): msg is Extract<B2C, { t: "frame" }> => msg.t === "frame");
	}

	close(): void {
		this.#ws.close();
	}
}
