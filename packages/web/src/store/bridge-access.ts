import { BridgeHttp } from "../lib/http";
import { BridgeClient, resolveBridgeToken } from "../lib/ws";
import { useAppStore } from "./app-store";
import type { SessionView } from "./session-reducer";

let activeClient: BridgeClient | null = null;
let activeHttp: BridgeHttp | null = null;

const origConnect = BridgeClient.prototype.connect;
BridgeClient.prototype.connect = function (this: BridgeClient) {
	activeClient = this;
	return origConnect.call(this);
};

export function updateSessionView(sessionId: string, fn: (view: SessionView) => SessionView): void {
	useAppStore.setState(s => {
		const view = s.views[sessionId];
		if (!view) return s;
		return { views: { ...s.views, [sessionId]: fn(view) } };
	});
}

export async function reopenSession(sessionId: string, opts?: { restore?: boolean }): Promise<void> {
	const state = useAppStore.getState();
	if (opts?.restore !== undefined) {
		updateSessionView(sessionId, v => ({ ...v, proc: opts.restore ? "crashed" : "exited" }));
	}
	await state.startSession(sessionId);
}

export interface BridgeAccess {
	client: BridgeClient;
	http: BridgeHttp;
	rpc: BridgeClient["rpc"];
	send: BridgeClient["send"];
	start: BridgeClient["start"];
	attach: BridgeClient["attach"];
	detach: BridgeClient["detach"];
	updateView: typeof updateSessionView;
	reopenSession: typeof reopenSession;
}

export function setBridge(deps: { client?: BridgeClient | null; http?: BridgeHttp | null }): void {
	if (deps.client !== undefined) activeClient = deps.client;
	if (deps.http !== undefined) activeHttp = deps.http;
}

export function getBridgeClient(): BridgeClient {
	if (!activeClient) {
		activeClient = new BridgeClient({
			token: resolveBridgeToken(),
			autoConnect: false,
			onConnection: connection => useAppStore.setState({ connection }),
			onMessage: msg => useAppStore.getState().dispatch(msg),
		});
	}
	return activeClient;
}

export function getBridgeHttp(): BridgeHttp {
	if (!activeHttp) {
		activeHttp = new BridgeHttp({ token: () => resolveBridgeToken() });
	}
	return activeHttp;
}

export function getBridge(): BridgeAccess {
	const client = getBridgeClient();
	const http = getBridgeHttp();
	return {
		client,
		http,
		rpc: client.rpc.bind(client),
		send: client.send.bind(client),
		start: client.start.bind(client),
		attach: client.attach.bind(client),
		detach: client.detach.bind(client),
		updateView: updateSessionView,
		reopenSession,
	};
}
