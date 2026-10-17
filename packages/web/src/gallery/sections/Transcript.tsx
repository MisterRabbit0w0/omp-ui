/**
 * Gallery section for Transcript & Tool Renderers (`src/gallery/sections/Transcript.tsx`).
 * Renders realistic fixture `SessionView`s built by feeding frames through `reduce`,
 * plus standalone CodeBlock, DiffView (unified/split + fold), OpenUrlCard, and EmptySession.
 */
import { useState } from "react";
import {
	CodeBlock,
	DiffView,
	EmptySession,
	OpenUrlCard,
	Transcript,
} from "../../features/transcript";
import {
	createInteractiveAndBannersFixture,
	createPrototypeChatFixture,
	SAMPLE_FOLDABLE_NEW,
	SAMPLE_FOLDABLE_OLD,
	SAMPLE_TYPESCRIPT_CODE,
} from "../../fixtures/transcript";

type SceneTab = "chat" | "interactive" | "components" | "welcome";

export default function TranscriptGallerySection() {
	const [scene, setScene] = useState<SceneTab>("chat");
	const [chatView] = useState(() => createPrototypeChatFixture("gallery-chat"));
	const [interactiveView] = useState(() => createInteractiveAndBannersFixture("gallery-interactive"));

	return (
		<div className="flex flex-col gap-5">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<div className="text-[13px] font-medium text-ink">
					对话流与工具渲染器预览（Transcript &amp; Tools）
				</div>
				<div className="inline-flex items-center gap-1 rounded-card bg-surface p-1 shadow-raised">
					<button
						type="button"
						onClick={() => setScene("chat")}
						className={
							"rounded-[7px] px-2.5 py-1 text-[12px] transition-colors " +
							(scene === "chat" ? "bg-field font-medium text-ink" : "text-ink-2 hover:text-ink")
						}
					>
						对话 · 审批与工具组
					</button>
					<button
						type="button"
						onClick={() => setScene("interactive")}
						className={
							"rounded-[7px] px-2.5 py-1 text-[12px] transition-colors " +
							(scene === "interactive" ? "bg-field font-medium text-ink" : "text-ink-2 hover:text-ink")
						}
					>
						问卷卡 · 实时 Bash · 横幅
					</button>
					<button
						type="button"
						onClick={() => setScene("components")}
						className={
							"rounded-[7px] px-2.5 py-1 text-[12px] transition-colors " +
							(scene === "components" ? "bg-field font-medium text-ink" : "text-ink-2 hover:text-ink")
						}
					>
						代码块 · 差异视图
					</button>
					<button
						type="button"
						onClick={() => setScene("welcome")}
						className={
							"rounded-[7px] px-2.5 py-1 text-[12px] transition-colors " +
							(scene === "welcome" ? "bg-field font-medium text-ink" : "text-ink-2 hover:text-ink")
						}
					>
						欢迎页
					</button>
				</div>
			</div>

			{scene === "chat" && (
				<div className="h-[720px] overflow-hidden rounded-window bg-app-main shadow-card flex flex-col">
					<Transcript sessionId={chatView.sessionId} view={chatView} />
				</div>
			)}

			{scene === "interactive" && (
				<div className="h-[720px] overflow-hidden rounded-window bg-app-main shadow-card flex flex-col">
					<Transcript sessionId={interactiveView.sessionId} view={interactiveView} />
				</div>
			)}

			{scene === "components" && (
				<div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
					<div className="flex flex-col gap-2">
						<h4 className="text-[10.5px] font-medium tracking-[0.08em] uppercase text-ink-3">
							代码块（Shiki omp-light / omp-dark + 行号 + 复制 + 换行）
						</h4>
						<CodeBlock
							filename="process.ts"
							language="typescript"
							code={SAMPLE_TYPESCRIPT_CODE}
						/>
						<h4 className="mt-3 text-[10.5px] font-medium tracking-[0.08em] uppercase text-ink-3">
							打开链接卡（OpenUrlCard）
						</h4>
						<OpenUrlCard
							url="https://console.anthropic.com/oauth/authorize?client_id=omp"
							launchUrl="http://127.0.0.1:4317/auth/redirect"
							instructions="请在浏览器中完成账号授权，完成后返回此窗口。"
						/>
					</div>
					<div className="flex flex-col gap-2">
						<h4 className="text-[10.5px] font-medium tracking-[0.08em] uppercase text-ink-3">
							差异视图（合并 / 并排 + 折叠未改动区段）
						</h4>
						<DiffView
							filePath="packages/bridge/src/pool.ts"
							oldText={SAMPLE_FOLDABLE_OLD}
							newText={SAMPLE_FOLDABLE_NEW}
						/>
					</div>
				</div>
			)}

			{scene === "welcome" && (
				<div className="h-[580px] overflow-auto rounded-window bg-app-main shadow-card">
					<EmptySession sessionId={null} cwd="~/Desktop/code/tools/omp-ui" />
				</div>
			)}
		</div>
	);
}
