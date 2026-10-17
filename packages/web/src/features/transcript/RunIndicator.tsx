/**
 * RunIndicator (FRONTEND §6.11) and in-transcript Banners (FRONTEND §6.17, DESIGN §11).
 */
import { ChevronDown, RotateCcw, Terminal, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useAppStore } from "../../store/app-store";
import { getBridge, reopenSession } from "../../store/bridge-access";
import type { Banner as BannerState, SessionView, ToolExec } from "../../store/session-reducer";
import { Banner } from "../../ui/Banner";
import { Button } from "../../ui/Button";
import { Collapsible } from "../../ui/Collapsible";
import { PixelGrid } from "../../ui/PixelGrid";
import { ShimmerText } from "../../ui/ShimmerText";

export interface RunIndicatorProps {
	view: SessionView;
}

function formatElapsedTenths(tenths: number): string {
	const sec = tenths / 10;
	if (sec < 60) {
		return `${sec.toFixed(1)}s`;
	}
	const mins = Math.floor(sec / 60);
	const rem = (sec % 60).toFixed(1).padStart(4, "0");
	return `${mins}m ${rem}s`;
}
function isPlainRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
function describeRunningTool(exec: ToolExec): string {
	const args: Record<string, unknown> = isPlainRecord(exec.args) ? exec.args : {};
	const rawPath = args.path ?? args.file ?? args.filePath;
	const shortFile = typeof rawPath === "string" ? (rawPath.split(/[/\\]/).pop() ?? rawPath) : "";
	switch (exec.toolName) {
		case "bash":
			return "运行 bash";
		case "edit":
		case "notebook":
			return shortFile ? `编辑 ${shortFile}` : "编辑文件";
		case "write":
			return shortFile ? `新建 ${shortFile}` : "写入文件";
		case "read":
			return shortFile ? `读取 ${shortFile}` : "读取文件";
		case "grep":
		case "glob":
		case "find":
			return "搜索代码";
		default:
			return `运行 ${exec.toolName}`;
	}
}

export function RunIndicator({ view }: RunIndicatorProps) {
	const [now, setNow] = useState(() => Date.now());
	// Runs already in progress when the page loaded never saw `agent_start`; count from first sight.
	const [seenAt, setSeenAt] = useState<number | null>(null);

	const hasPendingInteractiveUi = view.pendingUi.some(
		r =>
			r.method === "select" ||
			r.method === "ask" ||
			r.method === "confirm" ||
			r.method === "input" ||
			r.method === "editor",
	);

	let runningSubagentsCount = 0;
	for (const sub of view.subagents.values()) {
		if (sub.status === "running") runningSubagentsCount++;
	}

	let latestRunningTool: ToolExec | undefined;
	for (const exec of view.toolExec.values()) {
		if (exec.status === "running") {
			if (!latestRunningTool || exec.startedAt >= latestRunningTool.startedAt) {
				latestRunningTool = exec;
			}
		}
	}

	const isRetrying = view.run.kind === "retrying";
	const isCompacting = view.run.kind === "compacting" || Boolean(view.state?.isCompacting);
	const isActive =
		hasPendingInteractiveUi ||
		isRetrying ||
		isCompacting ||
		runningSubagentsCount > 0 ||
		latestRunningTool !== undefined ||
		view.run.kind === "running" ||
		view.run.kind === "settling" ||
		view.drafts.size > 0;

	useEffect(() => {
		if (!isActive) {
			setSeenAt(null);
			return;
		}
		const t = Date.now();
		setNow(t);
		setSeenAt(prev => prev ?? t);
		const interval = setInterval(() => setNow(Date.now()), 100);
		return () => clearInterval(interval);
	}, [isActive]);
	const startedAt = view.runStartedAt ?? seenAt ?? now;
	const tenths = Math.max(0, Math.floor((now - startedAt) / 100));

	if (!isActive) return null;

	// Determine state per FRONTEND §6.11 state table
	let gridMode: "drive" | "orbit" | "dots" = "drive";
	let gridStatic = false;
	let labelText = "思考中";
	let orangeLabel = false;
	let shimmer = true;

	if (hasPendingInteractiveUi) {
		gridStatic = true;
		labelText = "等待你的回应";
		orangeLabel = true;
		shimmer = false;
	} else if (view.run.kind === "retrying") {
		gridStatic = true;
		const remSec = Math.max(1, Math.ceil(view.run.delayMs / 1000));
		labelText = `重试 ${view.run.attempt}/${view.run.maxAttempts} · ${remSec}s`;
		orangeLabel = true;
		shimmer = false;
	} else if (isCompacting) {
		gridMode = "dots";
		labelText = "压缩上下文";
	} else if (runningSubagentsCount > 0) {
		gridMode = "orbit";
		labelText = `${runningSubagentsCount} 个子代理在工作`;
	} else if (latestRunningTool) {
		gridMode = "drive";
		labelText = describeRunningTool(latestRunningTool);
	}

	return (
		// Fixed height + fixed-width timer: label/state changes and the ticking clock never shift the tail.
		<div data-testid="run-indicator" className="mt-3 flex h-6 items-center gap-2.5">
			<PixelGrid mode={gridMode} static={gridStatic} />
			{shimmer ? (
				<ShimmerText active className="text-[13px] font-medium">
					{labelText}
				</ShimmerText>
			) : (
				<span
					className={
						"text-[13px] font-medium " + (orangeLabel ? "text-orange-ink" : "text-ink-2")
					}
				>
					{labelText}
				</span>
			)}
			<span className="mono inline-block min-w-[5ch] text-[12px] text-ink-2 tabular-nums">
				{formatElapsedTenths(tenths)}
			</span>
		</div>
	);
}

// ── In-Transcript Banners (§6.17, DESIGN §11) ────────────────────────

function RetryBannerItem({
	sessionId,
	banner,
}: {
	sessionId: string;
	banner: Extract<BannerState, { kind: "retry" }>;
}) {
	const [remainingSec, setRemainingSec] = useState(() =>
		Math.max(0, Math.ceil((banner.startedAt + banner.delayMs - Date.now()) / 1000)),
	);

	useEffect(() => {
		const timer = setInterval(() => {
			const next = Math.max(0, Math.ceil((banner.startedAt + banner.delayMs - Date.now()) / 1000));
			setRemainingSec(next);
		}, 1000);
		return () => clearInterval(timer);
	}, [banner.startedAt, banner.delayMs]);

	const handleAbortRetry = () => {
		void getBridge()
			.rpc(sessionId, { type: "abort_retry" })
			.catch(() => undefined);
	};

	return (
		<Banner
			variant="retry"
			icon={<RotateCcw size={14} strokeWidth={2} className="i" />}
			title={`重试 ${banner.attempt}/${banner.maxAttempts}`}
			action={
				<Button variant="ghost" size="sm" onClick={handleAbortRetry}>
					取消重试
				</Button>
			}
		>
			<span>{banner.errorMessage}，</span>
			<span key={remainingSec} className="mono anim-pop-in inline-block tabular-nums">
				{remainingSec}s
			</span>
			<span> 后重试</span>
		</Banner>
	);
}

function ProcExitBannerItem({
	sessionId,
	banner,
}: {
	sessionId: string;
	banner: Extract<BannerState, { kind: "proc-exit" }>;
}) {
	const [showStderr, setShowStderr] = useState(false);
	const [busy, setBusy] = useState(false);

	const handleRestore = async (restore: boolean) => {
		if (busy) return;
		setBusy(true);
		try {
			await reopenSession(sessionId, { restore });
		} finally {
			setBusy(false);
		}
	};

	const titleText =
		banner.code !== undefined
			? `会话进程已退出（代码 ${banner.code}）`
			: banner.crashed
				? "会话进程异常退出"
				: "会话进程已退出";

	return (
		<div className="flex flex-col gap-2 rounded-card bg-field px-3 py-2.5 shadow-hairline text-[13px]">
			<div className="flex items-center gap-2.5">
				<Terminal size={14} strokeWidth={2} className="i shrink-0 text-ink-2" />
				<span className="min-w-0 flex-1 font-medium text-ink">{titleText}</span>
				{banner.stderrTail && (
					<button
						type="button"
						onClick={() => setShowStderr(s => !s)}
						className="inline-flex items-center gap-1 rounded-control px-2 py-0.5 text-[11.5px] text-ink-2 hover:bg-hover-2 hover:text-ink"
					>
						<span>stderr</span>
						<ChevronDown
							size={12}
							className={"i transition-transform " + (showStderr ? "rotate-180" : "")}
						/>
					</button>
				)}
				<Button
					variant="secondary"
					size="sm"
					disabled={busy}
					onClick={() => void handleRestore(false)}
				>
					重新打开
				</Button>
				<Button
					variant="primary"
					size="sm"
					disabled={busy}
					onClick={() => void handleRestore(true)}
				>
					恢复
				</Button>
			</div>
			{banner.stderrTail && (
				<Collapsible open={showStderr} duration={300}>
					<pre className="mt-1 max-h-[200px] overflow-auto rounded-control bg-inset p-2 shadow-hairline mono text-[11.5px] leading-[1.6] text-ink-2 whitespace-pre-wrap">
						{banner.stderrTail}
					</pre>
				</Collapsible>
			)}
		</div>
	);
}

export function TranscriptBanners({
	sessionId,
	banners,
}: {
	sessionId: string;
	banners: ReadonlyArray<BannerState>;
}) {
	const retryPrompt = useAppStore(s => s.retryPrompt);

	const visible = banners.filter(b => b.kind !== "compacting");
	if (visible.length === 0) return null;

	return (
		<div className="my-2 flex flex-col gap-2">
			{visible.map((banner, idx) => {
				switch (banner.kind) {
					case "retry":
						return <RetryBannerItem key={`retry-${idx}`} sessionId={sessionId} banner={banner} />;
					case "retry-failed":
						return (
							<Banner
								key={`retry-failed-${idx}`}
								variant="error"
								icon={<X size={14} strokeWidth={2.2} className="i" />}
								title="重试失败"
								action={
									<Button variant="secondary" size="sm" onClick={() => void retryPrompt(sessionId)}>
										重试
									</Button>
								}
							>
								<span>{banner.finalError ?? `已尝试 ${banner.attempt} 次`}</span>
							</Banner>
						);
					case "prompt-error": {
						const meta = [
							banner.provider,
							banner.model ? banner.model.split("/").pop() : undefined,
							banner.httpStatus ? `HTTP ${banner.httpStatus}` : undefined,
						]
							.filter(Boolean)
							.join(" · ");
						return (
							<Banner
								key={`prompt-error-${idx}`}
								variant="error"
								icon={<X size={14} strokeWidth={2.2} className="i" />}
								title="请求失败"
								action={
									<Button
										variant="secondary"
										size="sm"
										onClick={() => void retryPrompt(sessionId, banner.reqId)}
									>
										重试
									</Button>
								}
							>
								<span>{banner.message}</span>
								{meta && <span className="mono ml-2 text-[11.5px] text-ink-2">{meta}</span>}
							</Banner>
						);
					}
					case "compaction-error":
						return (
							<Banner
								key={`compaction-err-${idx}`}
								variant="error"
								icon={<X size={14} strokeWidth={2.2} className="i" />}
								title="上下文压缩失败"
							>
								<span>{banner.message}</span>
							</Banner>
						);
					case "proc-exit":
						return <ProcExitBannerItem key={`proc-exit-${idx}`} sessionId={sessionId} banner={banner} />;
					default:
						return null;
				}
			})}
		</div>
	);
}
