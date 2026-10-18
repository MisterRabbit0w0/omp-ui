/** Window event fired after the UI changed a work tree through the bridge (e.g. a branch switch). */
export const GIT_CHANGED_EVENT = "omp-ui:git-changed";

export interface GitChangedDetail {
	/** Workspace directory the change was made in. */
	cwd: string;
}

export function notifyGitChanged(cwd: string): void {
	window.dispatchEvent(new CustomEvent<GitChangedDetail>(GIT_CHANGED_EVENT, { detail: { cwd } }));
}

/** Subscribe to work-tree changes; returns the unsubscribe function. */
export function onGitChanged(listener: (detail: GitChangedDetail) => void): () => void {
	const handler = (event: Event) => {
		const detail = (event as CustomEvent<GitChangedDetail>).detail;
		if (detail && typeof detail.cwd === "string") listener(detail);
	};
	window.addEventListener(GIT_CHANGED_EVENT, handler);
	return () => window.removeEventListener(GIT_CHANGED_EVENT, handler);
}
