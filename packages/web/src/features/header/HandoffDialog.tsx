import { ArrowRightLeft } from "lucide-react";
import { useState } from "react";
import { useAppStore } from "@/store/app-store";
import { getBridge } from "@/store/bridge-access";
import { Button } from "@/ui/Button";
import { Dialog, DialogContent } from "@/ui/Dialog";
import { toast } from "@/ui/Toast";

export function HandoffDialog({
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

	const handleHandoff = async () => {
		if (!sessionId || busy) return;
		setBusy(true);
		try {
			const view = useAppStore.getState().views[sessionId];
			if (view && (view.readonly || view.proc === "none")) {
				await useAppStore.getState().startSession(sessionId);
			}
			const customInstructions = instructions.trim() || undefined;
			await getBridge().rpc(sessionId, {
				type: "handoff",
				...(customInstructions ? { customInstructions } : {}),
			});
			const targetSessionId = useAppStore.getState().currentSessionId ?? sessionId;
			await useAppStore.getState().coldStart(targetSessionId);
			await useAppStore.getState().loadSessions();
			toast("已生成交接上下文", "success");
			setInstructions("");
			onOpenChange(false);
		} catch (err) {
			toast(err instanceof Error ? err.message : "交接失败", "error");
		} finally {
			setBusy(false);
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				title="交接到新会话"
				description="提炼当前会话的进展与上下文并交接到新会话。"
				footer={
					<>
						<Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
							取消
						</Button>
						<Button
							variant="primary"
							loading={busy}
							icon={<ArrowRightLeft size={13} strokeWidth={2} />}
							onClick={() => void handleHandoff()}
						>
							确认交接
						</Button>
					</>
				}
			>
				<div className="mt-3">
					<label className="mb-1 block text-[12px] font-medium text-ink-2">
						交接说明（可选）
					</label>
					<textarea
						rows={3}
						value={instructions}
						onChange={e => setInstructions(e.target.value)}
						placeholder="例如：接下来专注于前端联调与测试…"
						aria-label="交接说明"
						className="w-full rounded-control bg-inset p-2.5 text-[12.5px] text-ink shadow-hairline outline-none placeholder:text-ink-3 focus:ring-1 focus:ring-line-strong"
					/>
				</div>
			</DialogContent>
		</Dialog>
	);
}
