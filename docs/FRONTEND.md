# omp-ui 前端视觉与组件规格

本文档定死前端的外观：主题 token、字体、层级与阴影、动效、布局尺寸、每个组件的结构和状态。行为与数据来源见 `DESIGN.md`；两者冲突时，视觉以本文档为准，行为以 `DESIGN.md` 为准。

静态原型：`prototype/index.html`（无构建，直接用浏览器打开，右上角切换明暗）。实现时以原型和本文档的数值为验收基准。

---

## 0. 参考来源与取舍

| 来源 | 用什么 | 不用什么 / 原因 |
|---|---|---|
| Beautiful UI（MIT，`vault/projects/beautiful-ui-components`） | **视觉基础**：全部颜色、阴影、圆角、缓动、keyframes；思考轨迹、工具行、问卷卡、Composer、侧边栏滑动高亮、代码块、diff 着色的结构语法 | 示例数据与 ice-cream 文案；`glimm`、`liveline` 依赖（光效自己用 CSS 实现） |
| shadcn/ui（MIT） | 无障碍原语的组织方式：Radix + Tailwind，组件代码放进仓库自己维护 | 默认的 zinc 主题（被上面的 token 替换） |
| Appica UI（MIT） | Border Beam / Glow 的思路，只用在一处：运行中的 Composer 描边光 | 整库依赖（Base UI 与我们的 Radix 重复） |
| beUI（MIT 公开部分） | Agent 组件的信息结构参考（Tool Approval、File Diff、Agent Activity） | Pro 内容 |
| transitions.dev | 过渡清单作为检查表（菜单下拉、模态开关、面板展开、图标切换、成功勾、错误抖动、数字弹入） | 其片段代码：条款禁止整库再分发，按下文 §4 自行实现 |
| Koboyo Icons | 空状态的 1–3 个手绘插图（`currentColor`，作为产品的一部分嵌入，许可允许） | 不能做成图标选择器，也不能批量打包 |
| Anthropic Art | 不用于 v1。可选的欢迎页插画方向（满版强调色 + 象牙白承载形 + 近黑手绘线），以后单独出图 | 生成式插画不进入组件系统 |
| ThreeUI / Rare UI / handraw-style | 不用 | WebGL 对聊天工具不必要；后两者无许可证 |

---

## 1. 设计原则

1. **安静的中性灰 + 一个蓝色强调**。颜色只用来表达状态（成功/失败/警告/强调），不做装饰。
2. **层级靠光，不靠边框**。表面之间的分隔用 1px 环形阴影（`0 0 0 1px var(--line)`）加多层极淡投影，不画实线边框。只有分隔条和列表行之间才用 `border-line`。
3. **密度高、字号小、读的地方放大**。界面 chrome 用 13px，消息正文用 14.5px。
4. **动效只回应变化**。新到达的内容才入场；加载历史、切换会话、重连回放都不播放入场动画。
5. **状态不只靠颜色**。每个状态都同时有图标或文字。

---

## 2. Token

全部定义在 `packages/web/src/styles/tokens.css`，`html.dark` 切换。Tailwind v4 用 `@theme inline` 把它们映射成 `bg-surface`、`text-ink-2`、`shadow-card` 这类语义类。组件里禁止写字面量颜色。

### 2.1 颜色

| Token | Light | Dark | 用途 |
|---|---|---|---|
| `--page` | `oklch(98.5% .001 286.376)` | `oklch(20.9% .004 264.477)` | 最底层 |
| `--canvas` | `oklch(96.1% .002 247.84)` | `oklch(23.1% .004 264.487)` | 次底层 |
| `--surface` | `oklch(100% 0 0)` | `oklch(26% .006 271.191)` | 卡片、Composer、弹层 |
| `--inset` | `oklch(97.9% .002 247.839)` | `oklch(24.3% .004 264.492)` | 卡片内凹区：代码、输出、详情 |
| `--field` | `oklch(96.1% .001 286.375)` | `oklch(29.3% .006 271.223)` | 用户气泡、chip、选中 tab |
| `--hover` | `oklch(97% .002 247.839)` | `oklch(28.9% .006 271.22)` | surface 上的悬停 |
| `--hover-2` | `oklch(93.3% .003 247.86)` | `oklch(31.8% .007 274.747)` | page/canvas 上的悬停 |
| `--ink` | `oklch(24.7% .006 258.361)` | `oklch(96.4% .002 247.839)` | 主文字、主按钮底 |
| `--ink-2` | `oklch(50.6% .01 264.477)` | `oklch(73.1% .008 260.731)` | 次文字（需要被读的元信息） |
| `--ink-3` | `oklch(69.5% .009 264.505)` | `oklch(54.1% .01 264.484)` | 图标、占位符、装饰性数字 |
| `--line` | `oklch(94.6% .003 264.542)` | `oklch(30.8% .006 258.354)` | 环形阴影、分隔线 |
| `--line-strong` | `oklch(91.2% .005 258.326)` | `oklch(35.6% .007 264.474)` | 聚焦边框、禁用按钮底、未选中控件描边 |
| `--accent` | `oklch(62.6% .205 254.947)` | `oklch(68% .173 253.301)` | 强调填充 |
| `--accent-ink` | `oklch(55.6% .187 255.617)` | `oklch(78.8% .113 248.33)` | 强调文字、链接、代码关键字 |
| `--accent-tint` | `oklch(96% .019 252.878)` | `oklch(68% .173 253.301 / .16)` | 强调浅底 |
| `--green` / `--green-tint` | `oklch(60.3% .155 150.883)` / `oklch(95.8% .017 159.118)` | `oklch(70.5% .154 153.814)` / `… / .14` | 成功、新增行 |
| `--orange` / `--orange-tint` | `oklch(68.9% .179 49.902)` / `oklch(96.4% .021 67.581)` | `oklch(74.6% .156 55.642)` / `… / .14` | 等待你操作、警告、重试 |
| `--red` / `--red-tint` | `oklch(62.1% .192 23.042)` / `oklch(95.6% .017 17.462)` | `oklch(66.6% .18 21.433)` / `… / .14` | 错误、删除行、拒绝 |
| `--green-ink` / `--orange-ink` / `--red-ink` | `oklch(51.8% .132 150.9)` / `oklch(54.9% .152 49.9)` / `oklch(54.6% .163 23)` | `oklch(78% .123 153.8)` / `oklch(80.6% .125 55.6)` / `oklch(77.6% .144 21.4)` | **文字**专用：放在 `*-tint` 底或 surface 上的状态色文字（药丸、横幅标题、blocker、+/− 计数）。两种主题下与 tint 对比都 ≥4.6:1 |
| `--accent-on-tint` | `oklch(53.6% .159 255.6)` | 等于 `--accent-ink` | `accent-tint` 底上的文字（"推荐" chip、强调药丸） |
| `--tooltip-bg` / `-fg` / `-muted` / `-border` | `oklch(27.2% .008 264.435)` / `oklch(97.6% .002 247.839)` / `oklch(73.1% .008 260.731)` / `oklch(35.6% .007 264.474)` | 同左 | 提示框（两种主题都是深色） |
| `--scrim` | `oklch(0% 0 0 / .28)` | `oklch(0% 0 0 / .5)` | 模态遮罩 |

语义别名（组件只用这一层）：

| 别名 | Light | Dark | 说明 |
|---|---|---|---|
| `--app-main` | `--page` | `--canvas` | 对话区背景 |
| `--app-side` | `--canvas` | `--page` | 侧边栏和右侧面板。两种主题下都比对话区"更远" |

对比度约束：`ink-3` 在两种主题下都低于 WCAG AA 正文要求，只能用于图标、占位符和可有可无的装饰数字。时间、路径、token 数这类需要读的元信息一律用 `ink-2`。`--green` / `--orange` / `--red` 放在自己的 tint 上时，亮色只有 2.7–3.5:1，暗色只有 3.1–3.8:1（半透明 tint 先叠到 surface 上再计算），所以只能用于图标、圆点、进度条和 diff 行首符号；凡是状态色**文字**一律用对应的 `*-ink`。本文下文写 "orange 文字""red 标题" 时，实现上都指 `*-ink`。

### 2.2 阴影与层级（"光影"）

| 级别 | Token | Light | Dark | 用在 |
|---|---|---|---|---|
| 0 | — | 无 | 无 | page、侧边栏、消息正文 |
| 1 | `--shadow-hairline` | `0 0 0 1px var(--line)` | 同左 | chip、inset 区、kbd、头像描边 |
| 1b | `--shadow-btn` | `0 0 0 1px var(--line-strong), var(--shadow-xs)` | `0 0 0 1px oklch(100% 0 0/.1), 0 1px 2px oklch(0% 0 0/.3)` | 次级按钮、文件 diff chip |
| 2 | `--shadow-card` | `0 0 0 1px var(--line), var(--shadow-sm)` | `0 0 0 1px oklch(100% 0 0/.11), 0 1px 2px oklch(0% 0 0/.2), 0 2px 6px oklch(0% 0 0/.2)` | 工具卡、代码块、审批卡、问卷卡、Composer |
| 3 | `--shadow-raised` | `0 0 0 1px var(--line), var(--shadow-md)` | `0 0 0 1px oklch(100% 0 0/.13), 0 2px 10px oklch(0% 0 0/.22)` | 下拉菜单、slash/@ 菜单、popover、toast、回到底部按钮 |
| 4 | `--shadow-overlay` | `0 0 0 1px var(--line), var(--shadow-lg)` | `0 0 0 1px oklch(100% 0 0/.15), 0 8px 28px oklch(0% 0 0/.34)` | 对话框、命令面板、抽屉 |

基础投影：

```css
--shadow-xs: 0 0 4px 0 #0000000a;
--shadow-sm: 0 18px 47px 0 #00000008, 0 7.5px 19px 0 #00000005, 0 4px 10.5px 0 #00000005,
             0 2.3px 5.8px 0 #00000003, 0 1.2px 3.1px 0 #00000003, 0 .5px 1.3px 0 #00000003;
--shadow-md: 0 17.54px 23.39px 0 #0000000a, 0 9.4px 12.5px 0 #00000008, 0 5.25px 7px 0 #00000005,
             0 2.79px 3.72px -2px #00000003, 0 1.16px 1.5px 0 #00000003;
--shadow-lg: 0 25px 50px 0 #0000000d, 0 12px 24px 0 #0000000a, 0 6px 12px 0 #00000008,
             0 3px 6px 0 #00000005, 0 1.5px 3px 0 #00000005;
--shadow-inset-field: inset 0 1px 2px oklch(0% 0 0 / .12);   /* dark: / .4 */
```

光的细节：
- **主按钮高光**：`background: var(--ink); color: var(--surface); box-shadow: inset 0 1px 0 rgba(255,255,255,.14)`。
- **聚焦环**：`:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--app-main), 0 0 0 4px color-mix(in oklch, var(--accent) 55%, transparent) }`。输入容器用 `focus-within` 把 `border-line` 换成 `border-line-strong`，不显示蓝环。
- **Composer 运行光**（全应用唯一的持续光效）：agent 运行时，Composer 外 1px 处有一圈 `conic-gradient` 光束，`from var(--beam-angle)`，颜色 `transparent 0 70%, color-mix(accent 70%) 85%, transparent 100%`，用 `@property --beam-angle` 在 2.4s 内线性转一圈，`opacity .55`。停止时 300ms 淡出。开启 reduced-motion 时不显示。
- **模型切换光扫**：切换模型成功后，Composer 内部背景上走一次斜向高光（`linear-gradient(105deg, transparent 40%, color-mix(accent 14%) 50%, transparent 60%)`，`background-position` 从 150% 到 -50%，600ms `ease-out-strong`），只播一次。
- 不使用 `backdrop-filter`（滚动性能），也不用彩色投影。

### 2.3 圆角

| Token | 值 | 用在 |
|---|---|---|
| `--radius-chip` | 6px | chip、行内按钮、菜单行、tooltip |
| `--radius-control` | 8px | 图标按钮、输入框、可点的行 |
| `--radius-card` | 10px | 卡片、代码块、popover |
| `--radius-window` | 14px | Composer、对话框、命令面板、抽屉内角 |
| 气泡 | 14px | 用户消息气泡 |
| 胶囊 | 999px | 状态药丸、计数徽标 |

嵌套规则：内层圆角 = 外层圆角 − 内边距（最小 4px）。

### 2.4 字体与字号

- 无衬线：`"Inter Variable", "PingFang SC", "Microsoft YaHei UI", "Noto Sans SC", system-ui, sans-serif`
- 等宽：`"JetBrains Mono Variable", "Cascadia Mono", ui-monospace, "SF Mono", monospace`
- 字体随包本地打包（`@fontsource-variable/inter`、`@fontsource-variable/jetbrains-mono`，OFL），不请求任何外部字体服务。
- 全局 `-webkit-font-smoothing: antialiased`；数字列一律 `tabular-nums`。

| 角色 | 字号 / 行高 / 字重 | 颜色 |
|---|---|---|
| 分组标签 | 10.5 / 1.3 / 500，大写，`tracking .08em` | ink-3 |
| 元信息、chip | 11.5 / 1.4 / 400–500 | ink-2 |
| 次要 UI | 12 / 1.45 | ink-2 |
| 工具行、列表 | 12.5 / 1.45 / 500 | ink |
| **UI 基准** | 13 / 1.4 | ink |
| **消息正文** | 14.5 / 1.65 | ink |
| 正文 h3 / h2 / h1 | 14.5 / 16 / 18，字重 600 | ink |
| 欢迎页标题 | 22 / 1.3 / 600，`tracking -.01em` | ink |
| 代码块 | 12.5 / 1.7 mono | 语法色 |
| 行内代码 | 0.9em mono，`bg-field`，内边距 1px 5px，圆角 5 | ink |
| 工具输出 | 11.5 / 1.6 mono | ink-2 |

设置中的「基准字号」按 12/13/14 通过 `--app-font-scale` 缩放所有像素文本（含消息正文），16px rem 根、间距和控件高度保持不变。

### 2.5 间距

4px 栅格。常用值：卡片内边距 12（`card-pad`），卡片标题栏 10/12（`card-bar`），卡片底栏 10，表格单元 10/12，图标按钮 28×28，行高 28（工具行）/ 32（菜单行）/ 36（slash 菜单行）/ 44（任务行）。消息之间 24，同一回合内的块之间 10。

---

## 3. 布局

```
┌ 侧边栏 264 ┬──────────── 对话区 ────────────┬ 右侧面板 340 ┐
│ app-side   │ 头部 44（透明，滚动后出现 1px line）│ app-side     │
│            │                                 │              │
│            │   内容列 max 760，左右 24 内边距    │              │
│            │                                 │              │
│            │   Composer（列宽，距底 16）        │              │
└────────────┴─────────────────────────────────┴──────────────┘
```

- 侧边栏宽 264，可拖拽 220–360。右侧面板宽 340，可拖拽 280–480。分隔是 1px `line`，拖拽手柄热区 6px，悬停时显示 2px `line-strong`。
- 对话区的内容列和 Composer 共用一个 760px 列，水平居中。
- Composer 浮在对话区底部，上方有 32px 从透明到 `app-main` 的渐变遮罩，滚动内容从下面淡出。
- 头部背景透明。对话滚离顶部后，底部出现 1px `line`（150ms 淡入）。
- 断点：≥1280 三栏；1024–1279 右侧面板变为覆盖式抽屉（overlay 阴影）；<1024 侧边栏也变抽屉，头部左侧出现菜单按钮。
- 面板开合动画：grid 轨道宽度与面板的 `translateX(±12px)` + 透明度同步做 220ms `ease-out-strong` 过渡（拖拽调宽时关闭过渡）。面板内容固定为面板宽度，不随轨道收缩重排；对话列居中，最大宽 760，随轨道宽度平滑移动。

---

## 4. 动效

### 4.1 曲线与时长

```css
--ease-out-strong: cubic-bezier(.23, 1, .32, 1);   /* 默认：入场、展开、移动 */
--ease-in-out-strong: cubic-bezier(.77, 0, .175, 1); /* 少用：两态切换 */
--ease-link: cubic-bezier(.16, 1, .3, 1);          /* 下划线 */
--ease-standard: cubic-bezier(.4, 0, .2, 1);       /* 颜色 */
```

| 时长 | 用途 |
|---|---|
| 100ms | 悬停底色、文字色 |
| 150ms | 聚焦边框、图标切换、tooltip 出现 |
| 180ms | 菜单、popover 弹出（`pop-in`，`transform-origin` 指向触发点） |
| 200–250ms | chip 入场、按钮按压回弹、面板滑入 |
| 220ms | 侧边栏悬停高亮块滑动（top/height） |
| 300ms | 行展开、卡片入场（`fade-up`） |
| 400ms | 思考轨迹展开、卡片状态折叠为回执 |
| 480ms | 单选问卷自动翻页的等待 |

### 4.2 Keyframes（全集，组件不得自定义新的）

```css
@keyframes fade-up   { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: none } }
@keyframes fade-in   { from { opacity: 0 } to { opacity: 1 } }
@keyframes pop-in    { from { opacity: 0; transform: scale(.95) } to { opacity: 1; transform: none } }
@keyframes spin      { to { transform: rotate(1turn) } }
@keyframes shimmer-text { 0% { background-position: 150% } to { background-position: -50% } }
@keyframes pixel-on  { 0%, to { opacity: .15 } 18%, 42% { opacity: 1 } 62% { opacity: .15 } }
@keyframes eq-bounce { 0%, to { transform: scaleY(.35) } 50% { transform: scaleY(1) } }
@keyframes caret-blink { 50% { opacity: 0 } }
@keyframes shake     { 0%, to { transform: none } 20% { transform: translateX(-4px) } 40% { transform: translateX(4px) }
                       60% { transform: translateX(-2px) } 80% { transform: translateX(2px) } }
@keyframes check-draw { from { stroke-dashoffset: 24 } to { stroke-dashoffset: 0 } }
@keyframes pulse-dot { 0%, to { opacity: 1 } 50% { opacity: .35 } }
@keyframes beam      { to { --beam-angle: 360deg } }
```

### 4.3 固定的动效语法

- **展开/折叠**：外层 `display: grid; grid-template-rows: 0fr ↔ 1fr` 加 `opacity 0 ↔ 1`，内层 `overflow: hidden`，300–400ms `ease-out-strong`。禁止直接给 `height` 做动画。
- **列表入场**：`fade-up 300ms`，相邻项错开 80ms，最多错开 5 项，后面的同时出现。
- **悬停高亮块**：侧边栏、菜单、命令面板都用一个绝对定位的 `bg-hover` 块，跟随悬停项移动 top/height（220ms）。各行自己不再画悬停底色。
- **按压**：按钮 `active:scale(.96)`，Composer 内图标按钮 `.94`，200ms 回弹。
- **图标交换**：两枚图标叠放，交叉淡化 + `scale(.8 ↔ 1)`，150ms（复制 → 已复制、发送 → 停止、行图标 → 展开箭头）。
- **数字变化**：花费、计数、上下文百分比变化时，新数字 `pop-in 250ms`，用 `key` 触发，不做滚动数字。
- **成功**：绿色圆底 `pop-in 300ms`，里面的勾 `check-draw 300ms`，延迟 80ms。
- **错误**：错误条出现时整块 `shake 360ms` 一次。表单校验失败也用同一个。
- **流式文字**：已提交的文本正常渲染；只有最后约 24 个字符包进 `.stream-tail`（`filter: blur(1.6px)` 加从左到右的透明蒙版），后面跟一个 2px 宽、1.05em 高的光标 `.stream-caret`。流式期间光标不闪；完成后光标 150ms 淡出，tail 去掉蒙版。不做逐词 span 动画，长回复不会产生几千个节点。
- **微光文字**：表示"进行中"的标签（思考中、运行 bash…）用 `shimmer-text`：`linear-gradient(90deg, ink-3 35%, ink 50%, ink-3 65%)`，`background-size 200%`，1.4s 线性循环，`background-clip: text`。完成后换成 ink-2 静态文字，`fade-in 350ms`。
- **不播动画的情况**：冷启动加载历史、切换会话、重连回放、虚拟列表回收后重新挂载。实现上，每条消息带 `animateOnMount`，只有 reducer 处理实时帧时才置为 true。

### 4.4 减少动态效果

```css
@media (prefers-reduced-motion: reduce) {
  *, ::before, ::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important;
                         transition-duration: .01ms !important; }
  .stream-tail { filter: none; mask-image: none; }
}
```

另外：像素网格停在暗态，计时数字照常走；Composer 运行光与模型光扫不显示；微光文字改为静态 ink-2。

---

## 5. 图标

- `lucide-react`（ISC，锁定版本），描边与 Beautiful UI 的内联 SVG 一致：24 栅格，`stroke-linecap/linejoin: round`。
- 尺寸与线宽：行内 13px / 2，操作按钮 15px / 1.8，主按钮 16px / 2.4，chevron 12–14px / 2.2。
- 颜色默认 `ink-3`，悬停 `ink-2`，激活 `ink`。
- 工具图标映射：read `FileText`、write `FilePlus`、edit `PenLine`、bash `TerminalSquare`、python `Code2`、grep/find `Search`、glob `FolderSearch`、lsp `Braces`、web_search `Globe`、browser `AppWindow`、task `Bot`、todo `ListChecks`、ask `MessageCircleQuestion`、notebook `NotebookPen`、mcp `Plug`、其他 `Wrench`。思考用实心四角星（Beautiful UI 的 sparkle path，填充 currentColor）。
- 空状态插图：Koboyo 手绘 SVG，最多 3 枚（欢迎页、无会话、搜索无结果），48px，`ink-3`，作为本地资源随包发布，在 `THIRD-PARTY-NOTICES` 中注明来源与许可链接。

---

## 6. 组件规格

格式：结构 → 尺寸/样式 → 状态 → 动效。所有组件在两种主题下用同一份代码。

### 6.1 侧边栏 `Sidebar`

- 背景 `app-side`，内边距 8。
- **顶部行**（高 44）：左边 28×28 圆角 8 的 `ink` 方块，内含 "π"（surface 色，13/600）；右边 "omp" 13/500 和版本号 11.5 ink-2；最右是折叠按钮（`PanelLeft` 图标按钮）。
- **新对话**：整行按钮，高 32，文字 13/500 `accent`，右侧 16px 圆形 `accent` 底白色加号，悬停 `bg-accent-tint`，按压缩放。快捷键提示 `Ctrl N` 用 kbd 样式，只在悬停时出现。点击**不弹窗**：直接切到欢迎页（`currentSessionId = null`），项目沿用上次使用的项目，焦点进入 Composer。所有新会话参数都在 Composer 四周设置（§6.12）。
- **搜索**：高 32，`bg-inset` + hairline，圆角 8，放大镜 12px ink-3，占位符 "搜索会话"，右侧 kbd `Ctrl K`。
- **分组**：标签 10.5 大写 ink-3，左右内边距 8，上 12 下 4，悬停时右侧出现折叠箭头和 "+"（切到欢迎页并把项目预选为该组的 cwd）。
  - 每个分组默认只展示最近 5 条会话（当前会话即使更早也保持可见）；超出时底部显示「展开显示更多（还有 N 条）」，展开后变为「收起」。分组收起再展开会回到默认短列表；搜索时展示全部匹配项。
- **会话行**：高 32，圆角 7，左右内边距 8。左侧 14px 状态位，中间标题 13（当前会话 500 ink，其余 ink-2），右侧相对时间 11.5 ink-2（悬停时换成 ⋯ 按钮）。
  - 状态位：空闲不显示；运行中是 3×3 像素网格（单元 3px、间距 1px，`Drive` 节奏）；等待你操作是 6px `orange` 圆点加 `pulse-dot 1.6s`；出错是 6px `red` 圆点；未读完成是 6px `accent` 圆点。
  - 当前会话：悬停高亮块停在该行，底色 `bg-hover-2`。
- **底部**：设置、诊断两个图标按钮，加一个 omp 连接状态点（绿色已连接 / 橙色重连中）。
- 动效：悬停高亮块滑动（§4.3）；新会话插到分组顶部时 `fade-up`；状态位切换 150ms 交叉淡化。

### 6.2 头部 `SessionHeader`

- 高 44，左右内边距 16，背景透明。
- 左：会话标题 13/500，最大宽 40%，双击原地变输入框（无边框，底部 1px `line-strong`）；后接 cwd chip（mono 11.5 ink-2，`bg-field`，hairline，圆角 6，高 22，路径中间截断）。
- 右（间距 4）：状态 chip（来自 `setStatus`，11.5 ink-2）、上下文环、花费、⋯ 菜单、右侧面板开关。
- **上下文环**：18px SVG，线宽 2，轨道 `line`，进度 `ink-3`；≥80% 进度色变 `orange`，≥95% 变 `red` 且旁边显示百分比数字。悬停弹出 raised popover，显示 tokens / 窗口 / 百分比和「压缩」按钮。
- **花费**：mono 12 ink-2 tabular，例如 `$0.42`；悬停 tooltip 显示 tokens 明细。

### 6.3 欢迎页 `EmptySession`

- 内容列垂直居中，位置略偏上（距顶 32vh）。
- Koboyo 插图 48px ink-3 → 间距 16 → 标题 "今天做点什么？" 22/600 → 间距 24 → Composer（带上下文条，§6.12；此时不浮动）。不再单独显示 "在 X 中" 项目行，项目由上下文条承担。
- 欢迎页隐藏右侧面板（没有会话就没有待办/变更可看）。头部只显示标题 "新对话"，没有 cwd chip、上下文环、花费和 ⋯ 菜单。
- 下方 3 条建议，结构参照 Beautiful UI 的 Follow-ups：行高 32，左侧回车箭头 11px ink-3，文字 12.5 ink，行间 `border-b line`，入场错开 90ms。建议内容来自该项目最近的 3 条用户提示；没有历史时用固定文案（"解释这个仓库的结构"、"找出并修复失败的测试"、"审查未提交的改动"）。

### 6.4 用户消息 `UserMessage`

- 右对齐，左侧至少留 64px。气泡 `bg-field`，圆角 14，内边距 8/14，正文 14.5/1.65，保留换行。
- 图片：气泡上方一行 64×64 缩略图，圆角 8，hairline，点击放大（overlay dialog，`pop-in`）。
- `@` 文件：气泡上方的文件 chip（`FileText` 12px + 文件名 mono 11.5）。
- 悬停：气泡下方右对齐出现操作行（复制、编辑并重来、分叉），24px 图标按钮，150ms 淡入。
- 已发送但还没收到 `message_end`：整体 `opacity .6`。
- 动效：`fade-up 300ms`，同时从 `translateY(10px)` 进入。

### 6.5 助手回合 `AssistantTurn`

一个回合 = 一条 assistant 消息 + 它的工具结果 + 后续同一轮内的 assistant 消息，直到下一条 user 消息。从上到下：

1. **思考块** `Thinking`（结构参照 Beautiful UI 的 ThinkingState）
   - 头部按钮：sparkle 16px（进行中 ink-2，完成后 ink-3）+ 标签 13/500 + chevron 14px。进行中标签为 "思考中"（微光文字），完成后为 "思考了 7 秒"（ink-2，`fade-in`）。
   - 展开区：左侧 1px `line` 竖线（距左 3px，竖线高度随内容 500ms 增长），内容左内边距 16，正文 12.5/1.65 ink-2。
   - 流式中自动展开，只显示最后 3 行（上方 24px 渐隐蒙版）；完成后 400ms 后自动折叠。用户手动切换后不再自动开合。
   - `redactedThinking` 显示为 "已隐藏的思考"，不可展开。
2. **正文** `Prose`：Markdown，14.5/1.65。段落间距 0.75em；列表缩进 1.25em，标记色 ink-3；引用块左侧 2px `line-strong`，文字 ink-2；表格放在 card 里，表头 12/500 ink-2，单元 10/12，行间 `border-line`，可横向滚动；链接 `accent-ink`，悬停出现 `.animated-underline`；分隔线 1px `line`，上下 24。
3. **工具组** `ToolRun`（结构参照 Beautiful UI 的 ToolChips）
   - 一个回合里连续的工具调用放进一组。组头是折叠按钮："12 个工具调用 · 3 个文件"，12.5 ink-2，chevron 12px（展开 0°，折叠 −90°）。运行中默认展开；回合结束后，超过 4 行的组自动折叠。
   - **工具行**：高 28，左右内边距 3，圆角 8，悬停 `bg-hover-2`。依次是 16px 图标位（悬停时图标淡出、箭头淡入）、标签 12.5/500 ink、chip。
     - 标签：动词 + 对象，例如 "读取"、"编辑"、"运行"、"搜索"、"子代理 explore"。
     - chip：高 22，圆角 6，`bg-hover-2`（dark 下 `bg-field`），hairline，11.5，文件路径和命令用 mono，可截断，flex-1。
     - 行尾：耗时 11.5 ink-2 mono；edit/write 行显示 `+74 −41`（green/red mono 11）。
   - 行状态：
     - 运行中：图标位换成 12px 环形 spinner（1.5px `line-strong` 边，顶边 `ink-2`，700ms 旋转），标签用微光文字。
     - 成功：普通样式。
     - 失败：图标换成 `red` 的 `X`，标签 `red`，自动展开详情。
     - 被拒绝：图标换成 `ink-3` 的 `Ban`，标签加删除线，chip 降到 `opacity .55`。
     - 等待审批：图标换成 `orange` 的 `ShieldAlert`，带 `pulse-dot`，下方紧跟审批卡（§6.7）。
   - **行详情**（点击展开）：左缘 `ml-2`，`border-l line`，左内边距 14，上下 2。内容按工具渲染（§6.6）。
   - **连续只读折叠**：≥3 个连续的 read/grep/glob/find/lsp 合并为一行 "查看了 5 个文件"，展开后是子行。
   - **文件变更 chips**：回合结束且有文件改动时，组下方加一条分隔（`border-t line`，上 10），然后是 chips：高 28，圆角 6，`bg-surface`，`shadow-btn`，文件名 mono 11.5 + `+n` green + `−m` red，`pop-in` 错开 80ms。最多 4 个，其余合并为 "+N 个文件"（ink-3，悬停出现下划线）。点击 chip 打开右侧面板的「变更」页并定位到该文件。
4. **操作行**：回合结束后 400ms 淡入。依次是复制、重试、分叉三个 24px 图标按钮；右侧是模型名 · tokens · 耗时，11.5 ink-2，只在悬停时显示。

### 6.6 工具详情渲染

| 工具 | 详情样式 |
|---|---|
| bash | `bg-inset` 圆角 8 hairline 的面板。首行 `$ command`（mono 11.5 ink），下面是输出（mono 11.5/1.6 ink-2），最高 320px，可滚动。运行中实时追加，自动贴底。右上角有退出码药丸：0 用 `green-tint/green`，非 0 用 `red-tint/red`。超过 500 行时底部显示 "显示全部 2,341 行"。 |
| read | 第一行是路径和行范围（11.5 ink-2）；下面是 CodeBlock（无标题栏，最高 240px）。 |
| edit / write / notebook | DiffView（§6.9）。 |
| grep / glob / find | 结果列表，行高 24。路径 mono 11.5 ink；grep 的匹配行跟在后面，命中部分用 `accent-tint` 底；最多 20 条，其余显示 "+N"。 |
| web_search | 来源列表，结构参照 Beautiful UI 的 Search 变体：14px 彩色圆点 + 标题 12.5/500（悬停下划线）+ 域名 mono 11.5 ink-2，可点击。 |
| browser | 截图缩略图，最大宽 100%，圆角 8，hairline；下面是动作文本。 |
| task | SubagentRow（§6.13），嵌在详情里。 |
| todo | 一行摘要："完成 2 项 · 新增 1 项"，加 "在面板中查看" 链接。 |
| 通用 | 参数表（键 mono 11.5 ink-2 / 值 mono 11.5 ink）+ 结果文本（mono 11.5 ink-2）。JSON 值可折叠。 |

### 6.7 审批卡 `ApprovalCard`（工具权限）

- 位置：在等待审批的工具行下方，与行的左缘对齐，宽度与内容列一致。
- 卡片：`bg-surface`，`shadow-card`，圆角 10，`overflow-hidden`。
- 顶部倒计时条（只在有 `timeout` 时出现）：2px 高，`accent`，`transform-origin: left`，`scaleX` 从 1 线性降到 0。
- 内容（内边距 12）：
  - 第一行：`ShieldAlert` 14px orange + "允许运行 **bash**？" 13/500，工具名用 mono chip；右侧是 MCP 来源标签（如有）。
  - 原因（如有）：12 ink-2，上间距 4。
  - 详情：`bg-inset` 圆角 8 hairline，内边距 8/10，mono 11.5/1.6 ink，最多 12 行，超出部分渐隐并显示 "展开"。
- 底栏（`border-t line`，内边距 10，两端对齐）：
  - 左：复选框 "本会话总是允许 bash"（16px 方框，圆角 5，未选是 `inset 0 0 0 1.5px line-strong` 描边，选中是 `bg-ink` 加 canvas 色勾，200ms），12.5 ink-2。
  - 右：「拒绝」次级按钮（高 28，内边距 10，`bg-surface`，`shadow-btn`，12.5/500，kbd `Esc`），「允许」主按钮（ink 底 + 高光，kbd `Enter`，kbd 用 `bg-white/15`）。
- 键盘：卡片出现时获得焦点（`role="alertdialog"`，`aria-labelledby` 指向第一行），Enter 允许，Esc 拒绝。卡片不会抢走 Composer 里正在输入的焦点：用户正在打字时只播报，不移动焦点。
- 入场：`fade-up 300ms`。同时，对话列如果停在底部，就平滑滚动让卡片完整可见。
- 处理后：400ms 内用 grid-rows 收起为一行回执，并入工具行下方："✓ 已允许"（green 勾 `pop-in`）或 "已拒绝"（red），12 ink-2。"总是允许" 自动通过的显示为 "自动允许"（ink-3）。

### 6.8 问卷卡 `AskCard`（`ask` 工具）

完全沿用 Beautiful UI ApprovalCard 的交互语法：

- 卡片宽 = 内容列，`shadow-card`，圆角 10。
- 一次显示一题（`fade-up 350ms`，`key` 为题号）。头部是题目 13/500，有 `header` 时在上方显示 10.5 大写的 header 标签；右上角是关闭按钮（等同于取消）。
- 选项行：高 28，圆角 8，悬停 `bg-hover`。左侧 16px 控件：单选为圆形，选中后实心 ink，内部 6px canvas 圆点 `scale(0→1)` 200ms；多选为圆角 5 的方框，选中后 ink 底加勾。选项文字 13，未选 ink-2，选中 ink。
  - `recommended` 那项在文字后加 chip "推荐"（`accent-tint`，`accent-ink`，11，高 18，圆角 999）。
  - 有 `preview` 的选项，右侧出现 "预览" 小按钮，点击后在该行下方用 grid-rows 展开 `bg-inset` mono 11.5 预览。
  - `description` 显示在选项文字下方，12 ink-2。
- 末行是自由输入："输入其他答案…"（无边框，13，前面留 16px 空位与控件对齐）。单选题输入文字时清空已选项。
- 底栏：左边是 ‹ 页码点 ›（当前题 9px 环，已答 7px 实心 ink-3，未答 7px 空心环），右边是 28px 圆角 8 的发送按钮：有答案时 ink 底加高光，没有时 `bg-field` 加 `shadow-btn`；最后一题图标是 ↑，其余是 →。
- 单选题选中后 480ms 自动翻到下一题；多选题需要点 →。
- 提交后：绿色勾 `pop-in` + "已发送回答" `fade-up`（延迟 100ms），1.2s 后用 grid-rows 收起成答案摘要（每题一行："问题 · 答案"，12 ink-2）。
- 超时：倒计时条同审批卡；到时间后摘要标注 "已按推荐答案继续"。

### 6.9 差异视图 `DiffView`

- 卡片（`shadow-card`，圆角 10）。标题栏（`card-bar`，`border-b line`）：文件图标 + 路径 mono 12/500 ink（目录部分 ink-2）+ `+74 −41` + 右侧切换 "合并/并排"（segmented，高 24）和复制按钮。
- 正文 `bg-inset`，mono 12/1.7。行号两列，各宽 40，右对齐 11 ink-3（60% 不透明度）。
  - 新增行：`bg-green-tint`，行首 `+` green，文字 ink。
  - 删除行：`bg-red-tint`，行首 `−` red，文字 ink-2。
  - 上下文行：ink-2。
  - hunk 头：`bg-field`，mono 11.5 ink-2，高 24。
- 未改动区段折叠为 "⋯ 显示 38 行未改动"（高 24，点击展开）。
- 并排模式：中间 1px `line` 分隔，左右各一列。
- 语法高亮叠加在 diff 底色之上（shiki，见 §6.10），新增/删除行不改语法色。

### 6.10 代码块 `CodeBlock`

- 卡片（`shadow-card`，圆角 10）。标题栏：文件名或语言 mono 12/500 ink + 语言名 11.5 ink-2；右侧复制按钮（高 24，图标 + "复制"，11.5/500 ink-2；点击后变为 green 勾 + "已复制"，1.5s 后恢复）和换行开关。
- 正文 `bg-inset`，内边距 10/12，mono 12.5/1.7，超过 5 行显示行号（ink-3 60%）。最高 480px，超出后可滚动，底部有 "展开" 按钮。
- 流式中：最后一行末尾显示 3px `accent` 光标；新行 `fade-up 250ms`。
- shiki 主题 `omp-light` / `omp-dark` 由 token 生成，不使用内置主题：

| 作用域 | 颜色 |
|---|---|
| keyword, storage, modifier | `--accent-ink` |
| string, regexp | `--green` |
| number, constant, boolean | `--orange` |
| function, method, class | `--ink` |
| comment | `--ink-3`，斜体 |
| punctuation, operator | `--ink-3` |
| variable, 默认 | `--ink-2` |
| tag, attribute | `--accent-ink` / `--orange` |
| deleted / inserted（diff 语言） | `--red` / `--green` |

### 6.11 运行指示 `RunIndicator`

- 放在对话末尾，位于最后一块内容下方 12px，左对齐。
- 结构参照 Beautiful UI 的 LoadingState：3×3 像素网格（单元 4px，间距 1.5px，`ink`，静止不透明度 .15，`pixel-on` 650ms，Drive 波前延迟 `(列 + |行 − 1|) × 90ms`）+ 微光标签 13/500 + 计时 mono 12 ink-2（`12.4s` → `1m 03.2s`）。
- 标签由状态决定：

| 状态 | 标签 | 网格 |
|---|---|---|
| 等待首个 token | "思考中" | Drive |
| 有工具在运行 | "运行 bash" / "编辑 server.ts"（取最近一个运行中的工具） | Drive |
| 子代理在运行 | "3 个子代理在工作" | Orbit（周长单元依次点亮，950ms） |
| 压缩上下文 | "压缩上下文" | Dots |
| 自动重试 | "重试 2/5 · 4s" | 静止 + orange 标签，无微光 |
| 等待你 | "等待你的回应" | 静止，标签 orange |

- 运行结束：整行 150ms 淡出。计时归零。

### 6.12 Composer

布局参照 Codex / Claude 桌面端：**会话级设置全部贴着输入框**，不使用弹窗。结构从上到下是「上下文条」+「输入卡」。

```
┌ 上下文条（只在欢迎页） ─────────────────────────────┐
│ 📁 omp-ui ▾                                          │
├ 输入卡 ─────────────────────────────────────────────┤
│ 给 omp 发消息，@ 引用文件，/ 运行命令                  │
│                                                      │
│ +  ⓘ 仅写操作 ▾                    opus-5.5 高 ▾  (↑) │
└──────────────────────────────────────────────────────┘
```

- **上下文条**（只在欢迎页，也就是即将新建会话时显示；进入会话后 cwd 已固定，显示在头部 cwd chip，不再显示此条）：
  - 位于输入卡正上方，与输入卡同宽，`bg-field`，圆角 `14 14 0 0`，高 40，左右内边距 14；输入卡向上叠住它的下缘 10px（输入卡 `z-index` 更高、`margin-top: -10px`），视觉上是一个底托。
  - 内容：项目按钮——`Folder` 图标 15 + 项目名 13/500 ink + chevron 11 ink-3；未选项目时为 "选择项目"（ink-2）。悬停 `bg-hover-2`，圆角 8，高 28，内边距 0/8。
  - 点击打开项目菜单（§6.14 项目菜单）。
- **输入卡**：`bg-surface`，1px `border-line`，`shadow-card`，圆角 16，内边距 10/12/8/12，`isolate overflow-hidden`。聚焦时边框变为 `line-strong`（150ms）。固定两行，不再做单行/多行切换：
  1. 附件行（有附件时出现）：chip 高 26，`bg-field`，hairline，圆角 6，图标 12 + 名字（最大宽 144）+ 16px ×；图片用 20px 缩略图。`pop-in 200ms`。
  2. textarea：14/22px，最小高度 44（两行），最大 40vh，无边框无聚焦环，占位符 "给 omp 发消息，@ 引用文件，/ 运行命令"。
  3. 控件行，高 32，`justify-between`：
     - 左：`+` 附件按钮（28，图标 18）→ **权限 chip**。
     - 右：**模型·思考按钮** → 发送按钮。
- **权限 chip**（对应 `--approval-mode`，DESIGN §7.4）：高 28，内边距 0/8，圆角 8，图标 15 + 文字 13/500，悬停 `bg-hover`。三档：

  | 模式 | 文字 | 图标 | 颜色 |
  |---|---|---|---|
  | `always-ask` | 每次询问 | `ShieldCheck` | ink-2 |
  | `write` | 仅写操作 | `Shield` | ink-2 |
  | `yolo` | 完全访问 | `ShieldAlert` | `orange-ink`（图标 `orange`），提醒风险 |

  点击打开权限菜单（§6.14）。欢迎页选择的值作为新会话启动参数。会话中修改：若会话空闲，选择后立即用新参数重启进程（`stop` + `start(resume)`），chip 内显示 12px spinner 直到 `ready`，期间输入卡禁用；运行中时菜单项禁用并提示 "运行结束后可切换"。不再弹确认框——重启只是换启动参数，会话历史不受影响；菜单底部写明 "切换会重启会话进程"。
- **模型·思考按钮**（合并为一个，参照 Codex）：高 28，内边距 0/8，圆角 8，模型短名 13/500 ink + 思考级别 13 ink-2（"高"、`auto` 时 "自动"）+ chevron 11 ink-3。点击打开模型菜单（§6.14），思考级别在同一菜单底部。`Ctrl+M` 打开，`Ctrl+T` 循环思考级别不变。无会话时显示 `config.defaultModel` 的短名，没有则 "选择模型"。
- **发送按钮**（32×32，圆形）：
  - 空闲无内容：`bg-line-strong`，ink-2 ↑，禁用。
  - 空闲有内容：`bg-ink`，surface 色 ↑，带高光。
  - 运行中无内容：`bg-ink`，surface 色 ■（10px 圆角 2），表示停止。
  - 运行中有内容：`bg-ink`，↑；左侧出现 "插话 ▾" 文字按钮（13/500 ink-2），下拉为 插话（Enter）/ 完成后发送（Alt+Enter）/ 打断并发送（Ctrl+Enter）。
  - 图标切换用 §4.3 交叉淡化。
- **Shell 模式**（首字符 `!`）：textarea 改为 mono；权限 chip 位置换成 `orange-tint` 底的 `$ Shell` chip；占位符 "运行 shell 命令"。
- **运行光**：见 §2.2（光束跟随输入卡圆角 16）。
- 底部提示行（输入卡外下方 6px，11.5 ink-2，居中）：只在运行中且有输入时显示 "Enter 插话 · Alt+Enter 完成后发送 · Ctrl+Enter 打断"。
- 不做语音输入按钮（`live_*` 在 M6）。

### 6.13 子代理 `SubagentRow` / 任务行

结构参照 Beautiful UI 的 TaskRows。

- **胶囊变体**（嵌在 task 工具详情里）：每个子代理一张卡（`bg-surface`，`shadow-card`），高 44，折叠时圆角 22，展开时 300ms 过渡到 14。
  - 左侧 24px 状态徽标：运行中是 SpinnerRing（24px，线宽 2，轨道 `line`，28% 弧段 `ink-3`，1.1s 旋转，中间是序号 10.5/600）；完成是 22px green 圆底白勾 `pop-in`；失败是 red 圆底白 ×；中止是 ink-3 圆底。
  - 代理名 13/500 + 描述 12.5 ink-2（截断）+ 右侧进度元信息（如 "12 轮 · 34k"）mono 11.5 ink-2 + 状态药丸（完成 `green-tint/green`，失败 `red-tint/red`，高 22）+ chevron。
  - 展开：左侧 24px 列中有 1px 竖线，右侧是进度明细行（12 ink-2 + mono 11.5 ink-2 值），每行 `fade-up` 错开 100ms；底部有 "查看完整记录" 链接，点击打开子代理抽屉。
- **列表变体**（右侧面板）：同一套行，放在一张卡里，行之间 `border-b line`，没有胶囊圆角。

### 6.14 菜单与浮层

- **slash / @ 菜单**：绝对定位在 Composer 上方 8px，宽度与 Composer 相同，`bg-surface`，`shadow-raised`，圆角 10，内边距 4，`pop-in 180ms`（`transform-origin: bottom center`），最高 320px。
  - 行高 36，圆角 6：22px 图标位（ink-2）+ 名称 12.5/500 ink + 描述 12 ink-2（截断）+ 右侧来源标签（11 ink-2，"技能"/"扩展"/"MCP"）。
  - @ 菜单的行：文件图标 + 文件名 12.5/500 + 目录 mono 11.5 ink-2。
  - 悬停/键盘选中使用滑动高亮块。
  - 底栏：`border-t line`，11 ink-2："↑↓ 选择 · Enter 确认 · Esc 关闭"。
  - 无结果："没有匹配的命令"，行高 36，ink-2。
- **模型菜单**（含思考级别）：宽 300，靠按钮右侧对齐，`transform-origin: bottom right`。从上到下：`usageLimit` 警示行（如有，`orange-tint`）→ 搜索框（高 32，无边框，`border-b line`）→ 二级列表，最高 320 可滚动：一级是 provider 行（行高 30，名称 12.5/500 + 当前模型名 11 ink-2（如有）+ 模型数 mono 11 ink-3 + `ChevronRight`）；点进后是返回行（`ChevronLeft` + provider 名 11 大写 ink-3）+ 行高 30 的模型行（模型名 12.5/500 + 标签 11 ink-2：上下文窗口 "200k"、图片图标；当前模型右侧打勾）。打开时直接进入当前模型的 provider；只有一个 provider 时不显示一级；搜索词非空时跨 provider 平铺，分组标签 10.5 大写 → `border-t line` 分隔 → **思考级别**：标签 10.5 大写 "思考" + 一行 segmented（高 28，各档等宽，选中 `bg-field` ink，未选 ink-2；选项来自 `get_available_thinking_levels`，外加 "自动"）→ fast/slow 开关行（开关 28×16，开 `bg-ink`、关 `bg-line-strong`，滑块 12px `surface`，200ms；只在支持时显示）。选模型后菜单不关闭（方便接着调思考），点外部或 Esc 关闭。
- **权限菜单**：宽 280，靠权限 chip 左侧对齐，`transform-origin: bottom left`。三行，每行高 52、圆角 8、内边距 8/10：图标 15 + 名称 13/500 + 说明 12 ink-2（每次询问："所有需要权限的工具都先问你"；仅写操作："读取自动允许，修改文件和执行命令前先问"；完全访问："所有工具直接执行，不再询问"，此行名称用 `orange-ink`）。当前项右侧打勾。底部 `border-t line` 11.5 ink-2：会话中显示 "切换会重启会话进程，历史不受影响"；欢迎页显示 "作用于这次新建的会话"。
- **项目菜单**：宽 320，靠项目按钮左侧对齐，向下展开（`transform-origin: top left`）。顶部搜索框（高 32，`border-b line`，按名称和路径模糊过滤）→ "最近" 分组：行高 36，`Folder` 图标 + 项目名 12.5/500 + 路径 mono 11.5 ink-2（中间截断）+ 当前项打勾，最多 8 条，来自 `projects` 按最近使用排序 → `border-t line` → 「选择文件夹…」行（`FolderOpen` 图标，调 `/api/pick-dir`；返回 501 时把搜索框切换为路径输入模式，回车确认，校验目录存在）。
- **⋯ 菜单 / 右键菜单**：宽 220，行高 30，图标 15 + 文字 12.5 + 右侧 kbd。危险项（删除）用 red 文字，悬停 `bg-red-tint`。分隔线 1px `line`，上下各 4。
- **Tooltip**：`bg-tooltip-bg`，`text-tooltip-fg`，1px `tooltip-border`，11.5，内边距 4/8，圆角 6；内含 kbd 时 kbd 用 `tooltip-muted`。悬停 400ms 后出现，`fade-in 150ms`，不跟随鼠标。
- **kbd**：最小宽 18，高 18，内边距 0/4，圆角 5，`bg-surface`，hairline，10.5 ink-2 mono。

### 6.15 对话框 `Dialog` 与命令面板

- 遮罩 `--scrim`，`fade-in 180ms`；关闭时 120ms 淡出。
- 对话框：`bg-surface`，`shadow-overlay`，圆角 14，宽 440（编辑器类 640），内边距 16。标题 14/600，描述 12.5 ink-2，底部按钮右对齐，间距 8。入场 `pop-in 180ms`（从 `scale(.96)` 开始），关闭 120ms 淡出加 `scale(.98)`。
- select 对话框：选项行高 32，`description` 作为第二行 12 ink-2，滑动高亮块，Enter 选中。
- 删除确认：标题为 "删除这个会话？"，正文显示文件路径（mono 11.5 inset 块）并说明 "会移到回收目录，30 天后清除"；确认按钮是 `bg-red` + 白字。
- **命令面板**（Ctrl K）：宽 560，距顶 18vh，圆角 14，`shadow-overlay`。输入行高 44（放大镜 + 13px 输入 + 清除按钮），下面 `border-b line`；结果分组（"会话"/"操作"/"模型"），行高 32，左侧图标，右侧 kbd；无结果时显示 Beautiful UI Search 的空状态（32px inset 方块图标 + "没有结果" 13/500 + "换个关键词试试" 12 ink-2）。

### 6.16 右侧面板 `SidePanel`

- 背景 `app-side`。顶部 tab 条高 44，内边距 6：tab 按钮内边距 3/8，圆角 6，13，选中 `bg-field` ink，未选 `opacity .5`，悬停 `.75`。Tab 依次为 待办 / 子代理 / 变更 / 目标 / 信息；有新内容的 tab 右上角显示 6px accent 点。
- **待办**：TaskRows 列表变体。phase 名作为分组标签。状态徽标：completed 是 green 勾（文字 ink-2）；in_progress 是旋转的 SpinnerRing；pending 是静止的 SpinnerRing 加序号；blocked 是 orange 圆底 `!`，下方附 blocker 文本 12 orange；abandoned 是 ink-3 圆底 `–`，文字加删除线。双击文字原地编辑；底部有「添加」行（`Plus` 图标 + 文字，文字不再带 "+"）。列表在 `todo` 工具的 `tool_execution_end` 到达时直接取 `result.details.phases` 更新，不等 `get_state`。
- **子代理**：§6.13 列表变体。
- **变更**：顶部一行 segmented 口径：「本会话 / 最近一轮 / 未暂存 / 已暂存」，下方 11.5 ink-2 说明当前口径与合计 `+n −m`；git 口径右侧有刷新按钮。按文件列出，每行高 32：文件图标 + 路径（mono 12，目录 ink-2）+ 状态徽标（git 口径）+ `+n −m`，点击用 grid-rows 展开该文件合并后的 DiffView；会话口径可定位到对应工具卡。
- **目标**：无目标时显示表单卡（目标 textarea + token 预算 number 输入 + 「开始」主按钮）。有目标时显示目标卡：objective 13 ink；状态药丸；预算进度条（高 4，圆角 999，轨道 `bg-field`，填充 `accent`，≥90% 变 orange，宽度变化 400ms）；"已用 34k / 100k · 12 分钟"（mono 11.5 ink-2）；按钮 暂停 / 恢复 / 放弃。
- **信息**：键值列表，行高 28，键 12 ink-2，值 mono 12 ink，可复制。系统提示词与工具列表放在折叠区里。
- 面板内容区的内边距为 12，卡片之间间距 8。

### 6.17 横幅、错误、通知

- **对话内横幅**（重试、进程退出、致命错误）：内容列宽，圆角 10，内边距 10/12，13。
  - 重试：`bg-orange-tint`，图标与标题用 orange，正文 ink；右侧「取消重试」文字按钮。剩余秒数 mono，每秒用 `pop-in` 更新。
  - 错误：`bg-red-tint`，标题 red，正文 ink-2（provider · model · HTTP 状态 mono 11.5）；右侧「重试」次级按钮。出现时 `shake` 一次。
  - 进程退出：`bg-field` + hairline；标题 "会话进程已退出（代码 1）"；可展开 stderr 尾部（inset mono 块）；按钮「恢复」（主按钮）和「重新打开」。
- **压缩分隔条**：一行，左右两侧是 1px `line`，中间文字 "上下文已压缩 · 182k → 24k" 11.5 ink-2，点击展开摘要卡。
- **Toast**：右下角，距边 16，宽 340，叠放最多 3 条（新的在下面，旧的上移并缩到 `scale(.96)`、`opacity .7`）。样式为 `bg-surface`、`shadow-raised`、圆角 10、内边距 10/12；左侧 6px 状态色点；文字 12.5。进入 `fade-up`，退出 150ms 淡出加 `translateX(8px)`。info 停留 4s，error 不自动消失。
- **连接条**：WS 断开时，对话区顶部出现 2px orange 条，中间叠一个 "重新连接中…" 小药丸（`bg-surface`，`shadow-raised`）。恢复后条变成 green，600ms 后淡出。

### 6.18 其他

- **回到底部按钮**：32px 圆形，`bg-surface`，`shadow-raised`，`ArrowDown` 15px，位于 Composer 上方 12px、水平居中；有新内容时内部显示 accent 点。`pop-in` 出现，150ms 淡出。
- **加载骨架**：只在冷启动拉取历史超过 300ms 时显示。三组 `bg-inset` 条（右侧一条短的模拟用户气泡，左侧三条不等长的模拟回复），圆角 6，`pulse-dot 1.4s`。
- **滚动条**：宽 10，滑块 `line-strong`，悬停 ink-3，圆角 999，带 2px 透明边，轨道透明。
- **选区**：`::selection { background: color-mix(in oklch, var(--accent) 22%, transparent) }`。
- **拖拽上传**：拖入对话区时整个 Composer 外框变为 2px dashed `accent`，背景 `accent-tint`，中间显示 "松开以附加图片"。

---

## 7. 状态清单（每个可交互元素必须实现）

| 状态 | 样式 |
|---|---|
| 默认 | 见各组件 |
| 悬停 | surface 上 `bg-hover`，page/canvas 上 `bg-hover-2`；图标 ink-3 → ink-2 |
| 按下 | `scale(.96)`（Composer 内 .94） |
| 键盘聚焦 | §2.2 聚焦环；列表与菜单中的项改为显示滑动高亮块 |
| 选中/当前 | 文字 ink + 500 字重；tab 用 `bg-field` |
| 禁用 | `opacity .35`，`cursor: default`，不响应悬停 |
| 加载中 | 按钮内 spinner 替换图标，宽度保持不变 |
| 错误 | red 文字/描边 + `shake` |

---

## 8. 实现约定

- 依赖（精确版本在 M1 锁定）：`react@19`、`tailwindcss@4`、`@radix-ui/*`（dialog、dropdown-menu、popover、tooltip、tabs、checkbox、switch、scroll-area、context-menu）、`lucide-react`、`shiki`、`react-markdown`、`remark-gfm`、`rehype-katex`、`@tanstack/react-virtual`、`@fontsource-variable/inter`、`@fontsource-variable/jetbrains-mono`。动效全部用 CSS，**不引入 motion 库**：退出动画用 Radix 的 `data-state` + CSS 实现。
- 目录：`web/src/styles/{tokens.css, keyframes.css, base.css}`，`web/src/ui/`（原语：Button、IconButton、Chip、Kbd、Card、Menu、Dialog、Tooltip、Switch、Checkbox、SpinnerRing、PixelGrid、ShimmerText、Collapsible），`web/src/features/*`（业务组件只组合原语）。
- 原语 API 统一使用 `variant` / `size`，例如 `Button variant="primary|secondary|ghost|danger" size="sm|md"`，不暴露 className 之外的样式 props。
- 每个组件在 `web/src/gallery/` 下有一个预览页，覆盖 §7 的全部状态和两种主题（自建 `/gallery` 路由，不引入 Storybook）。Playwright 对 gallery 做明暗两套截图回归。
- Beautiful UI 源码用作参考时，按其 MIT 许可在 `THIRD-PARTY-NOTICES` 中保留版权声明（Copyright (c) 2026 Shane Levine）。
