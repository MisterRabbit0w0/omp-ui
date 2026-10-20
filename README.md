# omp-ui

[![CI](https://github.com/MisterRabbit0w0/omp-ui/actions/workflows/ci.yml/badge.svg)](https://github.com/MisterRabbit0w0/omp-ui/actions/workflows/ci.yml)

为 oh-my-pi（`omp`）提供类 Claude Desktop / Codex 的本地图形前端：多会话、多项目的桌面式聊天界面，覆盖 `omp --mode rpc-ui` 的命令与事件（流式对话、工具调用可视化、审批、子代理、Todo、Goal、分支/分叉、压缩等）。

## 安装与使用

依赖：[Bun](https://bun.sh) ≥ 1.1、omp ≥ 18.11.1。

```sh
bunx omp-ui --open          # 直接运行最新版并打开浏览器
# 或全局安装
bun add -g omp-ui
omp-ui --open               # 可选 --port N（默认 4317）
```

找不到 `omp` 时可用环境变量 `OMP_UI_OMP_BIN` 指定命令。

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

### 测试与 CI

| 命令 | 需要真实 omp | CI |
|---|---|---|
| `bun run typecheck` / `bun test` | 否 | ✅ |
| `bun run test:e2e` | 否，由 `packages/bridge/test/fake-omp.ts` 模拟 | ✅ |
| `bun run smoke:real` | 是 | 仅本地 |

E2E 需要 Node 22+ 和 Playwright Chromium（`bunx playwright install chromium`）；本机已有其他版本的 Chromium 时会自动回退，也可以用 `PW_CHROMIUM_PATH` 指定。

### 发布

1. 修改根 `package.json` 的 `version`，提交。
2. `git tag v<version> && git push --follow-tags`。
3. `.github/workflows/release.yml` 会运行检查、执行 `bun run release:build`（产物在 `release/`），发布到 npm 并创建 GitHub Release。

本地预览发布包：`bun run release:build && cd release && npm pack --dry-run`。

## 安全

Bridge 只监听 127.0.0.1，启动时生成随机 token（`Authorization: Bearer` / WS 首帧校验）并校验 `Origin`。该服务等价于本机代码执行能力，**不要**用反向代理暴露它。

## 文档

- [docs/DESIGN.md](docs/DESIGN.md) — 协议映射、状态机、UI 行为定稿
- [docs/FRONTEND.md](docs/FRONTEND.md) — token、组件外观、动效
