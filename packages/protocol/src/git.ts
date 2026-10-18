/** Git working-tree changes for the 变更 panel (read-only; not part of the omp wire protocol). */

export type GitChangeScope = "unstaged" | "staged";

export interface GitChangedFile {
	/** Path relative to the repository root (forward slashes). */
	path: string;
	/** One of M/A/D/R/C or "?" for untracked. */
	status: string;
	additions: number;
	deletions: number;
	/** Unified diff for this file; empty for binary files. */
	diff: string;
	binary?: boolean;
}

export interface GitChangesResult {
	repo: boolean;
	root?: string;
	scope: GitChangeScope;
	files: GitChangedFile[];
	/** Output was capped (very large diff / file count). */
	truncated?: boolean;
}
