# 002. Choose Path B greenfield over forking OpenCode

Date: 2026-09-18
Status: accepted

## Context

Spec §2 forces one choice: fork OpenCode (Path A) or greenfield TypeScript + Ink
(Path B). Flow must be Windows-first, keep a clean native/CLI driver split for
council orchestration, use JSONL sessions, and obey the repo conventions (layered
`api/domain/infrastructure/lib`, strict TS, six commands, composition root).
Research (`docs/FEATURE_MATRIX.md`, `./research/` clones) shows OpenCode is
Bun + Effect + Solid/OpenTUI + SQLite — capable, but a foreign stack.

## Decision

Build Path B: greenfield TypeScript + Ink with a driver interface
(`sendMessage/streamMessage/countTokens/getQuota/healthCheck`), native drivers for
orchestration plus CLI subprocess drivers + passthrough (incl. `agy` routing).

## Consequences

Easier: conventions stay intact, Windows needs only Node, Ink matches Claude/Gemini
UX, sessions stay JSONL, no FSL/Effect/Bun baggage. Harder: we reimplement the §8
parity surface plus the gap-fill list instead of inheriting it. Superseding this
requires a new ADR.
