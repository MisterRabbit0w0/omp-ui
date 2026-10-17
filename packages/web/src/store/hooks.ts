/**
 * Convenience selectors over the app store for React components.
 */
import { useAppStore } from "./app-store";
import type { ConnectionState } from "../lib/ws";
import type { SessionView } from "./session-reducer";

export function useSessionView(sessionId: string | null): SessionView | undefined {
	return useAppStore(s => (sessionId === null ? undefined : s.views[sessionId]));
}

export function useCurrentView(): SessionView | undefined {
	return useAppStore(s => (s.currentSessionId === null ? undefined : s.views[s.currentSessionId]));
}

export function useConnection(): ConnectionState {
	return useAppStore(s => s.connection);
}
