# USAGE — Sys user guide

## Entry points

`sys` opens the full-screen session directly. The picker lists every known
model: the `flow.json` registry plus live
discovery from your installed tools (`opencode models`, `agy models`,
`grok models`, Ollama `/api/tags`, OpenRouter's catalog), cached for
30 minutes in `~/.flow/discovered.json`. Navigate with ↑↓, type to
filter, Enter/Space toggles, `a` toggles a provider group, `m` confirms
the selected agents, Esc cancels (Esc clears the filter first).
Recently picked models sit in a `recent` group on top.
Then pick the orchestration mode and the thinking level
(`low|medium|high|xhigh`, steered via the system prompt so it works on
any model). Selected models remember themselves for next time.

```
sys                           # full-screen session (default)
sys repl                      # classic readline session
sys --model openai/gpt-5      # skip the picker
sys --model a,b --mode council
sys models [--refresh]        # registry + live discovery (opencode/agy/grok/ollama/openrouter)
sys repl -c / sys repl -r [id] # continue latest / resume (repl)
sys -p "task" [--agents a,b] [--mode council|relay|workers|auto]
  [--output-format text|json|stream-json] [--max-cost N] [--json] [--no-notify]
sys models | sys doctor | sys sessions
sys mcp [list|add stdio <name> -- <cmd>|add http|sse <name> <url>|remove <name>]
sys config [get [key]|set defaultModel <id>|edit]
sys update                    # via npm (sysflow)
```

Flags: `-y/--yolo/--dangerously-skip-permissions`, `--permission-mode
default|acceptEdits|plan|bypassPermissions`, `--permission-mode`, `--verbose`.

## TUI (`sys`)

Full-screen UI: model picker (`Enter`/`Space` toggle, `m` done, `recent`
group on top) → mode select → thinking level → session with transcript,
agents/skills sidebar, and a `/` menu. `Shift+Tab` cycles permission
mode (`default` → `acceptEdits` → `plan`; bypass stays `-y` startup-only).
`/<skill>` runs a skill (body loads on demand), `/agents run <name>
<prompt>` spawns a subagent, council interjects (`/mute /promote
/mode …`) and `@agent` DMs work as in the REPL. `/exit` quits.
Prompt: `↑↓` browses history and the `/` menu, `Tab` accepts,
`\`+`Enter` inserts a newline, `Ctrl+S` stashes, `PgUp/PgDn` scrolls the
wrapped-row transcript, `/find` searches it, `/dump` saves it.
Solo sessions run the same tool loop as council members
(read/write/edit/bash/glob/grep/webfetch/skills/MCP/computer-use),
gated by the permission mode.

## REPL

Streaming answers, `/help`, `/clear`, `/model`, `/models`, tool commands
(`/read /write /edit /bash /glob /grep`), diffs approved with
`y` (yes) / `a` (always → saved to `.flow/settings.local.json`) /
`e` (edit content first) / `n` (no). `shift+tab` plan-mode cycling and
`Esc-Esc` rewind need the full-screen TUI (tracked); until then use
`--permission-mode plan` and `/rewind`.

Context: `/context` bars (system/tools/memory/skills/mcp/messages),
`/compact [focus]` anytime, auto-compact at 85% (`APP_COMPACT_THRESHOLD`).
Costs: `/status` per-provider quotas, `/cost` session + daily spend,
`--max-cost` and `APP_DAILY_BUDGET` gates (warn 70 / amber 85 / confirm 95).

Sessions live as JSONL in `~/.flow/projects/<hash>/`: `/sessions`,
`/resume [id]`, `/fork [id]`, `/new`, `/rename <name>`, `/tasks`,
`/copy [n] [file]`, `/export [file]`. Checkpoints precede council runs
and file writes: `/rewind [id]`, `/undo`.

## Multi-agent

Modes: `council` (fan-out → critique → synthesis → execution → verify
(benchmark-style 0–100% per perspective: correctness, edge-cases,
requirements, security, simplicity; below 70% or any failed lens pauses
for you) → review → retro; 2 rejections pause for you), `relay` (take
turns), `workers`
(parallel subtasks with file locks), `auto` (size-based heuristic),
`solo`. Plan mode (`/plan [on|off]`, council only): the council pauses
after the merged plan — `/approve` executes, new instructions replan.
Live view shows `[agent]` badges and phase lines
(`PLANNING → DEBATE → SYNTHESIS → EXECUTION → REVIEW`).
Controls: `/agents`, `/mute`, `/unmute`, `/promote <a>`, `/handoff <a>`,
`/mode <m>`, `/round <1-5>`, `/stop-agent <a>`, `@agent` direct messages,
`Esc` to interject. `/agents run <subagent> <prompt>` spawns Task-tool
subagents from `.flow/agents/*.md` (depth-capped, tool-filtered).

## Memory, skills, hooks, commands

- Memory: `~/.flow/FLOW.md` → `.flow/FLOW.md` → `.flow/FLOW.local.md`,
  `@file` imports; `/memory [edit]`; `/init` scaffolds and imports
  `CLAUDE.md`/`AGENTS.md`/`GEMINI.md` once.
- Skills: `SKILL.md` (name/description/allowed-tools) in
  `~/.flow/skills/` or `.flow/skills/` (project wins); Flow also reads
  foreign skills read-only from `.claude/skills/`, `.gemini/skills/`
  (agy), `.grok/skills/` and their `~/.<tool>/skills/` user dirs —
  first name wins, Flow dirs first. Agents load skill bodies themselves
  with the `skill` tool whenever the system prompt lists a relevant one —
  no approval needed; `/skills [name]`;
  names enter agent prompts, bodies load on demand.
- Custom commands: `.flow/commands/*.md` (`$ARGUMENTS`, `$1…`) run as
  tasks in the current mode; `/reload` rescans extensions.
- Hooks (`settings.json` → `hooks: { PreToolUse: [...] }`): JSON on
  stdin, exit 2 or `{"decision":"block"}` blocks. Events: PreToolUse,
  PostToolUse, UserPromptSubmit, SessionStart, SessionEnd, PreCompact,
  Notification, Stop, AgentStop, AgentMessage, AgentHandoff.
- Trust: project hooks (`.flow/settings.json`) and project MCP servers
  (`.flow/mcp.json`) execute local code, so a new project asks once
  whether to trust them (remembered in `~/.flow/settings.json`); saying
  no — or running headless — falls back to user-level hooks/MCP only.
- Review: `/review` diffs via the active model. MCP: `~/.flow/mcp.json`
  - `.flow/mcp.json` (stdio + HTTP/SSE), tools as `mcp__server__tool`,
    callable from agents via fences; agents discover them with the `mcp`
    fence (no guessing names).
- Web: agents fetch pages as text with the `webfetch` tool (HTML
  stripped, capped); rules like `WebFetch(domain:github.com)` gate it.
  Subagents inherit MCP, skills, and web access from their parent.
- Decisions: choice/score/yes-no judgments without an LLM call — the
  `decide` tool (local heuristic engine, instant and offline), `/triage`
  for one-pass routing, and automatic guard screening that flags risky
  prompts without blocking. Point `APP_LAYA_URL` at a Laya-compatible
  decision server for model-grade answers.
- Reliability: native API drivers retry 429s (honoring `retry-after`),
  5xx, and network blips — 3 attempts with backoff, announced on stderr
  as `[retry 1/3 in 2.0s: …]`; only pre-token failures retry, so output
  never duplicates. Turns report their duration (TUI status bar, REPL
  `[took 12s]`); the TUI spinner shows live elapsed while working.
- Permissions: approve-by-default — only destructive acts ask
  (`rm -rf`, recursive deletes, `git clean -fdx`, `git reset --hard`,
  …). Rules like `Bash(git commit:*)`, `deny Click(*)`; last match
  wins; `/permissions [allow|deny|ask Rule]`. Agents ask once via the
  `question` tool when interactive, and are denied headless.
  `-y/--dangerously-skip-permissions` (YOLO) auto-approves everything
  including destruction, with a banner; hooks can still block.
- Computer use: agents can `screenshot` (PNG lands in
  `.flow/screenshots/` and is attached to the next model call),
  `click {x,y}`, `type {text}`, `key {name}`. Native drivers
  (Anthropic/OpenAI/OpenRouter/Ollama/Google) receive the images;
  CLI drivers get a note that they cannot see them; context counts
  ~1500 tokens per image.
- Flow-testing: when agents build an app or site, they test the real
  flow — start it detached, open it with the `browse` tool, `screenshot`
  to see it, then `click`/`type` through everything that matters and
  iterate. Planners and graders get observe-only tools (read/glob/grep,
  webfetch, `mcp` discovery, `browse`, `screenshot`) so verification
  checks the running thing, not just the summary.
- Routing (`flow.json`): `anthropic/*→claude`, `openai/gpt-*→codex`,
  `google/gemini-*→agy --yolo`, `*→opencode`. Single-model sessions
  offer interactive passthrough (`--passthrough` forces it); headless
  always wraps CLIs as drivers (spawn/kill/timeout, JSON parse,
  version detection). No keys and no CLI → mock driver, never a crash.

## Files

`~/.flow/`: `settings.json`, `mcp.json`, `skills/`, `agents/`,
`commands/`, `usage.json`, `last.json`, `projects/<hash>/*.jsonl`,
`checkpoints/`. Project `.flow/`: `settings.json`,
`settings.local.json` (machine-local allows), `FLOW.md`,
`mcp.json`, `skills/`, `agents/`, `commands/`. Secrets stay in env
(`APP_*_API_KEY`); logs never print them. Telemetry: none exists.
