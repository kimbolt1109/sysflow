# DECISIONS — Flow working log (spec §15)

Autonomous build; only truly-blocking questions go to the user. Newest first.

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
