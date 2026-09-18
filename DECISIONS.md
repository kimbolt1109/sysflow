# DECISIONS — Flow working log (spec §15)

Autonomous build; only truly-blocking questions go to the user. Newest first.

## 2026-09-18 — M8 polish + gap-fill pass (final)

- **npm: `flow` taken (v0.2.3), `flow-ai-cli` free** — package stays
  `flow-ai-cli` + `flow` binary per spec fallback. MIT LICENSE added;
  `private:true` kept until a human runs the first `npm publish`
  (needs npm auth — external step, not done autonomously).
- **Readline, not Ink, for the M8 TUI.** Ink is ESM-only and would force
  the package off CommonJS (`eslint.config.js` relies on CJS `require()`,
  build is plain `tsc`); the readline REPL + selector ship the full
  command surface now, Ink stays a render-layer swap (see ADR 003).
- **Gap-fill pass vs FEATURE_MATRIX:** shipped cheap/high-value items —
  `/fork /new /rename /copy /tasks /reload`, y/n/e diff approvals,
  per-CLI headless arg shapes (verified live against real `claude`
  2.1.220: `-p` needs `--verbose` with stream-json; stdin must be
  closed or `-p` hangs), Windows npm-shim resolution
  (.exe → .ps1 sibling → powershell `-File`, else `-Command` with
  PS-quoting; `cmd.exe /s` quoting is unreliable via spawn).
  Deferred with reasons: full-screen Ink TUI (CJS/ESM cutover),
  `Esc-Esc`/`shift+tab`/`ctrl+t` keybindings (need alt-screen),
  subscription-auth drivers (OAuth per provider), keychain secret
  storage (env-only today; probe only), OS sandbox enforcement
  (permission prompts are the Windows fallback per spec),
  ACP mode, worktrees, plugin marketplace, TOML policy engine
  (JSON rules instead), `/dashboard /schedule /ide` (no host UI).
- **Secrets:** env-only, masked in `/config`+`describeConfig`, never in
  JSONL beyond what the user pastes (same as all compared tools).

## 2026-09-18 — M7 quota, doctor, checkpoints, theming, notify

- **Usage/cost:** central `app.recordUsage` (registry pricing) +
  daily `usage.json`; warn/amber/confirm from `flow.json` quotas;
  `--max-cost` refuses headless overruns (exit 1); REPL warns + desktop
  bell on completion.
- **429s:** typed `QuotaError` everywhere; `withFailover` (backoff +
  jitter, Retry-After respected, driver rotation); council degrades to
  a paused state instead of crashing (§12).
- **Doctor** probes node/storage/auth/CLIs/network/MCP/keychain/ollama;
  warns (never fails) on missing auth — green on a clean machine.
- **Checkpoints** snapshot the workspace (capped) before council runs
  and file writes; work outside git; `/rewind` picker, `/undo`.
- **Theming:** presets + truecolor/`NO_COLOR` detection; per-agent
  colors thread through council view; `/theme` switches live.
- **Env discipline:** `loadConfig` is the only `process.env` reader
  (EDITOR/NO_COLOR/COLORTERM/APP_FLOW_THEME folded into Config).

## 2026-09-18 — M6 CLI drivers + passthrough

- **Headless arg shapes:** `claude -p --output-format stream-json
--verbose`, `codex exec --json`, gemini-style `-p --output-format
json`, `opencode run --format json`, `aider --message`; routing-table
  args appended (user's auto-approve flags).
- **Fallback chain:** native (key) → CLI (binary on PATH) → mock.
  Headless never passthroughs; solo REPL offers interactive passthrough
  (`--passthrough` forces). Proven live: real `claude -p` streams
  through `CliDriver` (user's proxy 410s at the API — env issue, not Flow).

## 2026-09-18 — M5 skills/memory/hooks/subagents/commands/MCP

- Ports keep `api/` clean: `ToolsPort`, `McpPort`, `HooksPort` in
  domain; `FlowApp` carries stores + `runSubagent`; `import type`
  is the only api←infrastructure direction (ADR 003).
- Hooks fire SessionStart/End, UserPromptSubmit, Pre/PostToolUse,
  PreCompact, Notification, Stop. Subagents run via `tool:task`
  fences (depth-capped, tool-filtered). MCP stdio+HTTP/SSE with a
  fixture-tested echo server.

## 2026-09-18 — M4 orchestrator

- Pure `runCouncil/runRelay/runWorkers/pickMode` over an
  `Orchestrant` port; `DriverAgent` adapts real drivers; tool loop
  uses provider-agnostic ```tool:* fences (mock-proven file writes).
- 2 rejections pause for the user; muted/stopped agents filter out.

## 2026-09-18 — M3 context engine

- chars/4 estimates (+4/msg overhead); `/context` bars;
  auto-compact at `APP_COMPACT_THRESHOLD` (default 0.85) with
  PreCompact hook; microcompaction elides old `tool` messages.

## 2026-09-18 — M2 drivers, selector, permissions, commands

- OpenAI-compatible base covers openai/openrouter/ollama; Gemini uses
  `generateContent`/`streamGenerateContent`. Selector remembers
  `last.json`; `/permissions` persists to `settings.local.json`.

## 2026-09-18 — M1 foundation

- Express skeleton replaced with CLI; `Bash(git commit:*)` rule
  semantics verified against real Claude-style prefix matching.

## 2026-09-18 — M0 scaffold + research

- **Path B (greenfield TS + Ink), not a fork.** OpenCode is Bun+Effect+Solid/SQLite
  (foreign stack, convention violations, SQLite vs spec JSONL); Codex/Grok are Rust,
  Crush is Go+FSL competing-use, Aider is Python w/o MCP/skills/hooks. Ink matches
  Claude Code/Gemini CLI and is Windows-clean. See `docs/ARCHITECTURE.md` + ADR 002.
- **Package `flow-ai-cli`, binary `flow`.** `flow` assumed taken on npm (verify at M8
  publish); spec §13 already prescribes this fallback.
- **Nearest-template adaptation (§9):** no `ts-cli` template exists; scaffolded from
  `ts-api`, kept the Express items example for skeleton verification only; it dies
  when M1 config+REPL lands (handover rule). CLI lives in `src/api/` over `domain/`;
  `src/app.ts` stays the sole composition root.
- **Research clones are behavior-only.** Licenses: gemini/codex/aider/grok Apache-2.0;
  opencode MIT; crush FSL-1.1-MIT (no code copy, competing-use ban); Claude Code
  proprietary (docs only). No code copied; `research/` gitignored.
- **GrokBuild IS public** (`xai-org/grok-build`, Apache-2.0, Rust, `-p/--single`,
  `--output-format plain|json|streaming-json`, skills/plugins/hooks/MCP/subagents,
  ACP). Studied like the rest; added to matrix.
- **Spec §8 is a floor.** Matrix adds the gap-fill list (dashboard/fork/recap/import/
  plugin/reload/ide/tasks/copy/export/rename/new/schedule, MCP prompts, ACP, background
  tasks, status line, worktrees, question/LSP/apply_patch tools, marketplace, trust
  dialog, TOML policy engine, sandbox profiles). Final Done pass diffs against
  `docs/FEATURE_MATRIX.md`.
- **CI added in M0.** Minimal GitHub Actions (`.github/workflows/ci.yml`):
  `npm ci → lint → test → build` on `windows-latest` + `ubuntu-latest`, Node 24.
  Windows-first per spec, Ubuntu guards portability.

## ASSUMPTIONS (confirm or override)

- `ASSUMPTION:` Node LTS (v24 local), npm (not pnpm — single package), CommonJS + `tsc-alias`.
- `ASSUMPTION:` Default routing keeps user's table verbatim incl. `google/gemini-* → agy --yolo`.
- `ASSUMPTION:` JSONL sessions at `~/.flow/projects/<hash>/<session>.jsonl` (spec §11), not SQLite.
