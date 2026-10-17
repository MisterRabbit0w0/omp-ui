import { useEffect, useRef, useState } from "react";
import { BtwDrawer } from "@/features/btw";
import { SubagentDrawer } from "@/features/subagents";

export interface PanelOverlaysProps {
	sessionId: string | null;
}

let nextOwnerId = 1;
let currentOwnerId: number | null = null;
const ownerListeners = new Set<() => void>();

/**
 * Mounts the portal-backed `SubagentDrawer` and `BtwDrawer` so `open-subagent`
 * and `open-btw` events work even when `SidePanel` is collapsed or unmounted.
 * Deduplicates automatically if mounted in both `AppShell` and `SidePanel`.
 */
export function PanelOverlays({ sessionId }: PanelOverlaysProps) {
	const idRef = useRef<number>(0);
	if (idRef.current === 0) {
		idRef.current = nextOwnerId++;
	}
	const [isOwner, setIsOwner] = useState(() => {
		if (currentOwnerId === null) {
			currentOwnerId = idRef.current;
			return true;
		}
		return currentOwnerId === idRef.current;
	});

	useEffect(() => {
		const myId = idRef.current;
		const sync = () => {
			if (currentOwnerId === null) {
				currentOwnerId = myId;
			}
			setIsOwner(currentOwnerId === myId);
		};
		ownerListeners.add(sync);
		sync();

		return () => {
			ownerListeners.delete(sync);
			if (currentOwnerId === myId) {
				currentOwnerId = null;
				for (const notify of ownerListeners) {
					notify();
					break;
				}
			}
		};
	}, []);

	if (!isOwner) return null;

	return (
		<>
			<SubagentDrawer sessionId={sessionId} />
			<BtwDrawer sessionId={sessionId} />
		</>
	);
}
