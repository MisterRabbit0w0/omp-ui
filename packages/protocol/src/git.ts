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

/** Local branches of the workspace repo, for the composer's branch picker. */
export interface GitBranchesResult {
	repo: boolean;
	root?: string;
	/** Checked-out branch; null when HEAD is detached. */
	current: string | null;
	/** Short commit id when HEAD is detached. */
	detachedAt?: string;
	/** Local branch names, most recently committed first. */
	branches: string[];
}
