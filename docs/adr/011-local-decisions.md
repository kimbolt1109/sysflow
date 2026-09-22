# 011. Local decision layer (Jev jobs, Laya-compatible)

Date: 2026-09-22
Status: accepted

## Context

Jev AI (TypeSafe) showed that agents spend most tokens _deciding_, not
doing: tool selection, routing, confidence gating, self-checks, triage,
guardrails. Jev is a hosted API; Laya (`NandhaKishorM/laya`, Apache-2.0)
is the open local equivalent — a System-One model answering typed
choice/score/noul questions with probabilities. A 400M-parameter
transformer cannot live inside this Node CLI, but the _jobs_ can: fast,
structured judgments with the same question shapes.

## Decision

- New pure engine `src/domain/decide.ts`: `choice` (criteria-overlap +
  softmax probabilities, `other`-fallback), `score` (ordinal expected
  value), `noul` (cue evidence with Laplace smoothing and negation
  flips), all answered in one `decideAll` pass; `formatDecisions`
  renders agent-readable verdicts. Guard/triage presets mirror Laya's
  `presets.py` with local cue lists.
- `src/infrastructure/layaClient.ts` bridges to a Laya-compatible
  server (`POST {base}/decide`, sys decide protocol) configured via
  `APP_LAYA_URL`, falling back to the local engine on any failure —
  decisions never hard-fail and work fully offline by default.
- `decide {questions, state?}` loop tool in every agent loop (execute,
  subagents, planning/grading, solo everywhere); validated question
  shapes with helpful errors.
- Auto guard-screening (`screenPrompt`): risky prompts (jailbreak,
  injection, sensitive data, severe harm) get a visible advisory in
  TUI/REPL/headless — flagged, never silently blocked.
- `/triage` command (TUI + REPL) runs routing presets over arbitrary
  text with a named source (`local` vs `laya`).

## Consequences

- The local engine is a transparent heuristic, not a model: honest on
  fuzzy wording, strong on keyword-shaped criteria. Thresholds
  (noul ≥ 0.5, guard flag ≥ 0.6, severity ≥ 2) are documented in code
  and tunable; real calibration needs a Laya server + labeled data.
- Guard screening is advisory by design — autonomy stays with the user
  and the permission layer, which remains the enforcing gate.
- No new dependencies.
