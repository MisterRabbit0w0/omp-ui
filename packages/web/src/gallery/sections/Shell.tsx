import { useMemo, useState } from "react";
import { DiagnosticsDialog, SessionHeader, SessionTreeDialog } from "@/features/header";
import { CommandPalette } from "@/features/palette";
import { SettingsDialog } from "@/features/settings";
import { ConnectionBar } from "@/features/shell";
import { DeleteSessionDialog, Sidebar } from "@/features/sidebar";
import {
	buildShellFixtureViews,
	SHELL_FIXTURE_ATTENTION,
	SHELL_FIXTURE_NOW_MS,
	SHELL_FIXTURE_SESSIONS,
} from "@/fixtures/shell";
import { Button } from "@/ui/Button";

export default function ShellGallerySection() {
	const views = useMemo(() => buildShellFixtureViews(), []);
	const runningItem = SHELL_FIXTURE_SESSIONS[0]!;
	const waitingItem = SHELL_FIXTURE_SESSIONS[1]!;
	const errorItem = SHELL_FIXTURE_SESSIONS[4]!;

	const [paletteOpen, setPaletteOpen] = useState(false);
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [diagOpen, setDiagOpen] = useState(false);
	const [treeOpen, setTreeOpen] = useState(false);
	const [deleteOpen, setDeleteOpen] = useState(false);

	return (
		<div className="col-span-2 flex flex-col gap-5 border-t border-line pt-6">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<div>
					<h2 className="text-[16px] font-semibold text-ink">
						应用壳层 · 侧边栏 · 头部 · 命令面板 · 设置 (Shell)
					</h2>
					<p className="text-[12px] text-ink-2">
						覆盖 §6.1 侧边栏会话组与状态位、§6.2 会话头部与上下文环、§6.15 命令面板与删除确认、§6.17 连接状态条与设置弹窗。
					</p>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<Button size="sm" variant="secondary" onClick={() => setPaletteOpen(true)}>
						命令面板 (Ctrl+K)
					</Button>
					<Button size="sm" variant="secondary" onClick={() => setSettingsOpen(true)}>
						设置对话框
					</Button>
					<Button size="sm" variant="secondary" onClick={() => setDeleteOpen(true)}>
						删除确认弹窗
					</Button>
					<Button size="sm" variant="secondary" onClick={() => setTreeOpen(true)}>
						会话树弹窗
					</Button>
					<Button size="sm" variant="secondary" onClick={() => setDiagOpen(true)}>
						诊断弹窗
					</Button>
				</div>
			</div>

			<div className="grid grid-cols-1 gap-5 lg:grid-cols-[264px_minmax(0,1fr)]">
				<div>
					<h4 className="mb-2 text-[10.5px] font-medium tracking-[0.08em] text-ink-3 uppercase">
						侧边栏 Sidebar（运行中 · 待审批 · 未读 · 错误）
					</h4>
					<div className="h-[520px] w-[264px] overflow-hidden rounded-card shadow-card">
						<Sidebar
							sessionsOverride={SHELL_FIXTURE_SESSIONS}
							viewsOverride={views}
							currentSessionIdOverride="sess-running"
							attentionOverride={SHELL_FIXTURE_ATTENTION}
							connectionOverride="connected"
							ompVersionOverride="18.11.1"
							nowMs={SHELL_FIXTURE_NOW_MS}
							onCollapse={() => undefined}
							onOpenPalette={() => setPaletteOpen(true)}
							onOpenSettings={() => setSettingsOpen(true)}
							onOpenDiagnostics={() => setDiagOpen(true)}
						/>
					</div>
				</div>

				<div className="flex flex-col gap-4">
					<div>
						<h4 className="mb-2 text-[10.5px] font-medium tracking-[0.08em] text-ink-3 uppercase">
							会话头部 SessionHeader（常规 42% · 警告 84% · 临界 97%）
						</h4>
						<div className="flex flex-col gap-2.5">
							<div className="overflow-hidden rounded-card bg-app-main shadow-card">
								<SessionHeader
									sessionId="sess-running"
									scrolled={false}
									viewOverride={views["sess-running"]}
									sessionItemOverride={runningItem}
									onOpenSettings={() => setSettingsOpen(true)}
									onOpenDiagnostics={() => setDiagOpen(true)}
								/>
							</div>
							<div className="overflow-hidden rounded-card bg-app-main shadow-card">
								<SessionHeader
									sessionId="sess-waiting"
									scrolled={true}
									viewOverride={views["sess-waiting"]}
									sessionItemOverride={waitingItem}
									onOpenSettings={() => setSettingsOpen(true)}
									onOpenDiagnostics={() => setDiagOpen(true)}
								/>
							</div>
							<div className="overflow-hidden rounded-card bg-app-main shadow-card">
								<SessionHeader
									sessionId="sess-error"
									scrolled={true}
									showSidebarToggle={true}
									onToggleSidebar={() => undefined}
									viewOverride={views["sess-error"]}
									sessionItemOverride={errorItem}
									onOpenSettings={() => setSettingsOpen(true)}
									onOpenDiagnostics={() => setDiagOpen(true)}
								/>
							</div>
						</div>
					</div>

					<div>
						<h4 className="mb-2 text-[10.5px] font-medium tracking-[0.08em] text-ink-3 uppercase">
							连接状态条 ConnectionBar（§6.17）
						</h4>
						<div className="relative h-14 overflow-hidden rounded-card bg-app-main shadow-card">
							<ConnectionBar stateOverride="reconnecting" />
						</div>
					</div>
				</div>
			</div>

			<CommandPalette
				open={paletteOpen}
				onOpenChange={setPaletteOpen}
				onOpenSettings={() => setSettingsOpen(true)}
				onOpenDiagnostics={() => setDiagOpen(true)}
			/>
			<SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
			<DiagnosticsDialog sessionId="sess-running" open={diagOpen} onOpenChange={setDiagOpen} />
			<SessionTreeDialog sessionId="sess-running" open={treeOpen} onOpenChange={setTreeOpen} />
			<DeleteSessionDialog
				session={runningItem}
				open={deleteOpen}
				onOpenChange={setDeleteOpen}
				onConfirm={() => undefined}
			/>
		</div>
	);
}
