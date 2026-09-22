# 010. Driver retries and turn timing

Date: 2026-09-22
Status: accepted

## Context

Three gaps in the "waiting room" experience:

1. `withFailover` (429 rotation) existed in `domain/quota.ts` but was
   wired to nothing — rate limits, 5xx, and network blips threw straight
   through to the user.
2. Nobody reported how long a turn took. The TUI showed live elapsed
   while busy, then forgot it; REPL/headless showed nothing.
3. Loading states were uneven: TUI spinner + elapsed + council phase
   lines existed, but REPL streamed into silence while the model thought.

## Decision

- New `RetryDriver` decorator (`src/infrastructure/retryDriver.ts`):
  retries QuotaErrors (honoring `retry-after`, capped), network errors,
  and 5xx with jittered backoff (3 attempts default, injectable sleep).
  Auth/client errors never retry. Retries happen only before the first
  token — replaying a partial stream would regenerate (and duplicate)
  output, so mid-stream breaks surface instead.
- Wrapped around every native/API driver in `nativeDriverFor` (which
  also covers `createDriverFor`); CLI and mock drivers excluded so
  local commands never re-execute side effects. Retries announce on
  stderr (`[retry 1/3 in 2.0s: …]`), matching the existing `[quota]`
  notice convention.
- `runToolLoop` accumulates driver-reported token usage, fixing headless
  cost accounting to real numbers.
- Turn timing: TUI status bar shows `took Xs` for the last turn; REPL
  prints `[took Xs]` after solo and council turns.

## Consequences

- Transient API failures self-heal in normal use; persistent ones still
  fail loudly after 3 attempts with the last error.
- stderr retry notices can interleave with the TUI frame on the rare
  retry path — accepted (same tradeoff as the existing quota notice).
- No interface changes (`Driver` untouched); fully unit-tested with
  scripted flaky drivers, no network in tests.
