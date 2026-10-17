import { useState, type ReactNode } from "react";
import {
	Composer,
	FileMentionMenu,
	ModelMenuPanel,
	SlashMenu,
	UiRequestLayer,
	filterSlashCommands,
} from "@/features/composer";
import {
	COMPOSER_FILE_HITS,
	COMPOSER_MODELS,
	COMPOSER_SAMPLE_ATTACHMENTS,
	COMPOSER_SLASH_COMMANDS,
	CONFIRM_UI_REQUEST_FIXTURE,
	EDITOR_UI_REQUEST_FIXTURE,
	INPUT_UI_REQUEST_FIXTURE,
	SELECT_UI_REQUEST_FIXTURE,
	createComposerIdleView,
	createComposerRunningView,
	createComposerRestartingView,
	createComposerUsageLimitView,
	createComposerYoloView,
	createUiRequestView,
} from "@/fixtures/composer";

function CardBlock({ title, children }: { title: string; children: ReactNode }) {
	return (
		<div className="flex flex-col gap-2">
			<h4 className="text-[10.5px] font-medium tracking-[0.08em] text-ink-3 uppercase">{title}</h4>
			{children}
		</div>
	);
}

export function ComposerGallerySection() {
	const [idleView] = useState(() => createComposerIdleView());
	const [runningView] = useState(() => createComposerRunningView());
	const [yoloView] = useState(() => createComposerYoloView());
	const [restartingView] = useState(() => createComposerRestartingView());
	const [usageLimitView, setUsageLimitView] = useState(() => createComposerUsageLimitView());

	const [selectUiView] = useState(() => createUiRequestView(SELECT_UI_REQUEST_FIXTURE));
	const [confirmUiView] = useState(() => createUiRequestView(CONFIRM_UI_REQUEST_FIXTURE));
	const [inputUiView] = useState(() => createUiRequestView(INPUT_UI_REQUEST_FIXTURE));
	const [editorUiView] = useState(() => createUiRequestView(EDITOR_UI_REQUEST_FIXTURE));

	const [slashIdx, setSlashIdx] = useState(0);
	const [atIdx, setAtIdx] = useState(0);

	const slashRows = filterSlashCommands(COMPOSER_SLASH_COMMANDS, {
		kind: "slash",
		query: "",
		start: 0,
		end: 1,
	});

	return (
		<div className="col-span-2 flex flex-col gap-6 pt-4">
			<div className="border-t border-line pt-6">
				<h2 className="text-[15px] font-semibold text-ink">Composer 与交互请求 (Composer &amp; UiRequestLayer)</h2>
				<p className="mt-1 text-[12px] text-ink-2">
					覆盖欢迎页（上下文条 + 项目菜单）、空闲、输入、幽灵补全、运行中（停止/队列/插话）、权限 chip（含完全访问/重启中）、Shell 模式、图片附件、拖拽上传、Slash 菜单、@ 文件菜单、模型·思考菜单及 4 类模态请求。
				</p>
			</div>

			<div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
				<CardBlock title="0. Composer · 欢迎页（上下文条 + 输入卡，无会话）">
					<Composer sessionId={null} cwd={null} initialText="" />
				</CardBlock>

				<CardBlock title="0b. 项目菜单展开（搜索 + 最近项目 + 选择文件夹…）">
					<div className="min-h-[300px]">
						<Composer sessionId={null} cwd={null} initialText="" initialOpenMenu="project" />
					</div>
				</CardBlock>

				<CardBlock title="0c. 权限菜单展开（欢迎页：作用于这次新建的会话）">
					<div className="min-h-[260px] pt-[200px]">
						<Composer sessionId={null} cwd={null} initialText="" initialOpenMenu="permission" />
					</div>
				</CardBlock>

				<CardBlock title="0d. 完全访问（orange-ink 权限 chip）">
					<Composer sessionId="composer-yolo" cwd="~/Desktop/code/tools/omp-ui" viewOverride={yoloView} initialText="" />
				</CardBlock>

				<CardBlock title="0e. 权限切换中（chip spinner，输入卡禁用）">
					<Composer
						sessionId="composer-restarting"
						cwd="~/Desktop/code/tools/omp-ui"
						viewOverride={restartingView}
						initialText=""
					/>
				</CardBlock>

				<CardBlock title="1. Composer · 空闲 (Idle)">
					<Composer sessionId="composer-idle" cwd="~/Desktop/code/tools/omp-ui" viewOverride={idleView} initialText="" />
				</CardBlock>

				<CardBlock title="2. Composer · 输入中 + 幽灵补全 (Typing + Ghost Text)">
					<Composer
						sessionId="composer-typing"
						cwd="~/Desktop/code/tools/omp-ui"
						viewOverride={idleView}
						initialText="请检查 Bridge 的 v2 分片重组"
						initialGhostText=" 与 byteLength 校验逻辑"
					/>
				</CardBlock>

				<CardBlock title="3. Composer · 运行中（停止 + 队列 Chips + Widgets）">
					<Composer
						sessionId="composer-running"
						cwd="~/Desktop/code/tools/omp-ui"
						viewOverride={runningView}
						initialText=""
					/>
				</CardBlock>

				<CardBlock title="4. Composer · 运行中有输入（插话 ▾ + 底部提示）">
					<Composer
						sessionId="composer-running-text"
						cwd="~/Desktop/code/tools/omp-ui"
						viewOverride={runningView}
						initialText="同时验证 maxReassembledFrameBytes 超限时的错误帧返回"
					/>
				</CardBlock>

				<CardBlock title="5. Composer · Shell 模式 (!cmd)">
					<Composer
						sessionId="composer-shell"
						cwd="~/Desktop/code/tools/omp-ui"
						viewOverride={idleView}
						initialText="!bun test packages/web"
					/>
				</CardBlock>

				<CardBlock title="6. Composer · 图片附件 + 多行切换 (Attachments)">
					<Composer
						sessionId="composer-attachments"
						cwd="~/Desktop/code/tools/omp-ui"
						viewOverride={idleView}
						initialText={"对照这两张架构与火焰图，定位流式渲染瓶颈：\n重点看 message_update 批处理耗时"}
						initialAttachments={COMPOSER_SAMPLE_ATTACHMENTS}
					/>
				</CardBlock>

				<CardBlock title="7. Slash 命令菜单 (/ Menu)">
					<Composer
						sessionId="composer-slash"
						cwd="~/Desktop/code/tools/omp-ui"
						viewOverride={idleView}
						initialText="/"
						inlineMenus
					/>
				</CardBlock>

				<CardBlock title="8. @ 文件引用菜单 (@ Menu)">
					<Composer
						sessionId="composer-at"
						cwd="~/Desktop/code/tools/omp-ui"
						viewOverride={runningView}
						initialText="先看 @p"
						initialFiles={COMPOSER_FILE_HITS}
						inlineMenus
					/>
				</CardBlock>

				<CardBlock title="9. 模型·思考菜单（额度警示 + 思考分段 + Fast/Slow 开关）">
					<div className="flex flex-col items-start gap-3">
						<div className="rounded-card bg-surface p-1 shadow-raised">
							<ModelMenuPanel
								models={COMPOSER_MODELS}
								currentModel={usageLimitView.state?.model}
								thinkingLevels={usageLimitView.thinkingLevels}
								currentThinking={usageLimitView.state?.thinkingLevel}
								onSelectThinking={level =>
									setUsageLimitView(v => ({
										...v,
										state: v.state ? { ...v.state, thinkingLevel: level } : v.state,
									}))
								}
								state={usageLimitView.state}
								onSelectModel={model =>
									setUsageLimitView(v => ({
										...v,
										state: v.state ? { ...v.state, model } : v.state,
									}))
								}
								onToggleFastMode={enabled =>
									setUsageLimitView(v => ({
										...v,
										state: v.state ? { ...v.state, fastModeEnabled: enabled } : v.state,
									}))
								}
								onToggleSlowMode={enabled =>
									setUsageLimitView(v => ({
										...v,
										state: v.state ? { ...v.state, slowModeEnabled: enabled } : v.state,
									}))
								}
							/>
						</div>
					</div>
				</CardBlock>

				<CardBlock title="10. 拖拽上传态 (Drag-over State)">
					<Composer
						sessionId="composer-drag"
						cwd="~/Desktop/code/tools/omp-ui"
						viewOverride={idleView}
						initialText=""
						initialDragOver={true}
					/>
				</CardBlock>
			</div>

			<div className="mt-2 border-t border-line pt-5">
				<h3 className="mb-4 text-[13px] font-semibold text-ink">
					Extension UI 模态对话框 (UiRequestLayer: select / confirm / input / editor)
				</h3>
				<div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
					<CardBlock title="UiRequest · Select (含选项描述与倒计时条)">
						<div className="flex min-h-[290px] items-center justify-center rounded-card bg-app-side p-4 shadow-hairline">
							<UiRequestLayer sessionId="ui-req-select" viewOverride={selectUiView} inline />
						</div>
					</CardBlock>

					<CardBlock title="UiRequest · Confirm (模态确认)">
						<div className="flex min-h-[290px] items-center justify-center rounded-card bg-app-side p-4 shadow-hairline">
							<UiRequestLayer sessionId="ui-req-confirm" viewOverride={confirmUiView} inline />
						</div>
					</CardBlock>

					<CardBlock title="UiRequest · Input (单行输入)">
						<div className="flex min-h-[240px] items-center justify-center rounded-card bg-app-side p-4 shadow-hairline">
							<UiRequestLayer sessionId="ui-req-input" viewOverride={inputUiView} inline />
						</div>
					</CardBlock>

					<CardBlock title="UiRequest · Editor (640px 多行编辑器)">
						<div className="flex min-h-[320px] items-center justify-center rounded-card bg-app-side p-4 shadow-hairline">
							<UiRequestLayer sessionId="ui-req-editor" viewOverride={editorUiView} inline />
						</div>
					</CardBlock>
				</div>
			</div>
		</div>
	);
}

export default ComposerGallerySection;
