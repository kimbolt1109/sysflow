# 007. Council learning loop (agents improve over time)

Date: 2026-09-22
Status: accepted

## Context

Every council plan/output is already vetted by multi-model conversation:
draft fan-out → critique rounds → lead synthesis (`planCouncil`), then
per-lens verification with a 70% gate and a 2-rejection review pause
(`finishCouncil`, `VERIFY_MIN_AVG`). Covered by
`orchestrator.test.ts` ("pauses when verification fails its benchmark",
"pauses for the user after consecutive rejections") and `council.test.ts`.

But improvement-over-time was missing: per-agent `retro()` calls were
collected, rendered into display text, then dropped — `council-end`
session records kept only lead/plan/board/paused. No future run ever saw
them, so each council started amnesiac.

## Decision

- `api/council.ts` persists `verify`, `retros`, and `pauseReason` on every
  `council-end` record (run + approve paths).
- New pure domain module `src/domain/learnings.ts`: `extractLessons`
  distills failed verifications, pause reasons, and retros from session
  records (most-recent `cap`, text clipped); `lessonsContext` renders the
  agent context block ("" when empty, char-capped keeping newest).
- `src/app.ts` gains `recallLessons(sessions, cap)` (best-effort, never
  throws; scans the last 10 project sessions). `createDriverAgents`
  appends it to the agent context prefix, so every council agent on every
  surface (TUI, REPL, headless) learns from past runs.
- Solo surfaces get the same block through composition-root props, not
  imports (`api/` never imports `app.ts` values): `Session.lessons`,
  `ReplOptions.lessons`, `HeadlessOptions.lessons`, all fed by
  `recallLessons` in `src/index.ts`.
- Also fixed a duplicated `setPhase(board, "REVIEW")` in
  `finishCouncil` (emitted REVIEW twice into phase tracking).

## Consequences

- Failed verifications and pauses teach future runs automatically;
  retros accumulate per project via the existing session store — no new
  storage, no new dependencies.
- Lessons are bounded (8 council / 5 solo, ~2000 chars) to protect the
  context window; recall is best-effort and cannot break agent creation.
- Solo `runSubagent` tasks do not yet receive lessons (no prefix
  channel); headless solo previously ran with zero system context and now
  gets the lessons block. Relay/workers modes record verdict-less
  `council-end`s, which the extractor safely skips.
