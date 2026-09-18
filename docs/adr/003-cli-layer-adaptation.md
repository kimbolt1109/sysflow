# 003. CLI layer adaptation (readline over Ink, ports, api boundaries)

Date: 2026-09-18
Status: accepted

## Context

The kit's layer rules were written for HTTP services (`api/` routes receive
domain-typed params; `infrastructure/` holds DB/HTTP adapters). Flow is a
one-shot + REPL CLI on CommonJS (`tsc`, no bundler). Ink (the React TUI the
spec's Path B names) is ESM-only and would force the package off CommonJS,
breaking `eslint.config.js` (CJS `require()`) and the plain-`tsc` build.

## Decision

- Ship the M8 TUI on `node:readline` (selector, REPL, headless) behind the
  same command surface; treat Ink as a future render-layer swap.
- `api/` holds CLI command modules importing `domain/` + `lib/` values and
  `infrastructure/`/`app` **types only** (`import type`, erased at runtime —
  no runtime cycles possible). All runtime composition lives in `src/app.ts`
  - `src/index.ts`, which may import everything.
- Cross-cutting file/HTTP/subprocess work lives in `infrastructure/` behind
  domain ports (`ToolsPort`, `McpPort`, `HooksPort`, `Driver`); `FlowApp`
  exposes behavior (`runSubagent`, `takeCheckpoint`, `diagnose`, …) so `api/`
  never constructs adapters.
- `loadConfig` (`src/config.ts`) is the only `process.env` reader, including
  UI prefs (`EDITOR`, `NO_COLOR`, `COLORTERM`, `APP_FLOW_THEME`).

## Consequences

`tsc` + ESLint enforce the practical boundary (no `any`, strict null
checks); the type-only rule is discipline + review. Swapping in Ink later
touches `src/api/` view code only — domain and drivers are UI-agnostic.
Superseding needs a new ADR.
