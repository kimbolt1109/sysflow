# 006. TUI conversation-visibility redesign (`flow tui` session screen)

Date: 2026-09-22
Status: accepted

## Context

The `flow tui` session rendered the whole transcript on every frame with no
viewport, no scrollback affordance, and minimal role distinction (ADR 005
shipped it as v1). Long council runs pushed the prompt off-screen, errors
looked like dim info lines, queued follow-ups were a bare count, and the
sidebar always cost 42 columns. Research into Claude Code (transcript viewer,
queue-while-busy, `Esc`/`Ctrl+C` contracts) and grok-build (scrollback blocks
with folding, queue/tasks panes, status line, collapsible chrome) gave us
transferable patterns that fit Ink without copying proprietary code.

## Decision

- New pure domain module `src/domain/transcript.ts`: ANSI/invisible-char
  sanitizing, entry-window viewport math (`viewportSlice`/`scrollStep`),
  elapsed formatting, queue preview, transcript capping. No I/O, unit tested.
- `SessionView.tsx`: role cards (user `❯` cyan, assistant `◆` green, error
  `✖` red, diff colors, dim info), timestamps, empty state, entry-window
  viewport with `▲ earlier` / `▼ scrolled` indicators, `Header`/`StatusBar`/
  `ShortcutsBar`/`QueuePane`/`HelpOverlay`, collapsible `SideBar` with queue,
  running label, and context bar.
- `Session.tsx`: PgUp/PgDn scroll with live follow, responsive sidebar
  (auto-collapse under 90 columns, `Ctrl+B` override), `Ctrl+S` draft
  stash/pop, `Esc Esc` help toggle, visible queue pane, sanitized pushes
  (capped at 2000 entries), errors promoted to the `error` role, live
  context % in the status bar, grouped slash menu with fuzzy matching and
  `/quit`→`/exit`, `/new`→`/clear` aliases.
- Pickers keep behavior; chrome only (step indicators, bordered panels,
  green cursor markers).

## Consequences

- Conversation stays visible: follow mode by default, scrollback reachable
  via keyboard, stream corruption from ANSI/invisible unicode eliminated at
  the push boundary.
- No new dependencies; `api/` still only builds on `domain` + `lib`.
- Follow-ups (update 2026-09-22): width-aware wrapped-row viewport,
  `/find` cycling search with match highlight, and `/dump` markdown export
  are done. Remaining: arrow-key slash selection (needs replacing the
  single-line TextInput, whose Tab is inert and Enter auto-accepts prefix
  ghost text), multiline input, transcript dump to native scrollback.
