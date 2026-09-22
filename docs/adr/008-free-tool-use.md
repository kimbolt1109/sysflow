# 008. Free tool use for every agent (capability audit fixes)

Date: 2026-09-22
Status: accepted

## Context

A capability audit ("are tool calling, computer use, skill calling,
browsing freely happening?") found agents fenced off from their own
toolbox in five places, plus one permission bug:

1. Solo sessions (TUI, REPL, headless) streamed chat only — the model
   could not read, write, run, fetch, or call anything.
2. Subagents spawned via `task` had no MCP access (`onMcpTool` missing).
3. No web tool existed at all, though permissions already anticipated
   `WebFetch(domain:…)` rules and `targetFor` already extracted `url`s.
4. Planners drafted blind (`draft()` forbade tool fences); verifiers
   graded text-only while their prompt demanded "concrete checks".
5. Models could not discover MCP tools — inventory only rendered in
   human `/mcp` listings, so agents had to hallucinate names.
6. `checkPermission` compared capitalized names (`"Read"`) against
   lowercase fence names (`"read"`), so plan/acceptEdits modes and
   user rules silently never matched.

## Decision

- `checkPermission` normalizes tool case once; rules, plan, and
  acceptEdits modes match runtime fence names (regression-tested).
- New `webfetch {url}` loop tool (fetch→text, HTML stripped, capped,
  never throws) with an injectable fetcher; advertised in `TOOL_SYSTEM`.
- `task`-spawned subagents and `runSubagent` tasks get MCP, skills,
  webfetch, and past lessons.
- Draft/verify/review run read-only tool loops (read/glob/grep/webfetch/
  skill/question plus MCP _discovery_); mutating MCP calls stay denied
  there. Review prompt hunts missing tests/docs/errors; retro asks for
  forward-looking lessons (feeds ADR 007).
- New `mcp {}` discovery fence backed by `formatMcpInventory`
  (`domain/mcp.ts`), wired into every loop.
- `runToolLoop` gains a `seed` option; solo TUI/REPL/headless turns run
  the full loop seeded with conversation history, under the same
  permission checks, hooks, skills, questions, web, and MCP as council
  members. `runSoloTurn` removed.
- TUI prompt rebuilt (`promptState.ts` pure core + `PromptInput.tsx`):
  history (`↑↓`), arrow-key slash menu (`Tab`/browse-`Enter` accept),
  multiline (`\`+`Enter`), readline kills (`Ctrl+A/E/U/K/W`).

## Consequences

- Every agent on every surface can reach every capability; restrictions
  that remain are deliberate: subagent depth cap (1), tool allowlists
  per subagent def, plan-mode ask-gating, destructive-act approval,
  non-interactive ask→deny, hook blocks.
- Loop streaming surfaces raw fences mid-turn (REPL stdout, TUI bubble);
  final answers stay clean. Accepted as consistent, not polished.
- No new dependencies; `api/`→`infrastructure` value imports follow the
  existing `costView.ts` precedent.
