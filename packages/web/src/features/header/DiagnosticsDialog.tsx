import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { Diagnostics } from "@omp-ui/protocol";
import { useAppStore } from "@/store/app-store";
import { getBridge } from "@/store/bridge-access";
import { Button } from "@/ui/Button";
import { Dialog, DialogContent } from "@/ui/Dialog";

export function DiagnosticsDialog({
	sessionId,
	open,
	onOpenChange,
}: {
	sessionId: string | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const connection = useAppStore(s => s.connection);
	const ompVersion = useAppStore(s => s.ompVersion);
	const protocolVersion = useAppStore(s => s.protocolVersion);
	const view = useAppStore(s => (sessionId ? s.views[sessionId] : undefined));

	const [diag, setDiag] = useState<Diagnostics | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const fetchDiag = useCallback(async () => {
		if (!sessionId) {
			setDiag(null);
			return;
		}
		setLoading(true);
		setError(null);
		try {
			const res = await getBridge().http.getDiagnostics(sessionId);
			setDiag(res);
		} catch (err) {
			setError(err instanceof Error ? err.message : "无法获取诊断信息");
		} finally {
			setLoading(false);
		}
	}, [sessionId]);

	useEffect(() => {
		if (open) {
			void fetchDiag();
		}
	}, [open, fetchDiag]);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				width={640}
				title="会话诊断"
				description="查看 Bridge 连接状态、协议版本、帧统计与进程 stderr 日志。"
				footer={
					<>
						{sessionId && (
							<Button
								variant="secondary"
								loading={loading}
								icon={<RefreshCw size={13} strokeWidth={2} />}
								onClick={() => void fetchDiag()}
							>
								刷新
							</Button>
						)}
						<Button variant="primary" onClick={() => onOpenChange(false)}>
							关闭
						</Button>
					</>
				}
			>
				<div className="mt-3 flex flex-col gap-3">
					<div className="grid grid-cols-3 gap-2 rounded-control bg-inset p-2.5 text-[12px] shadow-hairline">
						<div>
							<div className="text-[11px] text-ink-2">连接状态</div>
							<div className="mt-0.5 font-mono font-medium text-ink">{connection}</div>
						</div>
						<div>
							<div className="text-[11px] text-ink-2">omp / 协议版本</div>
							<div className="mt-0.5 font-mono font-medium text-ink">
								{ompVersion ?? "—"} (v{protocolVersion ?? "—"})
							</div>
						</div>
						<div>
							<div className="text-[11px] text-ink-2">进程状态</div>
							<div className="mt-0.5 font-mono font-medium text-ink">{view?.proc ?? "none"}</div>
						</div>
						<div>
							<div className="text-[11px] text-ink-2">已接收帧数</div>
							<div className="mt-0.5 font-mono font-medium text-ink tnum">
								{diag?.frameCount ?? view?.lastSeq ?? 0}
							</div>
						</div>
						<div>
							<div className="text-[11px] text-ink-2">丢弃帧数</div>
							<div className="mt-0.5 font-mono font-medium text-ink tnum">{diag?.droppedFrames ?? 0}</div>
						</div>
						<div>
							<div className="text-[11px] text-ink-2">解析错误</div>
							<div className="mt-0.5 font-mono font-medium text-ink tnum">
								{diag?.parseErrors.length ?? 0}
							</div>
						</div>
					</div>

					{error && <div className="text-[12px] text-red-ink">{error}</div>}

					{diag && diag.parseErrors.length > 0 && (
						<div>
							<div className="mb-1 text-[11px] font-medium text-ink-2">帧解析错误</div>
							<div className="max-h-28 overflow-auto rounded-control bg-inset p-2 font-mono text-[11px] text-red-ink shadow-hairline">
								{diag.parseErrors.map((pe, i) => (
									<div key={i} className="mb-1 last:mb-0">
										[{pe.at}] {pe.error}: {pe.line}
									</div>
								))}
							</div>
						</div>
					)}

					<div>
						<div className="mb-1 text-[11px] font-medium text-ink-2">stderr 尾部日志</div>
						<pre className="max-h-48 overflow-auto rounded-control bg-inset p-2.5 font-mono text-[11.5px] leading-[1.6] text-ink-2 shadow-hairline whitespace-pre-wrap">
							{diag?.stderrTail ||
								(view?.run.kind === "dead" ? view.run.stderrTail : "") ||
								"（无 stderr 输出）"}
						</pre>
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}
