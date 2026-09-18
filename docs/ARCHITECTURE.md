# ARCHITECTURE — Flow (M0 decision)

Date: 2026-09-18. Status: accepted. Decides spec §2 Path A vs Path B.

## Decision

Build Flow greenfield as **Path B**: TypeScript + Ink (React for terminals) with a clean
driver abstraction — scaffolded from the Fable5 `ts-api` template and adapted to a CLI
per `CLAUDE.md` addendum. Do NOT fork OpenCode.

## Context

- Spec demands Windows-first (cmd + Windows Terminal + PowerShell), then macOS/Linux;
  no Unix-only deps in the core path; startup <1.5s; append-only JSONL sessions.
- Spec demands two driver types behind one interface
  (`sendMessage/streamMessage/countTokens/getQuota/healthCheck`): native API/SDK drivers
  (Anthropic, OpenAI, Google GenAI, OpenRouter, Ollama — required for multi-agent mode)
  plus CLI subprocess drivers (`claude -p --output-format stream-json`,
  `codex exec --json`, `gemini` non-interactive + auto-approve, `opencode run`,
  `aider --message`) with passthrough mode for single-model sessions, and a config
  routing table (default: `anthropic/*→claude`, `openai/gpt-*→codex`,
  `google/gemini-*→agy --yolo`, `*→opencode`).
- Research (`docs/FEATURE_MATRIX.md`, clones in `./research/`):
  OpenCode is Bun + Effect + Solid/OpenTUI + Hono + Drizzle/SQLite (MIT) — a large
  foreign stack that violates this repo's conventions (npm+tsc+vitest, layered
  `api/domain/infrastructure/lib`, `@/` alias, six commands, composition root in
  `src/app.ts`). Forking would import Unix-leaning Bun tooling, SQLite sessions
  (spec wants JSONL), and an Effect idiom the team does not use.
  Codex/Grok are Rust+ratatui, Crush is Go+Bubble Tea under FSL competing-use
  restriction (reimplement only), Aider is Python without MCP/skills/hooks/sandbox,
  Gemini CLI is Node+Ink (closest cousin) under Apache-2.0.
- Claude Code is proprietary: reimplement documented behavior only (done via docs).

## Consequences (why Path B wins)

- Keeps the kit's non-negotiables: `src/` layout, import arrows
  (entrypoint→anything; `api→{domain,lib}`; `infrastructure→{domain,lib}`;
  `domain→lib` only), ports in domain/implemented in infrastructure/wired only in
  `src/app.ts` + `src/index.ts`, strict `tsconfig` (`strict`,
  `noUncheckedIndexedAccess`), `any` banned, six npm verbs, colocated unit tests +
  `tests/integration` through `createApp()`.
- Ink matches Claude Code and Gemini CLI UX (full-screen picker, REPL, diffs, todo
  panel) and runs on Windows without Bun/Rust/Go toolchains; Node LTS only.
- Driver interface makes multi-agent orchestration possible (native drivers), while
  CLI drivers + passthrough reuse the user's installed CLIs and subscriptions
  (including `agy` for Gemini) without forking them.
- Costs: we reimplement the §8 parity surface (plus gap-fill list in
  `FEATURE_MATRIX.md`) instead of inheriting OpenCode's; mitigated by the §13 build
  order (M1 config/registry/drivers/REPL/tools → M6 CLI drivers/passthrough) and the
  headless-first E2E harness (`flow -p` + mock providers).
- Rejected Path A (fork OpenCode): would shortcut multi-provider auth but force a
  Bun/Effect/Solid runtime, SQLite→JSONL migration, convention violations, and a
  multi-thousand-file foreign baseline. Recorded here as binding unless superseded
  by a new ADR.

## Shape (maps to §3–§11)

```
src/
  index.ts        # thin bootstrap: loadConfig once, createApp, parse argv, launch picker/REPL/headless
  app.ts          # composition root createApp(config): wires registry, drivers, engines, commands
  config.ts       # ONLY module touching process.env (APP_*); flow.json registry+routing+prices merge
  api/            # CLI edge: argv parsing, selector TUI, REPL, headless --output-format, /commands
  domain/         # pure logic: blackboard, council/relay/workers/auto, permissions, compaction, quota, routing matcher
  infrastructure/ # native drivers (anthropic/openai/google/openrouter/ollama) + CLI subprocess drivers + keychain/sessions
  lib/            # pure helpers only (no local imports): logger, errors (AppError root), tokenizer estimate
flow.json         # model registry (context windows, prices), routing table, quotas (spec §11)
~/.flow/  .flow/  # settings/skills/agents/commands/themes/projects/<hash>/<session>.jsonl (spec §11)
```

- All tool calls funnel through ONE permission engine + ONE workspace; file locks +
  checkpoints make writes diffable/reversible; blackboard (task/constraints/plans/
  critiques/decision_log/todos/files/phase) injected per agent; per-agent transcripts
  compact independently at ~85% (PreCompact hook), blackboard persists.
- Telemetry off by default; keys in OS keychain/DPAPI or encrypted files, never in logs.

## M0 acceptance

Skeleton verified (`npm install → lint → test → build` green, committed with lockfile);
`FEATURE_MATRIX.md` + this file land in the next commit with `research/` gitignored.
M1 deletes the Express items example when config + REPL lands (per handover rule).
