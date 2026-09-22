# sys

Sys is a unified multi-model, multi-agent AI coding CLI. Run `sys` and land
in a full-screen session with **Dove** — calm, precise, and allergic to
unverified work. Pick one model, or pick several and watch them work as a
**council** (draft → critique → synthesis → execution → review).

```
   __
  /  \__
  \  (o >
   \__/__/
```

## Install

```bash
npm install -g sysflow   # ships the `sys` binary
sys doctor               # green on a clean machine
sys                      # full-screen session (the starting command)
```

Requires Node 20+. Bring a provider key (`APP_ANTHROPIC_API_KEY`,
`APP_OPENAI_API_KEY`, `APP_GOOGLE_API_KEY`, `APP_OPENROUTER_API_KEY`), an
Ollama endpoint, or an installed CLI (`claude`, `codex`, `agy`, `opencode`).
With none of those, sys degrades to a mock driver instead of crashing.

## TUI (`sys`)

Model picker (search, `recent` group, multi-select) → mode select → thinking
level → live session:

- **Conversation-first transcript** — role cards (you `❯`, assistant `◆`,
  errors `✖`, diffs), timestamps, wrapped-row viewport that follows live
  output, `PgUp`/`PgDn` scrollback with `▲ earlier` / `▼ scrolled` indicators.
- **Prompt input** — command history (`↑↓`), arrow-key `/` menu
  (`Tab`/browse-`Enter` to accept), multiline (`\`+`Enter`), readline kills
  (`Ctrl+A/E/U/K/W`), draft stash (`Ctrl+S`), collapsible sidebar (`Ctrl+B`).
- **Find and keep** — `/find text` searches with match highlight (repeat to
  cycle), `/dump [path]` saves the transcript as markdown, `Esc Esc` toggles
  the shortcuts overlay, live cost + context-% status bar.

## Council: every plan debated, every output graded

- **Modes** — `solo`, `council` (default for 2+ agents), `relay`, `workers`,
  `auto`. Plan → critique rounds → lead synthesis → execution.
- **Verification with teeth** — five lenses (correctness, edge-cases,
  requirements, security, simplicity) inspect the _actual code_ with tools
  and score 0–100; below 70% or any `FAILED` lens pauses for you. Reviewers
  then approve or reject (2 rejections pause). Plan mode stages the plan for
  `/approve` first.
- **Agents improve over time** — failed verifications, pause reasons, and
  per-agent retros persist to session logs and are recalled into future runs
  as lessons, on every surface (TUI, REPL, headless, subagents).

## Tools: everything, everywhere

Solo sessions run the same tool loop as council members — read/write/edit,
bash, glob/grep, skills, subagents, question, MCP, web, and computer use:

- **Web** — `webfetch {url}` reads pages as text; `browse {url}` opens the
  real browser. Building a site? Agents test the real flow: start it
  detached, browse it, screenshot it, click/type through everything.
- **Computer use** — `screenshot` (attached as vision), `click`, `type`,
  `key` (Windows native; graceful elsewhere).
- **MCP** — `sys mcp add/list/remove`; agents discover tools live with the
  `mcp` fence instead of guessing names (`mcp__server__tool`).
- **Decisions** — Jev-style choice/score/yes-no judgments via the `decide`
  tool and `/triage`, answered locally in milliseconds (or by a Laya
  server via `APP_LAYA_URL`); risky prompts get flagged, never silently
  blocked.
- **Skills & subagents** — project or personal `SKILL.md` and subagent defs;
  agents load skill bodies themselves; `/agents run <name> <prompt>` spawns
  task subagents with MCP/skills/web access.
- **Permissions** — approve-by-default; only destructive acts ask
  (`rm -rf`, `git reset --hard`, …). `Shift+Tab` cycles
  `default → acceptEdits → plan`; `-y` bypasses; custom `Tool(pattern)`
  rules; interactive `question`-tool approval, safe deny when headless.

## Memory, sessions, models

- **Memory** — `FLOW.md` project memory, legacy imports, `/init`, `/memory`.
- **Sessions** — JSONL logs per project with `/sessions /resume /fork /new
/rename /tasks`, checkpoints with `/undo /rewind`, `/compact`, `/export`.
- **Models & routing** — registry with context/pricing/tags, auto-discovery,
  `flow.json` routing (`anthropic/*→claude`, `openai/gpt-*→codex`, …),
  per-provider quotas in `/status`, daily budgets.
- **Headless/CI** — `sys -p "task"` (text/json/stream-json), `--agents`,
  `--mode`, `--max-cost`, exit codes for scripts. `sys repl` keeps the
  classic readline session.
- **Doctor & config** — `sys doctor` probes node/storage/auth/CLIs/network/
  MCP/keychain; `sys config get/set/edit`.

## Demo (scripted, offline-safe)

```bash
sys models                    # registry: context, $/1M, tags
sys doctor                    # full environment probe
sys -p "reply with exactly: ok" --output-format json
sys -p "say hi" --agents mock/a,mock/b --mode council
sys sessions                  # session browser with task previews
```

## Develop

| Verb     | Script                                                           |
| -------- | ---------------------------------------------------------------- |
| `setup`  | `npm install`                                                    |
| `dev`    | `tsx src/index.ts --help`                                        |
| `test`   | `vitest run`                                                     |
| `lint`   | `eslint . && tsc --noEmit`                                       |
| `format` | `prettier --write .`                                             |
| `build`  | `tsc -p tsconfig.build.json && tsc-alias -p tsconfig.build.json` |

Run the built CLI with `node dist/index.js` (`sys` after `npm link`).
Full guide: [docs/USAGE.md](docs/USAGE.md). Architecture:
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Decisions:
[docs/adr/](docs/adr/). Conventions: [CLAUDE.md](CLAUDE.md).
