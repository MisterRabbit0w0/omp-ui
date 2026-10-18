# omp-ui 设计文档

为 oh-my-pi（`omp`）提供类 Claude Desktop / Codex 的图形前端。本文档是实现依据：协议映射、状态机、UI 行为均已定稿，实现时不应再做产品层面的决策。标注 **[待验证]** 的条目需在 M1 用真实进程确认，不影响整体结构。

基线：`omp 18.11.1`，RPC 协议 v1/v2（`ready.supportedProtocolVersions = [1,2]`）。

---

## 1. 目标与非目标

目标
- 多会话、多项目的桌面式聊天界面：侧边栏会话列表、流式对话、工具调用可视化、审批、提问、子代理、Todo、Goal、分支/分叉、压缩、模型与思考级别切换。
- 完整覆盖 `omp --mode rpc-ui` 暴露的命令与事件（见 §4 映射表），不重新实现 agent 逻辑。
- 本地运行，单用户。

非目标（v1）
- 远程多用户托管、账号体系。
- 自定义 host tools / host URI schemes（协议支持，v1 不注册）。
- 内置代码编辑器（只做 diff/文件只读预览）。
- 实时语音 `live_*`（放到 M6）。

---

## 2. 总体架构

```
Browser (React SPA)
   │  WebSocket /ws  (JSON envelope, §5)
   │  HTTP /api/*    (列表/搜索/文件等无状态请求)
Bridge (Bun 服务, 127.0.0.1)
   │  每个打开的会话一个子进程
   │  stdin/stdout NDJSON (omp RPC, §4)
omp --mode rpc-ui  ×N
   │
~/.omp/agent/sessions/**.jsonl   (会话持久化，由 omp 写)
```

为什么要 Bridge 而不是浏览器直连：浏览器不能 spawn 进程；会话列表要扫磁盘（RPC 没有 `list_sessions`）；需要在前端刷新/断线时保持进程与待答 UI 请求。

为什么用 `rpc-ui` 而不是 `rpc`：`rpc-ui` 把工具 UI（审批、ask）路由到协议上。无 UI 时需审批的工具会直接失败（`wrapper.ts`: "requires approval but no interactive UI available"）。

为什么不用 `omp acp`：ACP 是通用协议，丢失 omp 特有能力（queue、goal、btw、subagent 订阅、todo、分支）。

### 2.1 技术栈

| 层 | 选择 |
|---|---|
| 运行时 / 包管理 | Bun（与 omp 一致），bun workspaces |
| Bridge | `Bun.serve`（原生 WS），`Bun.spawn` |
| 前端 | React 19 + Vite + TypeScript strict |
| 样式 | Tailwind CSS v4 + Radix UI primitives；token、组件外观、动效见 `FRONTEND.md`（动效纯 CSS，不引入 motion 库） |
| 状态 | Zustand（每会话一个 store slice）+ 纯函数 reducer |
| Markdown | `react-markdown` + `remark-gfm` + `rehype-katex`；代码高亮 `shiki`（懒加载） |
| Diff | `diff`（jsdiff）生成 hunk，自绘 unified/split 视图 |
| 虚拟列表 | `@tanstack/react-virtual` |
| 测试 | `bun test`（reducer/bridge 单元）、Playwright（E2E） |

依赖全部精确锁版本。

### 2.2 仓库布局

```
omp-ui/
  package.json              # workspaces
  packages/
    protocol/               # 纯类型 + 帧工具，无运行时依赖
      src/rpc-wire.ts       # 从 omp 复制的 rpc-wire.generated.ts（无 import，可直接 vendor）
      src/envelope.ts       # Bridge<->Browser 消息类型（§5）
      src/approval.ts       # 审批请求识别（§7.3）
      scripts/sync-wire.ts  # 从已安装 omp 拷贝生成文件，并写入 omp 版本号
    bridge/
      src/server.ts         # HTTP + WS，鉴权
      src/process.ts        # OmpProcess：spawn、帧解析、v2 分片重组、请求关联
      src/pool.ts           # 进程池、LRU 回收
      src/sessions.ts       # 扫描/监听 sessions 目录
      src/files.ts          # @ 提及文件搜索、受限文件读取
      src/config.ts         # ~/.omp-ui/config.json
    web/
      src/app/              # 路由、布局
      src/store/            # reducer、selectors
      src/features/         # sidebar, transcript, composer, panels, dialogs, settings
      src/tools/            # 工具渲染器注册表（§8）
  docs/DESIGN.md
```

启动：`bunx omp-ui` 或 `bun run start`。Bridge 打印 `http://127.0.0.1:<port>/#token=<token>` 并尝试打开浏览器。

---

## 3. Bridge 设计

### 3.1 进程模型

- 一个打开的会话对应一个 `omp --mode rpc-ui` 子进程，以 `sessionId` 为键。
- 新会话：`omp --mode rpc-ui --cwd <dir> [--model p/id] [--thinking L] [--approval-mode M]`。
- 恢复会话：追加 `--resume <sessionFile>`。崩溃恢复用 `--restore <sessionFile>`。
- 只读预览先展示、进程随即预热：侧边栏点开一个未激活的会话时，Bridge 先解析 jsonl 立即渲染历史，前端随后在后台 spawn + attach（启动约 2–6 秒，期间显示 "启动中"）。模型/思考级别选择器在发送前即可用；首次发送复用同一个进程。
- 进程池上限默认 6。超限时回收最久未用、`isSettled=true` 且无待答 UI 请求的进程（`SIGTERM`，5 秒后 `SIGKILL`）。正在流式输出或有待答请求的进程永不回收。
- `omp` 可执行路径：`OMP_UI_OMP_BIN` > `Bun.which("omp")`。启动时运行 `omp --version`，低于 18.11.0 拒绝并提示。
- stderr 收集到每进程 200KB 环形缓冲，在「诊断」面板可看。

### 3.2 帧层（`OmpProcess`）

1. 按 `\n` 切分 stdout，逐行 `JSON.parse`；解析失败记录到诊断，不中断。
2. 第一帧必须是 `ready`。若 `supportedProtocolVersions` 含 2，发 `negotiate_protocol {protocolVersion:2}`。
3. v2 下收到 `rpc_chunk {chunkId,index,count,byteLength,data}` 时按 `chunkId` 缓存，`count` 片齐后拼接 `data`，校验 `byteLength`，再当作一帧处理。上限 `maxReassembledFrameBytes`。前端永远只看到完整帧。
4. 命令：Bridge 生成 `id`（`b-<seq>`），保存 `pending: Map<id, {resolve, timer}>`；收到 `type:"response"` 按 `id` 关联。默认超时 30s，`login` 600s，`predict_word` 155s（与 `commands.ts` 中 `timeoutMs` 一致）。
5. 对外写 stdin 只经一个串行队列，每帧一行。

### 3.3 进程初始化序列（spawn 后一次）

```
← ready
→ negotiate_protocol {protocolVersion: 2}        (若支持)
→ set_ask_dialog {enabled: true}                 # 否则 ask 工具不走 UI
→ set_subagent_subscription {level: "progress"}  # 打开子代理抽屉时临时升到 "events"
→ set_event_filter {events: null, messageUpdates: "delta"}
```

`messageUpdates:"delta"` 去掉每个 token 帧里的累计快照（`rpc-session-events.ts`：`message` 只剩 `{role}`，`assistantMessageEvent` 去掉 `partial`），否则长回复是 O(n²) 流量。代价是前端必须自己累积（§6.2）。

### 3.4 事件缓冲与重连

- 每进程维护 `seq` 递增的帧环形缓冲（最近 5000 帧或 8MB）。
- 前端 `attach {sessionId, sinceSeq?}`：
  - `sinceSeq` 在缓冲内 → 回放之后的帧。
  - 否则 → 发 `resync`，前端丢弃本地状态并执行 §6.1 冷启动拉取。
- 待答的 `extension_ui_request`（select/confirm/input/editor/ask）单独存在 `pendingUi: Map<id, frame>`，attach 时总是重发，直到收到响应或 `method:"cancel"`。
- 多个浏览器标签可 attach 同一会话；UI 请求先答先得，Bridge 转发第一个响应后向其他客户端发 `ui_resolved {id}`。

### 3.5 会话发现（`sessions.ts`）

- 根目录：`PI_CODING_AGENT_DIR` 或 `~/.omp/agent`，加 `--profile` 时为对应 profile 目录 **[待验证路径]**。会话在 `sessions/<编码后的 cwd>/<ISO时间>_<uuid>.jsonl`。
- 每个文件只读前 4KB：
  - 第 1 行 `{"type":"title","title","updatedAt",pad}`（定长，原地重写）。
  - 第 2 行 `{"type":"session","version":3,"id","timestamp","cwd"}`。
- 项目分组按 header 中的 `cwd`，不依赖目录名解码。
- 列表项：`{id, file, cwd, title, createdAt, updatedAt(=max(title.updatedAt, mtime)), sizeBytes, live: boolean, running: boolean, archived: boolean}`；`running` = 活进程处于 `agent_start` 与 `session_settled` 之间。
- `fs.watch` 递归监听，去抖 300ms，推送 `sessions_changed`；活进程发出 `agent_start` / `session_settled` 时也推送，让未附加该会话的标签页刷新运行状态。
- 首次扫描后缓存到内存；只对 mtime 变化的文件重新读头。

### 3.6 删除与归档

删除会话文件不可逆，按高风险处理：
- 「归档」：只写 `~/.omp-ui/config.json` 中的 `archived: string[]`，不动原文件。
- 「删除」：二次确认弹窗（显示文件路径），实际执行为移动到 `~/.omp-ui/trash/`，30 天后由 Bridge 启动时清理。正在运行的会话不可删除。

### 3.7 安全

- 只监听 `127.0.0.1`，端口默认 4317，被占用则递增。
- 启动时生成 32 字节随机 token。HTTP 需要 `Authorization: Bearer`，WS 首帧 `hello {token}`，错误立即断开。
- 校验 `Origin` 必须是自身地址；拒绝其他来源（防 DNS rebinding / 恶意网页连本地 WS）。
- token 只放 URL hash（不进服务器日志），前端读取后存 `sessionStorage` 并清掉 hash。
- 文件读取 API 只允许会话 `cwd`（及 `--add-dir`）下的路径，`realpath` 后再比较前缀，拒绝符号链接逃逸。
- 这个服务等价于本机代码执行能力。文档和启动日志都要写明：不要用反向代理暴露它。

---

## 4. omp RPC 能力 → UI 映射

### 4.1 命令

| 命令 | UI 入口 |
|---|---|
| `prompt {message, images?, streamingBehavior?}` | Composer 发送（空闲时） |
| `steer` / `follow_up` | 流式中发送（§9.2） |
| `remove_queued_message` / `promote_queued_message` | 队列 chip 的 × / ↑ |
| `abort` | 停止按钮、Esc Esc |
| `abort_and_prompt` | 流式中 Ctrl+Enter「打断并发送」 |
| `abort_and_restore_queue` | 「停止并编辑」：返回内容填回 composer |
| `new_session` / `open_session` | 侧边栏「新对话」（同进程复用时） |
| `switch_session` | 不使用：一会话一进程 |
| `get_state` | 冷启动、`model_changed`/`todo_*`/`goal_updated` 后刷新 |
| `get_messages_page {cursor?, limit?}` | 冷启动加载历史（从头正向分页，见 §6.1） |
| `get_entries` / `get_tree` | 会话树视图 |
| `get_branch_messages` + `branch {entryId}` | 用户消息「从这里编辑重来」 |
| `fork {entryId?}` | 「分叉为新会话」 |
| `set_model` / `get_available_models` / `cycle_model` | 模型选择器 |
| `set_thinking_level` / `get_available_thinking_levels` | 思考级别下拉 |
| `set_fast_mode` / `set_slow_mode` | 模型选择器内开关（按 `slowModeSupported` 显示） |
| `set_steering_mode` / `set_follow_up_mode` / `set_interrupt_mode` | 会话设置 |
| `compact {customInstructions?}` / `set_auto_compaction` | 菜单「压缩上下文」、设置 |
| `set_cache_warming` / `set_auto_retry` / `abort_retry` | 设置；重试横幅的「取消」 |
| `handoff` | 菜单「交接到新会话」 |
| `bash {command}` / `abort_bash` | Composer `!cmd` |
| `get_session_stats` | 信息面板、头部花费 |
| `export_html` | 菜单「导出 HTML」 |
| `set_session_name` | 标题双击编辑 |
| `get_last_assistant_text` | 「复制最后回答」 |
| `get_available_commands` | Slash 菜单 |
| `set_todos` | Todo 面板手动编辑 |
| `goal {op, objective?, token_budget?}` | Goal 面板 |
| `get_subagents` / `get_subagent_messages` / `cancel_subagent` / `steer_subagent` | 子代理面板与抽屉 |
| `btw` / `btw_cancel` / `get_btw_history` | 「旁问」抽屉 |
| `get_login_providers` / `login` / `get_logout_accounts` / `logout` | 设置 → 账号 |
| `predict_word` / `predict_word_feedback` | Composer 幽灵补全（默认关） |
| `live_*` | M6 |
| `set_host_tools` / `set_host_uri_schemes` | v1 不用 |

### 4.2 推送帧

| 帧 | 处理 |
|---|---|
| `agent_start` / `agent_end` | 运行状态（§6.3） |
| `turn_start` / `turn_end` | 轮次边界，`turn_end` 后刷新花费 |
| `message_start/update/end` | 流式 reducer（§6.2） |
| `tool_execution_start/update/end`, `tool_stream_update` | 工具卡片执行态（§6.2） |
| `prompt_result` | 结束对应请求；`status:error` 显示错误条（§11） |
| `session_settled` | 状态 → idle，触发桌面通知 |
| `queue_update` | 队列 chip |
| `auto_compaction_start/end` | 对话流内的压缩分隔条 + 进行中状态 |
| `auto_retry_start/end` | 重试横幅（倒计时 `delayMs`、第 n/max 次） |
| `retry_fallback_applied/succeeded` | toast："已回退到 X" |
| `cache_warming_*` | 只在诊断中记录 |
| `model_changed`, `thinking_level_changed`, `config_update` | 刷新头部 |
| `goal_updated` | Goal 面板 |
| `todo_reminder`, `todo_auto_clear` | Todo 面板 |
| `notice` | toast（按 level） |
| `irc_message` | 对话流内系统消息样式 |
| `ttsr_triggered` | 对话流内小标签 |
| `subagent_lifecycle/progress/event` | 子代理面板（§10.2） |
| `btw_delta` / `btw_record` | 旁问抽屉 |
| `available_commands_update` | Slash 目录 |
| `command_output` | 对话流内命令输出块 |
| `session_info_update` | 标题 |
| `extension_ui_request` | §7 |
| `extension_error`, `config_warnings_changed`, `rpc_frame_error` | 诊断角标 + toast |

---

## 5. Bridge ↔ Browser 协议

全部 JSON，通过 `/ws`。`packages/protocol/src/envelope.ts` 定义类型。

浏览器 → Bridge

```ts
type C2B =
  | { t: "hello"; token: string }
  | { t: "attach"; sessionId: string; sinceSeq?: number }
  | { t: "detach"; sessionId: string }
  | { t: "start"; reqId: string; cwd: string; resume?: string; restore?: boolean;
      model?: string; thinking?: string; approvalMode?: "always-ask" | "write" | "yolo" }
  | { t: "stop"; sessionId: string }                         // 结束进程
  | { t: "rpc"; reqId: string; sessionId: string; cmd: RpcCommand }   // 原样转发，Bridge 替换 id
  | { t: "ui_response"; sessionId: string; frame: ExtensionUiResponse };
```

Bridge → 浏览器

```ts
type B2C =
  | { t: "welcome"; ompVersion: string; protocolVersion: 1 | 2 }
  | { t: "started"; reqId: string; sessionId: string; sessionFile?: string }
  | { t: "rpc_result"; reqId: string; response: RpcResponse }
  | { t: "frame"; sessionId: string; seq: number; frame: RpcOutbound }   // 一切推送帧
  | { t: "resync"; sessionId: string }
  | { t: "ui_resolved"; sessionId: string; id: string }
  | { t: "proc"; sessionId: string; state: "starting" | "ready" | "exited" | "crashed";
      code?: number; stderrTail?: string }
  | { t: "sessions_changed" }
  | { t: "error"; reqId?: string; message: string };
```

HTTP（均需 Bearer）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/sessions?q=&cwd=&archived=` | 会话列表（§3.5） |
| GET | `/api/sessions/:id/transcript` | 未激活会话的只读解析结果（`AgentMessage[]`） |
| POST | `/api/sessions/:id/archive` / `unarchive` | 归档 |
| DELETE | `/api/sessions/:id` | 移入 trash（§3.6） |
| GET | `/api/projects` | 去重的 cwd 列表 + 最近使用时间 |
| GET | `/api/files?cwd=&q=` | @ 提及：`git ls-files` 优先，否则遍历（排除 node_modules/.git），前 50 个模糊匹配 |
| GET | `/api/file?cwd=&path=` | 受限只读，≤1MB |
| GET | `/api/git/changes?cwd=&scope=unstaged\|staged` | 只读 git 变更（工作区 / 暂存区，含未跟踪文件；输出有上限） |
| GET | `/api/export?path=` | 下载 `export_html` 生成的文件（路径必须是该命令返回过的） |
| GET/PUT | `/api/config` | UI 配置 |
| GET | `/api/diagnostics/:sessionId` | stderr 尾部、解析错误、帧统计 |
| POST | `/api/pick-dir` | 原生目录选择（Windows 用 PowerShell FolderBrowserDialog，其余平台返回 501，前端退回到输入框） |

---

## 6. 前端状态模型

### 6.1 每会话 store

```ts
interface SessionView {
  sessionId: string;
  proc: "none" | "starting" | "ready" | "exited" | "crashed";
  readonly: boolean;                 // 只读预览
  lastSeq: number;
  state: SessionState | null;        // get_state 快照
  messages: AgentMessage[];          // 已提交
  drafts: Map<string, Draft>;        // messageId -> 流式中的消息
  toolExec: Map<string, ToolExec>;   // toolCallId -> 执行态
  run: RunStatus;                    // §6.3
  queue: { steering: string[]; followUp: string[]; liveSteered: number };
  pendingUi: ExtensionUiRequest[];   // 按到达顺序
  statusChips: Map<string, string>;  // setStatus
  widgets: Map<string, { lines: string[]; placement: "aboveEditor" | "belowEditor" }>;
  subagents: Map<string, SubagentView>;
  btw: Map<string, BtwHistoryRecord>;
  commands: AvailableSlashCommand[];
  models: ModelInfo[];
  thinkingLevels: ThinkingLevel[];
  stats: SessionStats | null;
  banners: Banner[];                 // retry / compaction / error
  pendingPrompts: Map<string, { text: string; images: ImageContent[] }>; // reqId -> 用于失败重发
}
```

冷启动（attach 后或 resync）并行发：`get_state`、`get_available_models`、`get_available_thinking_levels`、`get_available_commands`、`get_subagents`、`get_btw_history`、`get_session_stats`；`get_messages_page` 从无 cursor 开始循环到无 `nextCursor`（每页 `limit` 200）。分页只能正向读，所以全部拉完后再渲染，配合虚拟列表。`stale_cursor` 或 `session_busy` 时等 500ms 从头重来，最多 3 次。

### 6.2 流式 reducer（确定性规则）

`Draft = { messageId, role, content: AssistantContent[], toolArgsText: Map<contentIndex,string> }`

| 事件 | 规则 |
|---|---|
| `message_start` | `drafts.set(messageId, fromMessage(message))`。user 消息直接按 committed 渲染（待 end） |
| `message_update` + `start` | 若 draft 不存在则建空 draft |
| `text_start` / `thinking_start` / `toolcall_start` | `content[contentIndex] = 空块`（text/thinking/toolCall 占位） |
| `text_delta` / `thinking_delta` | 对 `content[contentIndex]` 追加 `delta` |
| `toolcall_delta` | `toolArgsText[contentIndex] += delta`；用容错 JSON 解析（`partial-json` 思路，自写 50 行）出预览参数 |
| `text_end` / `thinking_end` | 用 `content` 覆盖整块（以服务端为准，纠正丢帧） |
| `toolcall_end` | 用 `toolCall` 覆盖整块 |
| `image_end` | 写入 `content` |
| `done` / `error` | 标记 draft 完成，等 `message_end` |
| `message_end` | `messages.push(message)`；`drafts.delete(messageId)`。**完整消息总是覆盖累积结果** |
| `agent_end` | 清空残留 drafts（与服务端 `openMessageIds.length = 0` 一致）；若 `messageCount` 存在且大于本地计数，触发一次全量 `get_messages_page` 校正 |
| `tool_execution_start` | `toolExec.set(id, {status:"running", args, intent, startedAt})` |
| `tool_execution_update` | `partialResult` 覆盖 |
| `tool_stream_update` | `update` 追加到 `streamLog`（bash 实时输出） |
| `tool_execution_end` | `status = isError ? "error" : "done"`，存 `result` |

渲染层把 `toolResult` 消息按 `toolCallId` 并入对应 assistant 消息里的 toolCall 卡片，不单独成行。`bashExecution`/`pythonExecution`（用户 `!cmd`）独立成块。

**[待验证]** `delta` 模式下 `toolcall_end.toolCall` 与 `text_end.content` 是否保留（`withoutPartial` 只去 `partial`，按源码应保留）。若不保留，回退到 `messageUpdates:"full"` 并只读 `assistantMessageEvent` 部分。

### 6.3 运行状态机

```
idle ──prompt ack(agentInvoked≠false)──▶ running
running ──agent_end(yielded && !awaitingAsyncWork)──▶ settling
running ──auto_compaction_start──▶ compacting ──end──▶ running
running ──auto_retry_start──▶ retrying ──auto_retry_end──▶ running
settling/running ──session_settled──▶ idle
任意 ──prompt_result(status:error)──▶ idle + 错误条
任意 ──proc exited──▶ dead
```

`prompt` ack 里 `agentInvoked:false` 表示本地已完成（如部分 slash 命令），不会有 `prompt_result`，直接回 idle。`get_state.isSettled` 是兜底判据：重连后以它为准。

---

## 7. 交互请求（extension_ui_request）

### 7.1 渲染规则

| method | 呈现 | 响应 |
|---|---|---|
| `select`（审批，§7.3） | 对话流内审批卡，锚定到运行中的工具卡 | `{value:"Approve"}` / `{value:"Deny"}` |
| `select`（其他） | 模态列表，`optionDetails[i].description` 作副标题 | `{value: options[i]}` |
| `confirm` | 模态确认 | `{confirmed}` |
| `input` | 模态单行输入；OAuth 流程中紧跟 `open_url` 时并入同一张登录卡 | `{value}` |
| `editor` | 模态多行编辑器，`prefill` 预填 | `{value}` |
| `ask` | 对话流内问卷卡：锚定到运行中的 `ask` 工具卡（无对应工具行时回退到流末尾）；每题一组，单选/多选，`preview` 展开显示，始终有「其他」自由输入，`recommended` 预选 | `{answers:[{id, selectedOptions, customInput?}]}`（按题目顺序） |
| `cancel` | 关闭 `targetId` 对应界面，后续回答忽略 | 无 |
| `notify` | toast | 无 |
| `setStatus` | 头部状态 chip（`statusText` 为空则移除） | 无 |
| `setWidget` | composer 上/下方的等宽文本块（`widgetLines` 为空则移除） | 无 |
| `setTitle` | 会话标题 | 无 |
| `set_editor_text` | 替换 composer 内容（若用户有未发送内容，先放入撤销栈） | 无 |
| `open_url` | 卡片：打开按钮（`window.open(url)`）+ 复制 `launchUrl ?? url` + `instructions` | 无 |

所有模态/卡片都有「取消」→ `{cancelled:true}`。

### 7.2 超时

带 `timeout`（毫秒）的请求显示倒计时进度条。到时前端发 `{cancelled:true, timedOut:true}`；`ask` 超时后服务端采用推荐答案，卡片显示 "已按推荐答案继续"。

### 7.3 审批识别

RPC 下审批走 `ui.select(full, ["Approve","Deny"])`（`tools/approval.ts`）。判定：`options` 恰为 `["Approve","Deny"]` 且 `title` 首行匹配 `/^Allow tool: (.+)$/`。解析：
- 首行 → 工具名；`Origin: MCP server tool` → MCP 标记；`Reason: ...` → 原因；
- 其余行 → 详情（命令、路径、内容），等宽显示，超过 20 行折叠。

审批卡：「允许」(Enter)、「拒绝」(Esc)、「本会话总是允许此工具」。最后一项 = 发 Approve，并在 Bridge 内记录 `autoApprove: Set<toolName>`，之后同进程同工具的审批请求由 Bridge 自动答复（不改 omp 配置，进程结束即失效），并在对话流中标注 "已自动允许"。

锚定：审批请求到达时，取该会话最近一个已 `toolcall_end` 但尚未 `tool_execution_end` 的同名工具调用；找不到就挂在对话流末尾。**[待验证]** 审批与 `tool_execution_start` 的先后顺序。

### 7.4 审批模式

`--approval-mode` 是启动参数，无 RPC 切换命令。入口在 Composer 左下角的权限 chip（FRONTEND §6.12）：欢迎页选的值作为新会话启动参数；会话中切换时，若 `isSettled` 则直接 `stop` + `start(resume)` 用新参数重启（不弹确认，历史不受影响），运行中禁用。头部 ⋯ 菜单不再放审批模式。

---

## 8. 工具渲染器

注册表：

```ts
interface ToolRenderer {
  match(name: string): boolean;
  icon: IconName;
  summary(args: unknown, exec?: ToolExec): string;      // 卡片标题行
  body?(props: { args; result?: ToolResultMessage; exec?: ToolExec }): ReactNode;
  defaultOpen?: boolean;
}
```

所有渲染器都必须在 `args`/`result` 形状不符时退回通用渲染器（JSON 树 + 文本内容），不得抛错。工具参数 schema 可从 `get_state.dumpTools[].parameters` 获取，用于通用渲染器标注字段名。

| 工具 | 标题 | 内容 |
|---|---|---|
| `bash` | `$ <command>` + 退出码徽标 + 耗时 | 等宽输出；运行中显示 `tool_stream_update` 实时流；>500 行折叠，"展开全部" |
| `python` | 代码首行 | 代码块 + 输出 |
| `read` | 路径（相对 cwd）+ 行范围 | 折叠的高亮代码 |
| `write` | 路径 + "新建/覆盖" | 内容高亮；可切换成与磁盘上一版的 diff（若 result.details 提供） |
| `edit` | 路径 + `+n −m` | diff 视图（unified/split 切换）。来源顺序：`result.details` 中的 diff **[待验证字段]** → 由 args 推导 → 原文 |
| `grep` / `glob` / `find` | 模式 + 匹配数 | 结果列表，路径可点开预览（`/api/file`） |
| `lsp` | 动作 + 符号 | 结果文本 |
| `web_search` | 查询 | 结果条目（标题、链接、摘要） |
| `browser` | 动作 | 截图（`ImageContent`）+ 文本 |
| `task` | 代理名 + 任务描述 | 嵌入子代理卡（§10.2） |
| `todo` | "更新待办" | 变更摘要；完整列表见右侧面板 |
| `ask` | 问题标题 | 已答结果（问卷卡完成态） |
| `notebook` | 路径 + cell | cell diff |
| `mcp__*` | `服务器 › 工具` | 通用 |
| 其他 | 工具名 + `intent` | 通用 |

卡片头部统一显示：状态（运行中旋转 / 成功 / 错误红色 / 被拒绝）、`intent`（若有，灰字）、耗时。连续 ≥3 个只读工具调用（read/grep/glob/find/lsp）合并为一组 "查看了 N 个文件"，可展开。

---

## 9. 界面规格

本章定义交互和数据来源。尺寸、颜色、动效以 `FRONTEND.md` 为准，静态原型见 `prototype/index.html`。

### 9.1 布局

```
┌──────────┬─────────────────────────────────────┬────────────┐
│ 侧边栏   │ 头部：标题 · cwd · 模型 · 思考 · 上下文环 · 花费 · ⋯ │
│ 264px    ├─────────────────────────────────────┤ 右侧面板   │
│          │ 对话流（虚拟列表，内容列 760px 居中）│ 340px      │
│          │                                     │ Todo       │
│          │ widgets(aboveEditor)                │ 子代理     │
│          │ 队列 chips                          │ 变更       │
│          │ Composer                            │ Goal       │
│          │ widgets(belowEditor) · 状态 chips   │ 信息       │
└──────────┴─────────────────────────────────────┴────────────┘
```

侧边栏、右侧面板可折叠（`Ctrl+B` / `Ctrl+.`），断点见 `FRONTEND.md` §3。深浅色跟随系统，可手动覆盖。

### 9.2 侧边栏

- 顶部：「新对话」按钮 → 不弹窗，直接回到欢迎页；项目、权限、模型、思考级别都在 Composer 四周选择（FRONTEND §6.12）。分组 "+" 同样回到欢迎页并预选该项目。
- 搜索框：标题与 cwd 模糊过滤（客户端）。
- 按项目分组（组名为 cwd 的末段，悬停显示全路径），组内按 `updatedAt` 降序；组可折叠，记住状态。
- 条目：标题（空标题显示首条用户消息前 40 字，取自只读解析，异步）、相对时间、状态点（运行中蓝色脉动 / 等待你操作 橙色 / 出错 红色）。
- 右键 / ⋯：重命名、分叉、导出 HTML、归档、删除（§3.6）、在资源管理器中显示路径（复制）。
- 底部：设置、诊断入口、omp 版本。

### 9.3 对话流

- 用户消息：右侧气泡；图片缩略图；悬停操作「复制」「编辑并从这里重来」（→ `get_branch_messages` 按顺序匹配 `entryId` → `branch` → 返回的 `text` 填入 composer）、「从这里分叉」（`fork {entryId}`，打开新会话）。
- 助手消息：无气泡全宽 Markdown；代码块带语言标签、复制、换行切换；数学公式；表格横向滚动。
- 思考块：默认折叠为 "思考了 Ns"，流式中展开显示最后 3 行并淡入；`redactedThinking` 显示 "已隐藏的思考"。
- 消息底部（悬停）：模型名、上下文（最后一条消息的 input + cacheRead + cacheWrite）、输出（本回合 output 之和）、耗时，悬停显示首字延迟（TTFT）；复制/重试/分叉。整个 agent loop 结束（会话不再运行）后才显示这一栏；隐藏消息（developer 提醒、`display:false` 的 custom/hook）不切分回合。
- `stopReason:"error"`：红色错误块，显示 `errorMessage`、`errorStatus`，按钮「重试」（重发上一条 user 文本）。
- `stopReason:"aborted"`：灰色 "已停止"。
- `compactionSummary`：横向分隔条 "上下文已压缩（X → Y tokens）"，点开看摘要。
- `branchSummary`：分隔条 "分支摘要"。
- `fileMention`：附件 chips。
- `custom`/`hookMessage`：`display:true` 才渲染，系统消息样式。
- 自动滚动：在底部 64px 内时跟随；用户上滚后停止，并显示 "↓ 新消息" 浮钮。
- `aria-live="polite"` 只播报消息完成，不播报每个 token。

### 9.4 Composer

- 自增高多行输入（最高 40vh）。`Enter` 发送，`Shift+Enter` 换行；IME 组合期间 Enter 不发送（检查 `isComposing`）。
- 附件：粘贴/拖拽/按钮添加图片。前端用 canvas 把长边缩到 ≤2000px，转 base64 `ImageContent`。当前模型 `input` 不含 `image` 时禁用并提示。
- `@`：弹出文件搜索（`/api/files`），选中插入 `@path`。**[待验证]** omp 会话层是否展开 prompt 中的 `@path`；若不展开，Bridge 在转发 `prompt` 前读取文件并追加为文本块（≤200KB/文件），并在 UI 中显示为 fileMention chip。
- `/`（行首）：命令菜单，来源 `available_commands`，按 `source` 分组（内置/技能/扩展/MCP），显示 `input.hint`、子命令。选中后作为 `prompt` 发送。
- `!`（行首）：bash 模式，输入框变等宽且显示 `$` 前缀，发送走 `bash`；运行中停止按钮发 `abort_bash`。
- 发送按钮状态：
  - idle：发送 → `prompt`。
  - running：主按钮变「停止」；输入框仍可用，`Enter` → `steer`（"插话"，按 `interruptMode`），`Alt+Enter` → `follow_up`（"完成后再说"），`Ctrl+Enter` → `abort_and_prompt`。输入框下方小字提示这三种。
  - starting/dead：禁用，显示原因。
- 停止：`Esc` 连按两次或点按钮 → `abort`。长按/下拉菜单「停止并取回排队消息」→ `abort_and_restore_queue`，结果合并回输入框。
- 历史：输入框为空时 `↑` 取本会话上一条用户消息。
- 草稿：每会话持久化到 `localStorage`。
- 幽灵补全（设置中开启）：停顿 300ms 调 `predict_word`，`Tab` 接受并发 `predict_word_feedback(accepted:true)`，继续输入则 `accepted:false`。

### 9.5 队列 chips

来源 `queue_update`。前 `liveSteered` 条标 "已送达" 且不可删除；其余可 ×（`remove_queued_message`，返回的 `images` 恢复到附件），follow-up 可 ↑ 提升为 steering。

### 9.6 头部

- 标题：双击编辑 → `set_session_name`。
- cwd chip：点击复制。
- 模型选择器（`Ctrl+M`）：按 provider 分组、可搜索；显示上下文窗口、价格（`cost` 每百万 token）、图片支持图标；内含 fast/slow 开关；`state.usageLimit` 存在时显示 "低优先级通道 / 收尾额度" 警示与重置时间。
- 思考级别：下拉，选项来自 `get_available_thinking_levels`；`thinking_level_changed.resolved` 存在时显示 "auto → high"。
- 上下文环：`contextUsage.percent`，≥80% 变橙，≥95% 变红；点击 → 压缩对话框（可填自定义指令）。
- 花费：`stats.cost` 美元，悬停显示 tokens 明细与 `premiumRequests`。
- ⋯ 菜单：压缩、交接、分叉、会话树、导出 HTML、复制最后回答、旁问、会话设置、重启进程、诊断。

### 9.7 右侧面板

- Todo：按 phase 分组，状态图标（pending/in_progress/completed/abandoned/blocked+blocker 文本），`details`/`notes` 展开。可勾选、编辑、增删 → `set_todos`。`todo_reminder` 时面板标题闪一下。
- 子代理：§10.2。
- 变更：多口径展示。**本会话**汇总所有 `edit`/`write`/`notebook` 成功调用并按文件合并；**最近一轮**只保留最近一次实际改动文件的助手回合；**未暂存 / 已暂存**调用 Bridge 的只读 git API（`git diff` 工作区 / `--cached`，未暂存含未跟踪文件），支持手动刷新。会话口径可点击跳到对应工具卡。
- Goal：无 goal 时显示创建表单（目标、token 预算）→ `goal {op:"create"}`；有 goal 时显示状态、`tokensUsed/tokenBudget` 进度、用时，按钮暂停/恢复/放弃。
- 信息：`get_session_stats` 全部字段、`routedModels`、会话文件路径、sessionId、系统提示词（`state.systemPrompt`，折叠）、工具列表（`state.dumpTools`）。

### 9.8 弹窗与抽屉

- 会话树：`get_tree` 渲染为可折叠树，当前 `leafId` 高亮；点节点 → 确认后 `branch {entryId}`。
- 旁问（btw）：右侧抽屉，独立的小对话；`btw_delta` 流式，`btw_record` 定稿；可取消、可在同 topic 追问（`recordId`）。不进入主对话上下文。
- 命令面板 `Ctrl+K`：会话跳转、新建、所有 ⋯ 菜单动作、切换模型。
- 设置：
  - 账号：`get_login_providers` 列表，登录 → `login`（流程走 `open_url` + `input`），登出 → `get_logout_accounts` 选凭据 → `logout`。登录在一个专门的 "控制进程" 上执行（Bridge 维护的一个 `--no-session` 进程），不依赖具体会话。
  - 默认值：新会话的模型、思考级别、审批模式（存 `~/.omp-ui/config.json`）。
  - 会话行为：steering/follow-up 模式、interrupt 模式、自动压缩、自动重试、cache warming（作用于当前会话）。
  - 外观：主题、字号（按 12/13/14 缩放全部文本，不改变 16px rem 布局）、等宽字体、对话宽度、紧凑模式（压缩对话流与工具卡的垂直间距）。
  - 通知：桌面通知开关、声音。
  - 快捷键列表（只读）。

---

## 10. 子代理

### 10.1 数据

`subagent_lifecycle` 建立/更新 `{id, index, agent, agentSource, description, status, sessionFile, parentToolCallId, detached}`；`subagent_progress` 按 `index` 更新 `progress`（原始 `AgentProgress`，通用展示：当前工具、轮次、tokens 等已知字段，其余 JSON）。冷启动用 `get_subagents`。

### 10.2 呈现

- 在 `task` 工具卡内按 `parentToolCallId` 嵌入子代理行：代理名、描述、状态、实时进度一行。
- 右侧面板列出全部（含 detached 后台任务）。
- 点击打开抽屉：`get_subagent_messages {subagentId, fromByte}` 增量读取（运行中每 1.5s 轮询，用 `nextByte`，`reset:true` 时清空重来），用同一套对话流组件只读渲染。抽屉打开期间将订阅升到 `events` 以获得实时流，关闭后降回 `progress`。
- 抽屉底部：输入框 → `steer_subagent`；「终止」→ `cancel_subagent`（确认）。

---

## 11. 错误与恢复

| 情况 | 表现 |
|---|---|
| `prompt_result.status:"error"` | 对话末尾错误条：`error.message`、provider/model、HTTP 状态；`retryable` 时有「重试」（用 `pendingPrompts` 原文重发） |
| `auto_retry_start` | 黄色横幅 "第 n/max 次重试，Xs 后"，按钮「取消重试」→ `abort_retry` |
| `auto_retry_end.success:false` | 横幅变红显示 `finalError` |
| 命令 `response.success:false` | toast 显示 `error`；`code` 用于特殊分支（如 `stale_cursor`） |
| 进程退出 | 对话流顶部横幅：退出码、stderr 尾部、按钮「恢复」（`--restore`，接上被打断的回合与子代理）/「重新打开」（`--resume`） |
| WS 断开 | 顶部细条 "重新连接中"，指数退避 0.5s→8s；恢复后对所有已 attach 会话发 `attach {sinceSeq}` |
| `rpc_frame_error` | 诊断计数 +1，触发一次 `get_messages_page` 校正 |
| 未知帧 `type` / 未知消息 `role` | 忽略并记诊断，不崩溃（协议声明消息为 open record） |

---

## 12. 通知、快捷键、无障碍、性能

通知：页面不可见时，`session_settled`、待答 UI 请求、错误触发 `Notification`；标签页标题前缀 `(n)` 表示需要处理的会话数，当前会话运行中时再加 `● ` 前缀。正在处理的会话：侧边栏行显示 PixelGrid（未附加的会话依据列表项的 `running`），头部标题旁显示「运行中」药丸。

快捷键：`Ctrl+N` 新对话、`Ctrl+K` 命令面板、`Ctrl+M` 模型、`Ctrl+T` 思考级别循环（`cycle_thinking_level`）、`Ctrl+B`/`Ctrl+.` 两侧面板、`Ctrl+L` 聚焦输入、`Esc Esc` 停止、`Alt+↑/↓` 切换会话、`Ctrl+Shift+C` 复制最后回答。macOS 下 Ctrl 换 ⌘。

无障碍：Radix 提供焦点管理；所有图标按钮有 `aria-label`；颜色对比按 WCAG AA 设计；状态不只用颜色表达（加图标/文字）；审批卡与问卷卡出现时焦点移入并播报。完整合规需要辅助技术人工测试。

性能：
- 对话流虚拟化；单个 Markdown 块流式中每 50ms 最多重解析一次（rAF 合并）。
- shiki 按语言懒加载，Web Worker 中高亮；>2000 行的代码块只高亮可见部分。
- 工具输出超过 200KB 截断显示并提供 "在新标签打开全文"。
- 帧处理在主线程批量 `setState`：可见时每个 rAF 一批，页面隐藏时每 250ms 一批（rAF 在后台暂停），重新可见时立即冲刷，避免切回标签页时积压的帧逐条重放造成卡顿。

---

## 13. 测试计划

- 帧夹具：M1 写 `scripts/record.ts`，对真实 `omp --mode rpc-ui` 跑一组脚本（普通问答、bash、edit、审批拒绝/允许、ask、task 子代理、abort、compact、错误 provider），把 stdout 存为 `fixtures/*.ndjson`。
- reducer 单元测试：回放夹具，断言最终 `messages` 与 `get_messages_page` 结果深相等（delta 累积的正确性判据）。
- Bridge 单元测试：v2 分片重组（乱序、缺片、超限）、请求超时、环形缓冲回放、pendingUi 重发、路径越界拒绝、token/Origin 校验。
- 假 omp：`fake-omp.ts` 读夹具按时间戳回放并响应命令，供 Playwright 使用。
- E2E：新建会话→发送→流式→工具卡→审批→完成；刷新页面中途恢复；两标签同时答审批；进程崩溃恢复。

---

## 14. 里程碑

| 阶段 | 内容 | 完成标准 |
|---|---|---|
| M1 骨架 | 仓库、protocol 同步脚本、Bridge spawn/帧/v2/鉴权、夹具录制、解决全部 **[待验证]** | `bun test` 通过；夹具覆盖 §13 列表 |
| M2 核心对话 | 侧边栏、只读预览、对话流、流式 reducer、Composer（文本/图片/停止/steer/follow-up）、模型与思考级别、错误条 | 能在浏览器完成一次带工具调用的完整任务 |
| M3 交互 | 全部 `extension_ui_request`、审批卡、问卷卡、队列 chips、slash/@/!、工具渲染器全表 | E2E 审批与 ask 用例通过 |
| M4 会话操作 | 分支、分叉、会话树、压缩、交接、导出、重命名、归档/删除、重连回放、崩溃恢复 | E2E 刷新恢复、崩溃恢复通过 |
| M5 面板与设置 | Todo、子代理抽屉、变更、Goal、信息、旁问、账号登录、设置、通知、快捷键、命令面板 | 功能表 §4 全部有入口 |
| M6 可选 | Tauri 桌面壳、`live_*` 语音、host tools（如让 agent 读取浏览器选区） | — |

---

## 15. 待验证清单（M1 完成）

1. ~~delta 模式 `_end` 是否保留~~ 已确认保留：`withoutPartial` 只去 `partial`，`text_end.content` / `thinking_end.content` / `toolcall_end.toolCall` 都在（`rpc-session-events.ts:15`）。
2. ~~审批与 `tool_execution_start` 先后~~ 已确认：先 `tool_execution_start`，再在 `execute` 内触发审批 `select`（`agent-loop.ts:3478`→`wrapper.ts:414`）。锚定规则改为：同名且执行中（有 start 无 end）的最近一个工具调用。
3. ~~`@path` 是否由 omp 展开~~ 已确认：`prompt` 时 omp 自行展开，用户消息保留 `@path` 文本，另推一条 `fileMention` 消息；`steer`/`follow_up` 路径**不展开**（`agent-session.ts:8008` 为唯一调用点）。Bridge 不需要内联文件；运行中发送时在 @ 菜单提示不会展开。
4. ~~edit/write 的 details~~ 已确认：edit `details = {diff, firstChangedLine?, oldText?, newText?, path?, perFileResults?, op?, move?}`，`diff` 为 omp 自有行格式 `+123|content` / `-123|content` / ` 123|content`（非 git unified）；`oldText/newText` 为整文件前后。write 的 details 不含 diff。
5. ~~`--profile` 时会话目录路径~~ 已确认：有 profile 且未设 `PI_CODING_AGENT_DIR` 时为 `~/.omp/profiles/<profile>/agent/sessions`（`pi-utils/src/dirs.ts`），已在 bridge `defaultAgentDir()` 实现。
6. `get_branch_messages` 顺序与 transcript 中 user 消息的对应关系（§9.3）。
7. ~~只读预览的 jsonl 形状~~ 已确认：第 1 行定长 `title`，第 2 行 `session` 头；其后每条带 `id`/`parentId`，消息条目为 `{type:"message", message: AgentMessage}`；没有显式 `leafId`，当前叶子是文件中最后一个带 `id` 的条目，沿 `parentId` 回溯即当前分支。已在 bridge `parseTranscript()` 实现，解析开销可忽略。

每项结论写回本文档对应章节并删除标记。
