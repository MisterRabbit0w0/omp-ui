import { useEffect, useRef, useState } from "react";
import { useConnection } from "@/store/hooks";
import { nextConnectionBannerState, type ConnectionBannerState } from "./shell-state";

/**
 * FRONTEND §6.17 connection bar:
 * When WS disconnects, a 2px orange bar appears at the top of the conversation
 * area with a centered "重新连接中…" pill (bg-surface, shadow-raised).
 * Upon recovery, the bar turns green and fades out after 600ms.
 */
export function ConnectionBar({ stateOverride }: { stateOverride?: ConnectionBannerState }) {
	const connection = useConnection();
	const prevRef = useRef(connection);
	const everConnectedRef = useRef(connection === "connected");
	const [bannerState, setBannerState] = useState<ConnectionBannerState>("hidden");
	const [fading, setFading] = useState(false);

	useEffect(() => {
		if (connection === "connected") {
			everConnectedRef.current = true;
		}
		const prev = prevRef.current;
		prevRef.current = connection;
		const next = nextConnectionBannerState(prev, connection, everConnectedRef.current);
		if (next === "reconnecting") {
			setFading(false);
			setBannerState("reconnecting");
			return;
		}
		if (next === "recovered") {
			setFading(false);
			setBannerState("recovered");
			const fadeTimer = setTimeout(() => setFading(true), 600);
			const hideTimer = setTimeout(() => {
				setBannerState("hidden");
				setFading(false);
			}, 800);
			return () => {
				clearTimeout(fadeTimer);
				clearTimeout(hideTimer);
			};
		}
	}, [connection]);

	const active = stateOverride ?? bannerState;
	if (active === "hidden") return null;

	return (
		<div
			className={
				"pointer-events-none absolute inset-x-0 top-0 z-30 flex flex-col items-center transition-opacity duration-200 " +
				(fading ? "opacity-0" : "opacity-100")
			}
			role="status"
			aria-live="polite"
		>
			<div
				className={
					"h-0.5 w-full transition-colors duration-200 " +
					(active === "recovered" ? "bg-green" : "bg-orange")
				}
			/>
			{active === "reconnecting" && (
				<div className="mt-1.5 inline-flex items-center gap-1.5 rounded-pill bg-surface px-2.5 py-0.5 text-[11.5px] text-ink-2 shadow-raised">
					<span className="size-1.5 rounded-full bg-orange animate-[pulse-dot_1.6s_infinite]" aria-hidden="true" />
					<span>重新连接中…</span>
				</div>
			)}
		</div>
	);
}
