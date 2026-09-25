# 013. CLI driver contract: full prompts, per-CLI streams, read-only calls

Date: 2026-09-25
Status: accepted (amends 008)

## Context

A review found every built-in route (claude, codex, agy, grok, opencode) broken in the
same way: `CliDriver` sent only the last user message. System prompts, conversation
history, the tool-fence protocol, and tool results never reached CLI models, so solo
chats had no memory, tool loops re-sent the original task, and council critique/verify
instructions were lost (every verify fell back to 50% and paused the run). ADR 008's
claim that solo turns run "seeded with conversation history" held only for API drivers.

Other findings, each checked against the live CLIs on Windows:

- npm `.ps1`/`.cmd` shims (claude, opencode) re-parse argv through PowerShell and strip
  quotes: `say "hello" and {"path": "a b.ts"}` arrived as `say hello and {path: a`.
- The generic JSON scraper returned claude's init slash-command list plus the answer
  twice; agy never streamed (`--output-format json` is one blob at exit).
- agy-listed models were routed by id prefix, so `claude-opus-4-6-thinking` ran on the
  claude CLI; opencode-listed models never passed `--model`.
- Discovery used `spawnSync` serially, blocking the event loop (up to ~45s).

## Decision

- **Prompt**: `renderCliPrompt` flattens system text, earlier turns (oldest dropped first
  under a budget), the current task, and tool progress into one prompt. A bare single
  user message passes through unchanged.
- **Transport**: agy takes the prompt on stdin (`--input-format stream-json -p=` with one
  `{"event":"user","message":{"role":"user","content":…}}` line), so no argv limit
  applies. Other CLIs keep argv, capped at 20k chars on Windows. npm shims resolve to
  their real target and launch directly.
- **Output**: one parser per CLI (`cliOutput.ts`): agy `step_update.text_delta` and
  `result`; claude `assistant` and `result`; opencode `text` and `step_finish`; grok's
  JSON document. Parsers report real token usage and turn errors (agy `status: ERROR`,
  claude `is_error`); unknown CLIs keep the generic scraper.
- **Read-only calls**: `Driver.sendMessage/streamMessage` take `{ readOnly }`. Draft,
  critique, synthesis, review, verify, retro, `/review`, and plan-mode turns set it.
  claude and grok swap their auto-approve flags for `--permission-mode plan` (verified:
  no file written). agy has no per-run read-only switch: `--mode plan` writes a plan and
  then executes it in print mode, and `write_to_file` needs no approval. Read-only agy
  calls therefore drop `--dangerously-skip-permissions` (blocks shell commands) and carry
  a READ-ONLY notice in the prompt (verified refusal); file writes are not hard-blocked.
- **Effort**: the thinking level maps to `--effort` for agy (unless the model id pins it)
  and claude.
- **Routing**: a model a CLI listed (`source` agy/opencode/grok) runs through that CLI
  and skips API drivers; opencode models pass their full id as `--model`.
- **Council**: a failed draft drops that agent; failed critiques, grades, and reviews are
  skipped or abstain; a failed synthesis keeps the lead's draft. Unscored verdicts are
  excluded from the average instead of counting as 50%.
- **TUI** (amends 008's "raw fences mid-turn, accepted as not polished"): fences are
  hidden while streaming and each call becomes a `⏺ tool target / ⎿ result` line;
  replies render as markdown.

## Consequences

- CLI prompts grow with history; the budget trims the oldest turns first.
- agy read-only remains instruction-level for file writes. Hard enforcement would need
  deny rules in `~/.gemini/antigravity-cli/settings.json`, which would also block
  execution runs, so it is not done.
- codex and opencode read-only flags are unmapped (codex is not installed here;
  opencode's plan agent was not verified in `run` mode).
