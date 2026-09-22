# 005. ESM cutover for the Ink TUI (`flow tui`)

Date: 2026-09-19
Status: accepted (supersedes ADR 003's readline-only UI; 003's layer rules still hold)

## Context

ADR 003 deferred Ink because it is ESM-only and the package built as
CommonJS (`tsc`, CJS `eslint.config.js`). The readline REPL cannot carry
the OpenCode-class UX requested: full-screen picker, transcript with
agent/sidebar panels, and a `/` menu over skills, subagents, and custom
commands.

## Decision

- Cut the package to ESM: `"type": "module"`, `module`/`moduleResolution`
  `nodenext`, `jsx: react-jsx`. All 239 `@/` imports carry `.js`
  extensions so Node ESM resolves the `tsc-alias` output.
- `eslint.config.js` and `vitest.config.ts` converted to ESM
  (`import.meta.dirname` replaces `__dirname`).
- `flow tui` (Ink 7 + React 19 + `@inkjs/ui`) owns picker → mode →
  session screens under `src/api/tui/`; the readline selector/REPL and
  headless `-p --output-format` paths stay untouched.
- Runtime composition stays in `src/index.ts`: the TUI receives a
  `FlowApp` plus `createAgents`/`createDriver` factories, so `api/`
  never constructs adapters (ADR 003's boundary, intact).
- Fixtures: `tests/fixtures/mcpEcho.js` renamed to `.cjs` (it uses
  `require()`); `cliEcho.js` is require-free and stays `.js`.

## Consequences

- `dist/` is ESM; the `flow` bin works unchanged via the npm shim.
- New deps: `ink`, `react`, `@inkjs/ui` (+ `@types/react` dev).
- TUI session is v1: fresh session per launch (no `-c`/`-r` yet), no
  `/read`-class tool commands yet (skills, `/agents run`, council
  interjects, `/cost`, `/context` work). Gaps tracked in the roadmap,
  not here.
- Reverting means deleting `src/api/tui/` + `flow tui` wiring and
  flipping the module fields back; domain/drivers are UI-agnostic and
  unaffected either way.
