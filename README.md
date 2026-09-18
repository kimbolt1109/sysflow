# flow

Flow — unified multi-model, multi-agent AI coding CLI. One `flow` entrypoint:
pick one model for a Claude-Code-class REPL, or pick several and watch them
work as a council (draft → critique → synthesis → execution → review).

## Install

```bash
npm install -g flow-ai-cli   # ships the `flow` binary (package name differs: `flow` was taken)
flow doctor                   # green on a clean Windows machine
```

Requires Node 24+. Bring a provider key (`APP_ANTHROPIC_API_KEY`, …),
an Ollama endpoint, or an installed CLI (`claude`, `codex`, `agy`, `opencode`).

## Demo (scripted, offline-safe)

```bash
flow models                    # registry: context, $/1M, tags
flow doctor                    # node, auth, CLIs (claude/agy/opencode…), network, MCP, storage, keychain
flow -p "reply with exactly: ok" --output-format json
flow -p "say hi" --agents mock/a,mock/b --mode council
flow sessions                  # session browser with task previews
```

With keys or CLIs signed in, the same commands run real models; without
them Flow degrades to the mock driver instead of failing.

## Commands

| Verb     | Script                                                           |
| -------- | ---------------------------------------------------------------- |
| `setup`  | `npm install`                                                    |
| `dev`    | `tsx src/index.ts --help`                                        |
| `test`   | `vitest run`                                                     |
| `lint`   | `eslint . && tsc --noEmit`                                       |
| `format` | `prettier --write .`                                             |
| `build`  | `tsc -p tsconfig.build.json && tsc-alias -p tsconfig.build.json` |

Run the built CLI with `node dist/index.js` (`flow` after `npm link`).
Full guide: [docs/USAGE.md](docs/USAGE.md). Capabilities matrix:
[docs/FEATURE_MATRIX.md](docs/FEATURE_MATRIX.md). Architecture:
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Conventions: [CLAUDE.md](CLAUDE.md).
