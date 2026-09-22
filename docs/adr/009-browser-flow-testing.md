# 009. Browser-driven flow testing for agents

Date: 2026-09-22
Status: accepted

## Context

Agents could screenshot but not open what they built: no tool launched
a real browser, and the system prompt never told them to test the
running app. Verification therefore graded summaries, and planners
drafted without ever seeing the product. "It works" meant "the code
looks right", never "I clicked through it".

## Decision

- New `browse {url}` loop tool backed by `src/lib/browser.ts`
  (`openBrowser`: Windows/macOS/Linux dispatch, injectable runner,
  http(s)-only, never throws). The opener reply teaches the loop:
  screenshot, then click/type through the flow.
- `TOOL_SYSTEM` carries the flow-test recipe: start the app detached,
  browse its URL, screenshot to see it, drive everything that matters.
- `browse` wired into every loop (execute, subagents, `runSubagent`
  tasks, solo TUI/REPL/headless).
- Grading loops stay observe-only but gain eyes: `browse` and
  `screenshot` join the read-only gate (`readOnlyCheck`), while
  click/type/key/write/edit/bash stay denied. Graders confirm against
  the running thing; they still cannot change it.
- `WebFetch`-style permission rules cover `browse` automatically via
  `targetFor` (`domain:host`); plan mode asks first.

## Consequences

- Building a site/app now ends with a real walkthrough by default;
  failures surface as screenshots and lessons (ADR 007), not prose.
- Opening a browser is a visible side effect (new window/tab) — expected
  and intended when testing; headless environments report a clear
  failure message instead of hanging.
- No new dependencies; no port changes (loop-level tool like
  task/skill/question/webfetch/mcp).
