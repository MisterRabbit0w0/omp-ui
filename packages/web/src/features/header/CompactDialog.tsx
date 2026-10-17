import { Minimize2 } from "lucide-react";
import { useState } from "react";
import { useAppStore } from "@/store/app-store";
import { getBridge } from "@/store/bridge-access";
import { Button } from "@/ui/Button";
import { Dialog, DialogContent } from "@/ui/Dialog";
import { toast } from "@/ui/Toast";

export function CompactDialog({
	sessionId,
	open,
	onOpenChange,
}: {
	sessionId: string | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const [instructions, setInstructions] = useState("");
	const [busy, setBusy] = useState(false);

	const handleCompact = async () => {
		if (!sessionId || busy) return;
		setBusy(true);
		try {
			const view = useAppStore.getState().views[sessionId];
			if (view && (view.readonly || view.proc === "none")) {
				await useAppStore.getState().startSession(sessionId);
			}
			const customInstructions = instructions.trim() || undefined;
			await getBridge().rpc(sessionId, {
				type: "compact",
				...(customInstructions ? { customInstructions } : {}),
			});
			await useAppStore.getState().coldStart(sessionId);
			toast("上下文压缩完成", "success");
			setInstructions("");
			onOpenChange(false);
		} catch (err) {
			toast(err instanceof Error ? err.message : "压缩上下文失败", "error");
		} finally {
			setBusy(false);
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				title="压缩上下文"
				description="将历史对话压缩为精简摘要，释放上下文窗口空间。可填写自定义保留指令。"
				footer={
					<>
						<Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
							取消
						</Button>
						<Button
							variant="primary"
							loading={busy}
							icon={<Minimize2 size={13} strokeWidth={2} />}
							onClick={() => void handleCompact()}
						>
							开始压缩
						</Button>
					</>
				}
			>
				<div className="mt-3">
					<label className="mb-1 block text-[12px] font-medium text-ink-2">
						自定义压缩指令（可选）
					</label>
					<textarea
						rows={3}
						value={instructions}
						onChange={e => setInstructions(e.target.value)}
						placeholder="例如：保留最近修改的接口定义和待办事项…"
						aria-label="自定义压缩指令"
						className="w-full rounded-control bg-inset p-2.5 text-[12.5px] text-ink shadow-hairline outline-none placeholder:text-ink-3 focus:ring-1 focus:ring-line-strong"
					/>
				</div>
			</DialogContent>
		</Dialog>
	);
}
