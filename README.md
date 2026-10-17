# omp-ui

为 oh-my-pi（`omp`）提供类 Claude Desktop / Codex 的本地图形前端：多会话、多项目的桌面式聊天界面，覆盖 `omp --mode rpc-ui` 的命令与事件（流式对话、工具调用可视化、审批、子代理、Todo、Goal、分支/分叉、压缩等）。

## 架构

```
Browser (React SPA)
   │  WebSocket /ws  (JSON envelope)
   │  HTTP /api/*
Bridge (Bun 服务, 127.0.0.1)
   │  每个打开的会话一个子进程
   │  stdin/stdout NDJSON (omp RPC)
omp --mode rpc-ui  ×N
```

浏览器不能 spawn 进程，且会话列表需扫磁盘（`~/.omp/agent/sessions/`），因此由 Bridge 代理；前端刷新/断线时进程与待答 UI 请求保持存活。

## 仓库布局

```
packages/
  protocol/   # 纯类型 + 帧工具（rpc-wire、envelope、approval）
  bridge/     # Bun 服务：HTTP + WS、进程池、会话发现、受限文件读取
  web/        # React 19 + Vite + Tailwind v4 + Radix UI 前端
docs/         # DESIGN.md（实现依据）、FRONTEND.md（视觉/交互规范）
e2e/          # Playwright E2E + 真实进程冒烟
prototype/    # 早期静态原型
```

## 开发

依赖：Bun、omp ≥ 18.11.1。

```sh
bun install

bun run dev          # 启动 bridge（含 web dev）
bun run build        # 构建 web
bun run start        # 运行 bridge，打印 http://127.0.0.1:<port>/#token=<token>

bun run typecheck    # 全部 workspace tsc
bun test             # 单元测试（reducer/bridge）
bun run test:e2e     # 构建 + Playwright E2E
bun run smoke:real   # 构建 + 真实 omp 进程冒烟
bun run sync:wire    # 从已安装 omp 重新生成 rpc-wire.generated.ts
```

Bridge 只监听 127.0.0.1，启动时生成随机 token（`Authorization: Bearer` / WS 首帧校验）并校验 `Origin`。该服务等价于本机代码执行能力，**不要**用反向代理暴露它。

## 文档

- [docs/DESIGN.md](docs/DESIGN.md) — 协议映射、状态机、UI 行为定稿
- [docs/FRONTEND.md](docs/FRONTEND.md) — token、组件外观、动效
