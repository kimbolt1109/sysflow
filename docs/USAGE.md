# USAGE — Flow user guide

## Entry points

```
flow                          # model picker → REPL (solo or council)
flow --model openai/gpt-5     # skip the picker
flow --models a,b --mode council
flow -c / flow -r [id]        # continue latest / resume (picker with previews: flow sessions)
flow -p "task" [--agents a,b] [--mode council|relay|workers|auto]
  [--output-format text|json|stream-json] [--max-cost N] [--json] [--no-notify]
flow models | flow doctor | flow sessions
flow mcp [list|add stdio <name> -- <cmd>|add http|sse <name> <url>|remove <name>]
flow config [get [key]|set defaultModel <id>|edit]
flow update                   # via npm (flow-ai-cli)
```

Flags: `-y/--yolo/--dangerously-skip-permissions`, `--permission-mode
default|acceptEdits|plan|bypassPermissions`, `--permission-mode`, `--verbose`.

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

Modes: `council` (fan-out → critique → synthesis → execution → review →
retro; 2 rejections pause for you), `relay` (take turns), `workers`
(parallel subtasks with file locks), `auto` (size-based heuristic),
`solo`. Live view shows `[agent]` badges and phase lines
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
  `~/.flow/skills/` or `.flow/skills/` (project wins); `/skills [name]`;
  names enter agent prompts, bodies load on demand.
- Custom commands: `.flow/commands/*.md` (`$ARGUMENTS`, `$1…`) run as
  tasks in the current mode; `/reload` rescans extensions.
- Hooks (`settings.json` → `hooks: { PreToolUse: [...] }`): JSON on
  stdin, exit 2 or `{"decision":"block"}` blocks. Events: PreToolUse,
  PostToolUse, UserPromptSubmit, SessionStart, SessionEnd, PreCompact,
  Notification, Stop, AgentStop, AgentMessage, AgentHandoff.
- Review: `/review` diffs via the active model. MCP: `~/.flow/mcp.json`
  - `.flow/mcp.json` (stdio + HTTP/SSE), tools as `mcp__server__tool`,
    callable from agents via fences.
- Permissions: modes above; rules like `Bash(git commit:*)`,
  `Read(~/.zshrc)`, `Edit(docs/**)`, `WebFetch(domain:github.com)`;
  last match wins; `/permissions [allow|deny|ask Rule]`.
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
