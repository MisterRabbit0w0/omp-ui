import { useState } from "react";
import type { SessionListItem } from "@omp-ui/protocol";
import { Button } from "@/ui/Button";
import { Dialog, DialogContent } from "@/ui/Dialog";

export function DeleteSessionDialog({
	session,
	open,
	onOpenChange,
	onConfirm,
}: {
	session: SessionListItem | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onConfirm: (session: SessionListItem) => Promise<void> | void;
}) {
	const [busy, setBusy] = useState(false);

	const handleConfirm = async () => {
		if (!session || busy) return;
		setBusy(true);
		try {
			await onConfirm(session);
			onOpenChange(false);
		} finally {
			setBusy(false);
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				title="删除这个会话？"
				description="会移到回收目录，30 天后清除。"
				footer={
					<>
						<Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
							取消
						</Button>
						<Button variant="danger" loading={busy} onClick={() => void handleConfirm()}>
							删除
						</Button>
					</>
				}
			>
				{session && (
					<div className="mt-2.5 rounded-control bg-inset px-2.5 py-2 font-mono text-[11.5px] leading-[1.6] text-ink-2 shadow-hairline break-all">
						{session.file}
					</div>
				)}
			</DialogContent>
		</Dialog>
	);
}
