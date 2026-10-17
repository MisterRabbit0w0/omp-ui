import {
	Bell,
	Copy,
	ExternalLink,
	Keyboard,
	KeyRound,
	LogIn,
	LogOut,
	Palette,
	RefreshCw,
	Sliders,
	Sparkles,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type {
	ApprovalMode,
	CacheWarmingMode,
	InputUiRequest,
	InterruptMode,
	LoginProvider,
	LogoutAccount,
	OpenUrlUiRequest,
	QueueMode,
	UiConfig,
} from "@omp-ui/protocol";
import { useTheme, type Theme } from "@/app/theme";
import {
	buildCancelResponse,
	isOAuthCodeInputRequest,
	validateOAuthCodeInput,
} from "@/features/composer";
import { BridgeRpcError } from "@/lib/ws";
import { useAppStore } from "@/store/app-store";
import { getBridge, updateSessionView } from "@/store/bridge-access";
import { Button } from "@/ui/Button";
import { Kbd, Pill } from "@/ui/Chip";
import { Dialog, DialogContent } from "@/ui/Dialog";
import { Switch } from "@/ui/Switch";
import { toast } from "@/ui/Toast";
import {
	loadAppearancePrefs,
	saveAppearancePrefs,
	SHORTCUTS_LIST,
	type AppearancePrefs,
} from "./settings-utils";

export type SettingsTab = "accounts" | "defaults" | "session" | "appearance" | "notifications" | "shortcuts";

const TABS: { id: SettingsTab; label: string; icon: typeof KeyRound }[] = [
	{ id: "accounts", label: "账号", icon: KeyRound },
	{ id: "defaults", label: "默认值", icon: Sparkles },
	{ id: "session", label: "会话行为", icon: Sliders },
	{ id: "appearance", label: "外观", icon: Palette },
	{ id: "notifications", label: "通知", icon: Bell },
	{ id: "shortcuts", label: "快捷键", icon: Keyboard },
];

const THINKING_LEVELS = ["auto", "off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

export function SettingsDialog({
	open,
	onOpenChange,
	initialTab = "defaults",
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	initialTab?: SettingsTab;
}) {
	const [tab, setTab] = useState<SettingsTab>(initialTab);
	const { theme, setTheme } = useTheme();
	const currentSessionId = useAppStore(s => s.currentSessionId);
	const currentView = useAppStore(s => (s.currentSessionId ? s.views[s.currentSessionId] : undefined));
	const config = useAppStore(s => s.config);
	const answerUi = useAppStore(s => s.answerUi);

	// Appearance local prefs
	const [prefs, setPrefs] = useState<AppearancePrefs>(loadAppearancePrefs);

	// Accounts state
	const [providers, setProviders] = useState<LoginProvider[]>([]);
	const [loadingProviders, setLoadingProviders] = useState(false);
	const [loggingInId, setLoggingInId] = useState<string | null>(null);
	const [expandedProviderId, setExpandedProviderId] = useState<string | null>(null);
	const [accountsByProvider, setAccountsByProvider] = useState<Record<string, LogoutAccount[]>>({});
	const [oauthInputText, setOauthInputText] = useState("");
	const [oauthErrorText, setOauthErrorText] = useState<string | null>(null);

	// Session behavior local toggles (initialized from currentView.state)
	const [autoRetry, setAutoRetry] = useState(true);
	const [cacheWarming, setCacheWarming] = useState<CacheWarmingMode>("off");

	// Defaults local form state
	const [defaultModel, setDefaultModel] = useState(config?.defaultModel ?? "");
	const [defaultThinking, setDefaultThinking] = useState(config?.defaultThinking ?? "auto");
	const [defaultApproval, setDefaultApproval] = useState<ApprovalMode>(config?.defaultApprovalMode ?? "write");
	const [savingDefaults, setSavingDefaults] = useState(false);

	useEffect(() => {
		if (open) {
			setTab(initialTab);
		}
	}, [open, initialTab]);

	useEffect(() => {
		if (open) {
			setDefaultModel(config?.defaultModel ?? "");
			setDefaultThinking(config?.defaultThinking ?? "auto");
			setDefaultApproval(config?.defaultApprovalMode ?? "write");
		}
	}, [open, config]);

	const fetchProviders = useCallback(async () => {
		if (!currentSessionId) return;
		setLoadingProviders(true);
		try {
			const view = useAppStore.getState().views[currentSessionId];
			if (view && (view.readonly || view.proc === "none")) {
				await useAppStore.getState().startSession(currentSessionId);
			}
			const res = await getBridge().rpc(currentSessionId, { type: "get_login_providers" });
			setProviders(res.providers);
		} catch {
			/* ignore when bridge/session unavailable */
		} finally {
			setLoadingProviders(false);
		}
	}, [currentSessionId]);

	useEffect(() => {
		if (open && tab === "accounts") {
			void fetchProviders();
		}
	}, [open, tab, fetchProviders]);

	const saveConfigPatch = async (patch: Partial<UiConfig>) => {
		const base: UiConfig = config ?? { archived: [], recentProjects: [] };
		const next: UiConfig = { ...base, ...patch };
		useAppStore.setState({ config: next });
		try {
			const saved = await getBridge().http.putConfig(next);
			useAppStore.setState({ config: saved });
		} catch {
			/* local state still updated */
		}
	};

	const handleSaveDefaults = async () => {
		setSavingDefaults(true);
		try {
			await saveConfigPatch({
				defaultModel: defaultModel.trim() || undefined,
				defaultThinking: defaultThinking || undefined,
				defaultApprovalMode: defaultApproval,
			});
			toast("默认配置已保存", "success");
		} finally {
			setSavingDefaults(false);
		}
	};

	const handleLogin = async (providerId: string) => {
		if (!currentSessionId) {
			toast("请先打开或新建一个会话以执行登录", "info");
			return;
		}
		const view = useAppStore.getState().views[currentSessionId];
		if (view && (view.readonly || view.proc === "none")) {
			await useAppStore.getState().startSession(currentSessionId);
		}
		setLoggingInId(providerId);
		setOauthErrorText(null);
		try {
			await getBridge().rpc(currentSessionId, { type: "login", providerId });
			toast(`已登录 ${providerId}`, "success");
			await fetchProviders();
		} catch (err) {
			if (err instanceof BridgeRpcError && err.code === "cancelled") {
				toast("已取消登录", "info");
			} else {
				toast(err instanceof Error ? err.message : "登录失败", "error");
			}
		} finally {
			setLoggingInId(null);
			updateSessionView(currentSessionId, v => (v.lastOpenUrl ? { ...v, lastOpenUrl: undefined } : v));
		}
	};

	const handleLoadLogoutAccounts = async (providerId: string) => {
		if (!currentSessionId) return;
		if (expandedProviderId === providerId) {
			setExpandedProviderId(null);
			return;
		}
		setExpandedProviderId(providerId);
		try {
			const res = await getBridge().rpc(currentSessionId, { type: "get_logout_accounts", providerId });
			setAccountsByProvider(prev => ({ ...prev, [providerId]: res.accounts }));
		} catch (err) {
			toast(err instanceof Error ? err.message : "获取账号列表失败", "error");
		}
	};

	const handleLogout = async (providerId: string, credentialId: number) => {
		if (!currentSessionId) return;
		try {
			await getBridge().rpc(currentSessionId, { type: "logout", providerId, credentialId });
			toast("凭据已移除", "info");
			const res = await getBridge().rpc(currentSessionId, { type: "get_logout_accounts", providerId });
			setAccountsByProvider(prev => ({ ...prev, [providerId]: res.accounts }));
			await fetchProviders();
		} catch (err) {
			toast(err instanceof Error ? err.message : "登出失败", "error");
		}
	};

	const ensureSessionLive = async (): Promise<string | null> => {
		if (!currentSessionId) {
			toast("当前没有打开的会话", "info");
			return null;
		}
		const view = useAppStore.getState().views[currentSessionId];
		if (view && (view.readonly || view.proc === "none")) {
			await useAppStore.getState().startSession(currentSessionId);
		}
		return currentSessionId;
	};

	const handleSteeringMode = async (mode: QueueMode) => {
		const sid = await ensureSessionLive();
		if (!sid) return;
		updateSessionView(sid, v => ({ ...v, state: v.state ? { ...v.state, steeringMode: mode } : null }));
		try {
			await getBridge().rpc(sid, { type: "set_steering_mode", mode });
		} catch (err) {
			toast(err instanceof Error ? err.message : "设置失败", "error");
		}
	};

	const handleFollowUpMode = async (mode: QueueMode) => {
		const sid = await ensureSessionLive();
		if (!sid) return;
		updateSessionView(sid, v => ({ ...v, state: v.state ? { ...v.state, followUpMode: mode } : null }));
		try {
			await getBridge().rpc(sid, { type: "set_follow_up_mode", mode });
		} catch (err) {
			toast(err instanceof Error ? err.message : "设置失败", "error");
		}
	};

	const handleInterruptMode = async (mode: InterruptMode) => {
		const sid = await ensureSessionLive();
		if (!sid) return;
		updateSessionView(sid, v => ({ ...v, state: v.state ? { ...v.state, interruptMode: mode } : null }));
		try {
			await getBridge().rpc(sid, { type: "set_interrupt_mode", mode });
		} catch (err) {
			toast(err instanceof Error ? err.message : "设置失败", "error");
		}
	};

	const handleAutoCompaction = async (enabled: boolean) => {
		const sid = await ensureSessionLive();
		if (!sid) return;
		updateSessionView(sid, v => ({
			...v,
			state: v.state ? { ...v.state, autoCompactionEnabled: enabled } : null,
		}));
		try {
			await getBridge().rpc(sid, { type: "set_auto_compaction", enabled });
		} catch (err) {
			toast(err instanceof Error ? err.message : "设置失败", "error");
		}
	};

	const handleAutoRetry = async (enabled: boolean) => {
		setAutoRetry(enabled);
		const sid = await ensureSessionLive();
		if (!sid) return;
		try {
			await getBridge().rpc(sid, { type: "set_auto_retry", enabled });
		} catch (err) {
			toast(err instanceof Error ? err.message : "设置失败", "error");
		}
	};

	const handleCacheWarming = async (mode: CacheWarmingMode) => {
		setCacheWarming(mode);
		const sid = await ensureSessionLive();
		if (!sid) return;
		try {
			await getBridge().rpc(sid, { type: "set_cache_warming", mode });
		} catch (err) {
			toast(err instanceof Error ? err.message : "设置失败", "error");
		}
	};

	const updatePrefs = (patch: Partial<AppearancePrefs>) => {
		setPrefs(prev => {
			const next = { ...prev, ...patch };
			saveAppearancePrefs(next);
			return next;
		});
	};

	const handleNotificationsToggle = async (enabled: boolean) => {
		if (enabled && typeof Notification !== "undefined" && Notification.permission === "default") {
			await Notification.requestPermission().catch(() => undefined);
		}
		await saveConfigPatch({ notifications: enabled });
	};

	// Check if there are pending OAuth UI requests (open_url / input) on the active session
	const pendingInput = currentView?.pendingUi.find((r): r is InputUiRequest => r.method === "input");
	const pendingOpenUrl =
		currentView?.pendingUi.find((r): r is OpenUrlUiRequest => r.method === "open_url") ??
		(pendingInput || loggingInId ? currentView?.lastOpenUrl : undefined);

	useEffect(() => {
		setOauthInputText("");
		setOauthErrorText(null);
	}, [pendingInput?.id]);

	const cancelPendingOAuthInput = () => {
		if (!currentSessionId) return;
		if (pendingInput) {
			answerUi(currentSessionId, buildCancelResponse(pendingInput.id));
		}
		updateSessionView(currentSessionId, v => (v.lastOpenUrl ? { ...v, lastOpenUrl: undefined } : v));
		setOauthInputText("");
		setOauthErrorText(null);
	};

	const submitPendingOAuthInput = () => {
		if (!currentSessionId || !pendingInput) return;
		const isOAuthCode = isOAuthCodeInputRequest(pendingInput);
		if (isOAuthCode) {
			const check = validateOAuthCodeInput(oauthInputText);
			if (!check.valid) {
				setOauthErrorText(check.error ?? "请输入有效的授权码");
				return;
			}
		}
		answerUi(currentSessionId, {
			type: "extension_ui_response",
			id: pendingInput.id,
			value: isOAuthCode ? oauthInputText.trim() : oauthInputText,
		});
		setOauthInputText("");
		setOauthErrorText(null);
	};

	const handleDialogOpenChange = (nextOpen: boolean) => {
		if (!nextOpen && pendingInput && (loggingInId !== null || isOAuthCodeInputRequest(pendingInput))) {
			cancelPendingOAuthInput();
		}
		onOpenChange(nextOpen);
	};

	return (
		<Dialog open={open} onOpenChange={handleDialogOpenChange}>
			<DialogContent
				width={640}
				title="设置"
				description="管理模型账号、默认配置、当前会话行为、外观与快捷键。"
			>
				<div className="mt-3 grid h-[420px] grid-cols-[148px_1px_minmax(0,1fr)] gap-3">
					{/* Left nav */}
					<nav className="flex flex-col gap-0.5">
						{TABS.map(t => {
							const IconComp = t.icon;
							const active = tab === t.id;
							return (
								<button
									key={t.id}
									type="button"
									onClick={() => setTab(t.id)}
									className={
										"flex h-8 items-center gap-2 rounded-control px-2.5 text-left text-[12.5px] transition-colors " +
										(active
											? "bg-field font-medium text-ink"
											: "text-ink-2 hover:bg-hover hover:text-ink")
									}
								>
									<IconComp size={14} strokeWidth={1.8} className="i shrink-0" />
									<span>{t.label}</span>
								</button>
							);
						})}
					</nav>

					<div className="bg-line" />

					{/* Right pane */}
					<div className="min-h-0 overflow-auto pr-1">
						{tab === "accounts" && (
							<div className="flex flex-col gap-3">
								<div className="flex items-center justify-between gap-2">
									<div className="min-w-0 flex-1 text-[12px] text-ink-2">
										管理模型服务商 OAuth 与 API 凭据（DESIGN §9.8）。
									</div>
									<Button
										size="sm"
										variant="secondary"
										loading={loadingProviders}
										icon={<RefreshCw size={11} strokeWidth={2} />}
										onClick={() => void fetchProviders()}
									>
										刷新
									</Button>
								</div>

								{/* Combined OAuth login card when open_url or input request is active (DESIGN §7.1) */}
								{(pendingOpenUrl || pendingInput) && currentSessionId && (
									<div className="rounded-card bg-inset p-3 shadow-hairline">
										<div className="flex items-center justify-between gap-2">
											<div className="text-[12.5px] font-medium text-ink">正在完成授权登录</div>
											{pendingInput && (
												<Button
													size="sm"
													variant="ghost"
													onClick={cancelPendingOAuthInput}
												>
													取消
												</Button>
											)}
										</div>
										{pendingOpenUrl && pendingOpenUrl.method === "open_url" && (
											<div className="mt-2 flex flex-col gap-1.5">
												{pendingOpenUrl.instructions && (
													<div className="text-[12px] text-ink-2">
														{pendingOpenUrl.instructions}
													</div>
												)}
												<div className="flex items-center gap-2">
													<Button
														size="sm"
														variant="primary"
														icon={<ExternalLink size={11} strokeWidth={2} />}
														onClick={() =>
															window.open(
																pendingOpenUrl.launchUrl ?? pendingOpenUrl.url,
																"_blank",
																"noopener",
															)
														}
													>
														打开授权页面
													</Button>
													<Button
														size="sm"
														variant="secondary"
														icon={<Copy size={11} strokeWidth={2} />}
														onClick={() => {
															void navigator.clipboard.writeText(
																pendingOpenUrl.launchUrl ?? pendingOpenUrl.url,
															);
															toast("已复制链接", "info");
														}}
													>
														复制链接
													</Button>
												</div>
											</div>
										)}
										{pendingInput && pendingInput.method === "input" && (
											<div className="mt-2.5 flex flex-col gap-1.5">
												<label className="text-[12px] text-ink-2">{pendingInput.title}</label>
												<div className="flex items-center gap-2">
													<input
														value={oauthInputText}
														onChange={e => {
															setOauthInputText(e.target.value);
															if (oauthErrorText) setOauthErrorText(null);
														}}
														onKeyDown={e => {
															if (e.nativeEvent.isComposing || e.keyCode === 229) return;
															if (e.key === "Enter") {
																e.preventDefault();
																submitPendingOAuthInput();
															} else if (e.key === "Escape") {
																e.preventDefault();
																e.stopPropagation();
																cancelPendingOAuthInput();
															}
														}}
														placeholder={pendingInput.placeholder ?? "粘贴授权码或完整回调 URL…"}
														className="h-7 flex-1 rounded-control bg-surface px-2 font-mono text-[12px] text-ink shadow-hairline outline-none"
													/>
													<Button
														size="sm"
														variant="primary"
														disabled={
															isOAuthCodeInputRequest(pendingInput) &&
															oauthInputText.trim().length === 0
														}
														onClick={submitPendingOAuthInput}
													>
														提交
													</Button>
												</div>
												{oauthErrorText && (
													<div className="text-[11.5px] text-red">{oauthErrorText}</div>
												)}
											</div>
										)}
									</div>
								)}

								{providers.length === 0 && !loadingProviders && (
									<div className="rounded-control bg-inset p-4 text-center text-[12px] text-ink-2 shadow-hairline">
										{currentSessionId
											? "暂无可用的登录提供商"
											: "请先打开或新建一个会话以读取登录提供商列表"}
									</div>
								)}

								<div className="flex flex-col gap-1.5">
									{providers.map(p => {
										const accounts = accountsByProvider[p.id] ?? [];
										const isExpanded = expandedProviderId === p.id;
										return (
											<div
												key={p.id}
												className="rounded-control bg-inset p-2.5 shadow-hairline"
											>
												<div className="flex items-center justify-between gap-2">
													<div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
														<span className="truncate text-[12.5px] font-medium text-ink">
															{p.name}
														</span>
														<span className="truncate font-mono text-[11px] text-ink-2">
															{p.id}
														</span>
														{p.authenticated ? (
															<Pill tone="green">已连接</Pill>
														) : (
															<Pill tone="neutral">未连接</Pill>
														)}
													</div>
													<div className="flex shrink-0 items-center gap-1.5">
														<Button
															size="sm"
															variant="secondary"
															loading={loggingInId === p.id}
															disabled={loggingInId !== null && loggingInId !== p.id}
															icon={<LogIn size={11} strokeWidth={2} />}
															onClick={() => void handleLogin(p.id)}
														>
															登录
														</Button>
														{p.authenticated && (
															<Button
																size="sm"
																variant="ghost"
																onClick={() => void handleLoadLogoutAccounts(p.id)}
															>
																{isExpanded ? "收起凭据" : "管理凭据"}
															</Button>
														)}
													</div>
												</div>
												{isExpanded && (
													<div className="mt-2 border-t border-line pt-2">
														{accounts.length === 0 ? (
															<div className="text-[11.5px] text-ink-2">
																没有可登出的存储凭据
															</div>
														) : (
															<div className="flex flex-col gap-1.5">
																{accounts.map(acc => (
																	<div
																		key={acc.credentialId}
																		className="flex items-center justify-between gap-2 rounded-[6px] bg-surface px-2.5 py-1.5 text-[12px] shadow-hairline"
																	>
																		<div className="min-w-0 flex-1">
																			<div className="flex flex-wrap items-center gap-1.5">
																				<span className="truncate font-medium text-ink">
																					{acc.label}
																				</span>
																				<span className="shrink-0 font-mono text-[11px] text-ink-2">
																					({acc.type})
																				</span>
																				{acc.active && (
																					<Pill tone="accent">当前使用</Pill>
																				)}
																			</div>
																			{acc.detail && (
																				<div className="truncate font-mono text-[11px] text-ink-2">
																					{acc.detail}
																				</div>
																			)}
																		</div>
																		<Button
																			size="sm"
																			variant="danger"
																			icon={<LogOut size={11} strokeWidth={2} />}
																			onClick={() =>
																				void handleLogout(p.id, acc.credentialId)
																			}
																		>
																			登出
																		</Button>
																	</div>
																))}
															</div>
														)}
													</div>
												)}
											</div>
										);
									})}
								</div>
							</div>
						)}

						{tab === "defaults" && (
							<div className="flex flex-col gap-3.5">
								<div>
									<label className="mb-1 block text-[12px] font-medium text-ink-2">
										新会话默认模型
									</label>
									<input
										value={defaultModel}
										onChange={e => setDefaultModel(e.target.value)}
										placeholder="例如 anthropic/claude-opus-5.5"
										aria-label="新会话默认模型"
										className="h-8 w-full rounded-control bg-inset px-2.5 font-mono text-[12px] text-ink shadow-hairline outline-none placeholder:text-ink-3 focus:ring-1 focus:ring-line-strong"
									/>
								</div>

								<div>
									<label className="mb-1 block text-[12px] font-medium text-ink-2">
										新会话默认思考级别
									</label>
									<select
										value={defaultThinking}
										onChange={e => setDefaultThinking(e.target.value)}
										aria-label="新会话默认思考级别"
										className="h-8 w-full rounded-control bg-inset px-2 text-[12px] text-ink shadow-hairline outline-none focus:ring-1 focus:ring-line-strong"
									>
										{THINKING_LEVELS.map(lvl => (
											<option key={lvl} value={lvl}>
												{lvl}
											</option>
										))}
									</select>
								</div>

								<div>
									<label className="mb-1 block text-[12px] font-medium text-ink-2">
										新会话默认审批模式
									</label>
									<select
										value={defaultApproval}
										onChange={e => setDefaultApproval(e.target.value as ApprovalMode)}
										aria-label="新会话默认审批模式"
										className="h-8 w-full rounded-control bg-inset px-2 text-[12px] text-ink shadow-hairline outline-none focus:ring-1 focus:ring-line-strong"
									>
										<option value="always-ask">每次询问 (always-ask)</option>
										<option value="write">仅写操作 (write)</option>
										<option value="yolo">全部允许 (yolo)</option>
									</select>
								</div>

								<div className="flex justify-end pt-2">
									<Button
										variant="primary"
										loading={savingDefaults}
										onClick={() => void handleSaveDefaults()}
									>
										保存默认配置
									</Button>
								</div>
							</div>
						)}

						{tab === "session" && (
							<div className="flex flex-col gap-3">
								<div className="flex items-center justify-between gap-3 rounded-control bg-inset px-3 py-2.5 shadow-hairline">
									<div className="min-w-0 flex-1">
										<div className="text-[12.5px] font-medium text-ink">插话投递模式 (Steering)</div>
										<div className="text-[11.5px] text-ink-2">运行中发送插话消息时的队列消费方式</div>
									</div>
									<select
										value={currentView?.state?.steeringMode ?? "one-at-a-time"}
										onChange={e => void handleSteeringMode(e.target.value as QueueMode)}
										aria-label="插话投递模式"
										className="h-7 shrink-0 rounded-control bg-surface px-2 text-[12px] text-ink shadow-hairline outline-none"
									>
										<option value="one-at-a-time">逐条 (one-at-a-time)</option>
										<option value="all">合并全部 (all)</option>
									</select>
								</div>

								<div className="flex items-center justify-between gap-3 rounded-control bg-inset px-3 py-2.5 shadow-hairline">
									<div className="min-w-0 flex-1">
										<div className="text-[12.5px] font-medium text-ink">后续消息模式 (Follow-up)</div>
										<div className="text-[11.5px] text-ink-2">当前回合结束后排队消息的执行方式</div>
									</div>
									<select
										value={currentView?.state?.followUpMode ?? "one-at-a-time"}
										onChange={e => void handleFollowUpMode(e.target.value as QueueMode)}
										aria-label="后续消息模式"
										className="h-7 shrink-0 rounded-control bg-surface px-2 text-[12px] text-ink shadow-hairline outline-none"
									>
										<option value="one-at-a-time">逐条 (one-at-a-time)</option>
										<option value="all">合并全部 (all)</option>
									</select>
								</div>

								<div className="flex items-center justify-between gap-3 rounded-control bg-inset px-3 py-2.5 shadow-hairline">
									<div className="min-w-0 flex-1">
										<div className="text-[12.5px] font-medium text-ink">打断模式 (Interrupt)</div>
										<div className="text-[11.5px] text-ink-2">插话到达时立即打断或等待工具完成</div>
									</div>
									<select
										value={currentView?.state?.interruptMode ?? "immediate"}
										onChange={e => void handleInterruptMode(e.target.value as InterruptMode)}
										aria-label="打断模式"
										className="h-7 shrink-0 rounded-control bg-surface px-2 text-[12px] text-ink shadow-hairline outline-none"
									>
										<option value="immediate">立即 (immediate)</option>
										<option value="wait">等待工具完成 (wait)</option>
									</select>
								</div>

								<div className="flex items-center justify-between gap-3 rounded-control bg-inset px-3 py-2.5 shadow-hairline">
									<div className="min-w-0 flex-1">
										<div className="text-[12.5px] font-medium text-ink">自动压缩上下文</div>
										<div className="text-[11.5px] text-ink-2">接近上下文上限时自动生成摘要</div>
									</div>
									<Switch
										label="自动压缩上下文"
										checked={currentView?.state?.autoCompactionEnabled ?? true}
										onCheckedChange={v => void handleAutoCompaction(v)}
									/>
								</div>

								<div className="flex items-center justify-between gap-3 rounded-control bg-inset px-3 py-2.5 shadow-hairline">
									<div className="min-w-0 flex-1">
										<div className="text-[12.5px] font-medium text-ink">自动重试瞬时错误</div>
										<div className="text-[11.5px] text-ink-2">遇到 429 / 529 等错误时自动退避重试</div>
									</div>
									<Switch
										label="自动重试瞬时错误"
										checked={autoRetry}
										onCheckedChange={v => void handleAutoRetry(v)}
									/>
								</div>

								<div className="flex items-center justify-between gap-3 rounded-control bg-inset px-3 py-2.5 shadow-hairline">
									<div className="min-w-0 flex-1">
										<div className="text-[12.5px] font-medium text-ink">Prompt 缓存预热</div>
										<div className="text-[11.5px] text-ink-2">保持提供商前缀缓存活跃以降低首字延迟</div>
									</div>
									<select
										value={cacheWarming}
										onChange={e => void handleCacheWarming(e.target.value as CacheWarmingMode)}
										aria-label="Prompt 缓存预热"
										className="h-7 shrink-0 rounded-control bg-surface px-2 text-[12px] text-ink shadow-hairline outline-none"
									>
										<option value="off">关闭 (off)</option>
										<option value="streaming">流式期间 (streaming)</option>
										<option value="idle">空闲保持 (idle)</option>
									</select>
								</div>

								<div className="flex items-center justify-between gap-3 rounded-control bg-inset px-3 py-2.5 shadow-hairline">
									<div className="min-w-0 flex-1">
										<div className="text-[12.5px] font-medium text-ink">输入框幽灵补全</div>
										<div className="text-[11.5px] text-ink-2">停顿 300ms 后预测后续输入词，按 Tab 接受</div>
									</div>
									<Switch
										label="输入框幽灵补全"
										checked={config?.ghostText ?? false}
										onCheckedChange={v => void saveConfigPatch({ ghostText: v })}
									/>
								</div>
							</div>
						)}

						{tab === "appearance" && (
							<div className="flex flex-col gap-3">
								<div className="rounded-control bg-inset p-3 shadow-hairline">
									<div className="mb-2 text-[12.5px] font-medium text-ink">主题外观</div>
									<div className="grid grid-cols-3 gap-2">
										{(
											[
												{ value: "system", label: "跟随系统" },
												{ value: "light", label: "浅色" },
												{ value: "dark", label: "深色" },
											] as { value: Theme; label: string }[]
										).map(opt => {
											const active = theme === opt.value;
											return (
												<button
													key={opt.value}
													type="button"
													onClick={() => {
														setTheme(opt.value);
														void saveConfigPatch({ theme: opt.value });
													}}
													className={
														"flex h-8 items-center justify-center rounded-control text-[12.5px] font-medium transition-colors " +
														(active
															? "bg-field text-ink shadow-btn"
															: "bg-surface text-ink-2 shadow-hairline hover:bg-hover")
													}
												>
													{opt.label}
												</button>
											);
										})}
									</div>
								</div>

								<div className="flex items-center justify-between gap-3 rounded-control bg-inset px-3 py-2.5 shadow-hairline">
									<div className="min-w-0 flex-1">
										<div className="text-[12.5px] font-medium text-ink">基准字号</div>
										<div className="text-[11.5px] text-ink-2">控制全局 UI 与消息排版的缩放比例</div>
									</div>
									<div className="flex shrink-0 items-center gap-1">
										{([12, 13, 14] as const).map(sz => (
											<button
												key={sz}
												type="button"
												onClick={() => updatePrefs({ fontSize: sz })}
												className={
													"h-7 rounded-control px-2.5 font-mono text-[12px] transition-colors " +
													(prefs.fontSize === sz
														? "bg-field font-medium text-ink shadow-btn"
														: "bg-surface text-ink-2 shadow-hairline hover:bg-hover")
												}
											>
												{sz}px
											</button>
										))}
									</div>
								</div>

								<div className="flex items-center justify-between gap-3 rounded-control bg-inset px-3 py-2.5 shadow-hairline">
									<div className="min-w-0 flex-1">
										<div className="text-[12.5px] font-medium text-ink">紧凑模式</div>
										<div className="text-[11.5px] text-ink-2">减小消息与工具卡片之间的垂直间距</div>
									</div>
									<Switch
										label="紧凑模式"
										checked={prefs.compact}
										onCheckedChange={compact => updatePrefs({ compact })}
									/>
								</div>
							</div>
						)}

						{tab === "notifications" && (
							<div className="flex flex-col gap-3">
								<div className="flex items-center justify-between gap-3 rounded-control bg-inset px-3 py-2.5 shadow-hairline">
									<div className="min-w-0 flex-1">
										<div className="text-[12.5px] font-medium text-ink">桌面系统通知</div>
										<div className="text-[11.5px] text-ink-2">
											当标签页在后台时，回合完成、等待审批或出错时发送通知
										</div>
									</div>
									<Switch
										label="桌面系统通知"
										checked={config?.notifications ?? true}
										onCheckedChange={v => void handleNotificationsToggle(v)}
									/>
								</div>

								<div className="flex items-center justify-between gap-3 rounded-control bg-inset px-3 py-2.5 shadow-hairline">
									<div className="min-w-0 flex-1">
										<div className="text-[12.5px] font-medium text-ink">完成提示音</div>
										<div className="text-[11.5px] text-ink-2">后台任务完成或需要审批时播放轻柔提示音</div>
									</div>
									<Switch
										label="完成提示音"
										checked={prefs.sound}
										onCheckedChange={sound => updatePrefs({ sound })}
									/>
								</div>
							</div>
						)}

						{tab === "shortcuts" && (
							<div className="rounded-control bg-inset p-1.5 shadow-hairline">
								{SHORTCUTS_LIST.map(s => (
									<div
										key={s.label}
										className="flex h-8 items-center justify-between border-b border-line px-2.5 text-[12.5px] last:border-b-0"
									>
										<span className="text-ink-2">{s.label}</span>
										<span className="flex items-center gap-1">
											{s.keys.map((k, i) => (
												<Kbd key={i}>{k}</Kbd>
											))}
										</span>
									</div>
								))}
							</div>
						)}
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}
