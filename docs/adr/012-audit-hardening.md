# 012. Whole-tree audit hardening

Date: 2026-09-22
Status: accepted

## Context

A top-to-bottom audit (three parallel reviewers, every finding
re-verified against the code) surfaced real bugs across stores,
permissions-gated commands, argv parsing, and unattended execution.

## Decision

- **Stores**: session ids are validated (no path traversal), torn JSONL
  lines are skipped instead of hiding history, checkpoint dirs are
  scoped by project hash, snapshots report truncation, restores report
  per-path failures.
- **Trust**: project hooks and project MCP servers execute local code,
  so new projects ask once (remembered); headless runs fall back to
  user-level only with a notice.
- **Execution safety**: MCP HTTP calls time out, stdio servers settle on
  early exit, CLI output is capped at 2MB, provider fetches time out
  (120s send / 10min stream), empty model replies fail loudly, images
  are size-capped with known MIME types, macOS notifications escape
  quoting, command discovery survives one bad file.
- **REPL correctness**: `/new` and `/rename` actually switch sessions
  (and reset costs); PreCompact blocks before history is replaced;
  `/copy` parses `path` vs `N path`; `/export` and `/copy`-to-file honor
  plan mode and confirmation; `/undo <id>` honors the id.
- **Entry**: flags parse after subcommands (`sys repl -c` works); bare
  `sys --model/--agents/--mode` seeds the TUI pickers; `--verbose`
  enables debug logging; `--passthrough` warns where it cannot apply.
- **TUI parity**: `/status /compact /undo /rewind /sessions /tasks
/export /init /memory /permissions /reload /review` now work in the
  session; slash matching is case-insensitive; prompt menu dismissal
  survives cursor moves; pending-question keys are unique.
- **Domain**: compaction carries leading system directives; forced model
  refresh overwrites stale registry data; memory paths join
  deterministically; `@file` accepts Windows paths and spaced names;
  routing `?` matches permissions semantics.

## Consequences

- Several behaviors got stricter (id validation, unknown image types
  skipped, empty replies error). All are covered by tests asserting the
  new contract.
- Checkpoint dirs moved under a project hash: pre-existing checkpoints
  are orphaned (they were ephemeral by design).
- Known remaining gap (test-only): no integration harness drives the
  interactive TUI (queue-drain, permission cycle); TUI logic stays
  covered at unit level.
