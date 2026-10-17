import { ChevronDown, GitBranch } from "lucide-react";
import { useEffect, useState } from "react";
import { useAppStore } from "@/store/app-store";
import { getBridge } from "@/store/bridge-access";
import { Button } from "@/ui/Button";
import { Pill } from "@/ui/Chip";
import { Dialog, DialogContent } from "@/ui/Dialog";
import { toast } from "@/ui/Toast";
import { buildSessionTree, type TreeNodeView } from "./header-utils";

function TreeBranchNode({
	node,
	selectedId,
	onSelect,
}: {
	node: TreeNodeView;
	selectedId: string | null;
	onSelect: (node: TreeNodeView) => void;
}) {
	const [expanded, setExpanded] = useState(true);
	const hasChildren = node.children.length > 0;
	const isSelected = selectedId === node.id;

	return (
		<div>
			<div
				className={
					"flex h-7 items-center gap-1.5 rounded-[6px] px-2 text-[12px] transition-colors " +
					(isSelected
						? "bg-accent-tint text-accent-on-tint font-medium"
						: node.isLeaf
							? "bg-field text-ink font-medium"
							: "text-ink-2 hover:bg-hover-2 hover:text-ink")
				}
			>
				{hasChildren ? (
					<button
						type="button"
						aria-label={expanded ? "折叠节点" : "展开节点"}
						onClick={e => {
							e.stopPropagation();
							setExpanded(v => !v);
						}}
						className="grid size-4 shrink-0 place-items-center rounded-[4px] text-ink-3 hover:text-ink"
					>
						<ChevronDown
							size={12}
							strokeWidth={2.2}
							className={"i transition-transform duration-150 " + (expanded ? "" : "-rotate-90")}
						/>
					</button>
				) : (
					<span className="w-4 shrink-0" />
				)}
				<button
					type="button"
					onClick={() => onSelect(node)}
					className="flex min-w-0 flex-1 items-center gap-2 text-left"
				>
					<span
						className={
							"size-1.5 shrink-0 rounded-full " +
							(node.isLeaf ? "bg-accent" : node.onActiveBranch ? "bg-ink-2" : "bg-line-strong")
						}
					/>
					<span className="shrink-0 font-mono text-[11px] text-ink-2">{node.role}</span>
					<span className="min-w-0 flex-1 truncate">{node.preview}</span>
					{node.isLeaf && (
						<Pill tone="accent" className="h-[18px] px-1.5 text-[10.5px]">
							当前叶节点
						</Pill>
					)}
				</button>
			</div>
			{hasChildren && (
				<div className={"grid-collapse " + (expanded ? "open" : "")}>
					<div className="ml-3 border-l border-line pl-2">
						{node.children.map(child => (
							<TreeBranchNode
								key={child.id}
								node={child}
								selectedId={selectedId}
								onSelect={onSelect}
							/>
						))}
					</div>
				</div>
			)}
		</div>
	);
}

export function SessionTreeDialog({
	sessionId,
	open,
	onOpenChange,
}: {
	sessionId: string | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const [roots, setRoots] = useState<TreeNodeView[]>([]);
	const [leafId, setLeafId] = useState<string | null>(null);
	const [selected, setSelected] = useState<TreeNodeView | null>(null);
	const [loading, setLoading] = useState(false);
	const [branching, setBranching] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!open || !sessionId) return;
		let cancelled = false;
		setLoading(true);
		setError(null);
		setSelected(null);

		void (async () => {
			try {
				const view = useAppStore.getState().views[sessionId];
				if (view && (view.readonly || view.proc === "none")) {
					await useAppStore.getState().startSession(sessionId);
				}
				const res = await getBridge().rpc(sessionId, { type: "get_tree" });
				if (cancelled) return;
				setLeafId(res.leafId);
				setRoots(buildSessionTree(res.tree, res.leafId));
			} catch (err) {
				if (cancelled) return;
				setError(err instanceof Error ? err.message : "无法读取会话树");
			} finally {
				if (!cancelled) setLoading(false);
			}
		})();

		return () => {
			cancelled = true;
		};
	}, [open, sessionId]);

	const handleBranchConfirm = async () => {
		if (!sessionId || !selected || branching) return;
		setBranching(true);
		try {
			const res = await getBridge().rpc(sessionId, { type: "branch", entryId: selected.id });
			if (!res.cancelled) {
				if (res.text) {
					useAppStore.setState({ composerInsert: { sessionId, text: res.text, at: Date.now() } });
				}
				await useAppStore.getState().coldStart(sessionId);
				toast("已切换到选定分支节点", "success");
				onOpenChange(false);
			}
		} catch (err) {
			toast(err instanceof Error ? err.message : "切换分支失败", "error");
		} finally {
			setBranching(false);
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				width={640}
				title="会话树"
				description="查看当前会话的分支历史，选择任意节点即可从该处建立新分支。"
				footer={
					<>
						<Button variant="secondary" onClick={() => onOpenChange(false)} disabled={branching}>
							关闭
						</Button>
						<Button
							variant="primary"
							disabled={!selected || selected.id === leafId}
							loading={branching}
							icon={<GitBranch size={13} strokeWidth={2} />}
							onClick={() => void handleBranchConfirm()}
						>
							在此节点创建分支
						</Button>
					</>
				}
			>
				<div className="mt-3 max-h-[380px] overflow-auto rounded-control bg-inset p-2 shadow-hairline">
					{loading && <div className="py-8 text-center text-[12px] text-ink-2">正在加载会话树…</div>}
					{!loading && error && <div className="py-8 text-center text-[12px] text-red-ink">{error}</div>}
					{!loading && !error && roots.length === 0 && (
						<div className="py-8 text-center text-[12px] text-ink-2">当前会话暂无树节点记录</div>
					)}
					{!loading &&
						!error &&
						roots.map(node => (
							<TreeBranchNode
								key={node.id}
								node={node}
								selectedId={selected?.id ?? null}
								onSelect={setSelected}
							/>
						))}
				</div>
				{selected && (
					<div className="mt-2 flex items-center justify-between rounded-control bg-field px-2.5 py-1.5 text-[11.5px] text-ink-2">
						<span className="truncate">
							已选择节点 <code className="font-mono text-ink">{selected.id}</code>：{selected.preview}
						</span>
						{selected.id === leafId && <span className="shrink-0 text-ink-3">已在当前叶节点</span>}
					</div>
				)}
			</DialogContent>
		</Dialog>
	);
}
