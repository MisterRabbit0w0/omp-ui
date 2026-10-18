# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

omp-ui is a local desktop-style web frontend for oh-my-pi (`omp`), driving `omp --mode rpc-ui` processes. Bun monorepo, TypeScript strict, ESM. Docs and UI copy are in Chinese.

## Commands

```sh
bun install
bun run start                 # bridge on 127.0.0.1:4317 (auto-increments), serves packages/web/dist, prints URL with #token=
bun run build                 # vite build of web -> packages/web/dist (bridge serves this)
bun run --filter '@omp-ui/web' dev   # vite on :5173, proxies /api and /ws to the bridge on :4317 (run bridge too)
bun run typecheck             # tsc in every workspace
bun test                      # all unit tests (bunfig sets test root = packages/)
bun test packages/bridge/test/pool.test.ts   # single file
bun test -t "name pattern"    # filter by test name
bun run test:e2e              # build + Playwright (e2e/*.spec.ts) against fake omp
bunx playwright test e2e/composer.spec.ts    # single E2E spec (needs a prior build)
bun run smoke:real            # build + smoke against a real omp install
bun run sync:wire             # regenerate packages/protocol/src/rpc-wire.ts from installed omp
```

Requires omp >= 18.11.x. `OMP_UI_OMP_BIN` overrides the omp command (may be a full command line); `OMP_UI_HOME` overrides `~/.omp-ui` (config, trash); `PI_CODING_AGENT_DIR` overrides `~/.omp/agent` (session discovery).

## Architecture

```
Browser (React SPA) --WS /ws (JSON envelope) + HTTP /api/* (Bearer)--> Bridge (Bun) --stdin/stdout NDJSON--> omp --mode rpc-ui  xN
```

- `packages/protocol`: types only, no runtime deps. `rpc-wire.ts` is copied verbatim from omp by `sync:wire` — never edit by hand and never redefine wire types elsewhere. `envelope.ts` defines the Browser↔Bridge messages (`C2B`/`B2C`); `approval.ts` holds approval-request detection shared by both sides.
- `packages/bridge`: `process.ts` (`OmpProcess`: line framing, `ready` → `negotiate_protocol` v2 → init commands, command id/timeout correlation, serialized stdin), `chunks.ts` (v2 `rpc_chunk` reassembly, so the frontend only sees whole frames), `pool.ts` (one process per session, cap 6, LRU eviction only of settled processes without pending UI requests; per-process seq ring buffer for `attach {sinceSeq}` replay or `resync`; pending `extension_ui_request`s re-sent on attach, first answer wins + `ui_resolved`), `sessions.ts` (scans `sessions/**/*.jsonl` headers, first 4KB only; read-only transcript preview without spawning), `files.ts` (cwd-restricted reads with realpath checks), `config.ts` (archive list, trash), `server.ts` (HTTP + WS, token + Origin checks).
- `packages/web`: React 19 + Vite + Tailwind v4 + Radix + zustand. `store/session-reducer.ts` is the core: the bridge sets `messageUpdates:"delta"`, so the reducer accumulates streaming deltas into drafts and `message_end` always overwrites with the full message (DESIGN §6.2); run state machine in §6.3. `store/app-store.ts` + `lib/ws.ts` handle attach/cold-start fetch/reconnect. UI is organized under `src/features/<area>/`, each with pure logic in `*-utils.ts`/`logic.ts` (unit-tested) and components re-exported via `index.ts`; primitives in `src/ui/`; `@/` aliases `src/`. Tool call renderers are registered in `features/tools/registry.tsx`. `/gallery` renders component states from `src/fixtures/`.
- Tests: `packages/bridge/test/fake-omp.ts` simulates omp (env knobs documented in its header) and is used by both bridge tests and E2E. `e2e/fixtures.ts` boots a real bridge per test on a random port with temp `OMP_UI_HOME`/`PI_CODING_AGENT_DIR` and fixture session files; browser console errors fail the test.

## Specs

- `docs/DESIGN.md` is authoritative for behavior and protocol (process model, reducer rules, UI request handling, HTTP API). `docs/FRONTEND.md` is authoritative for visuals (tokens, sizes, motion); `prototype/index.html` is the static visual reference. Read the relevant section before changing behavior or styling.
- Colors/shadows come from tokens in `packages/web/src/styles/tokens.css` via Tailwind semantic classes; no literal colors in components.
- Pin exact dependency versions (no `^`/`~`).
- Bridge security invariants (DESIGN §3.7): listen on 127.0.0.1 only, random token (URL hash → sessionStorage), Origin check, path-restricted file API. The bridge is equivalent to local code execution; don't weaken these.
