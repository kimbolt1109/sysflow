# flow

Flow — unified multi-model, multi-agent AI coding CLI (single `flow` entrypoint for solo and council modes).

## Quickstart

```bash
npm run setup        # install dependencies
cp .env.example .env # optional: add provider keys, budgets
npm run dev          # prints CLI help (one-shot CLI, no reload loop)
npm test && npm run lint && npm run build
node dist/index.js --help
node dist/index.js -p "hello"   # headless (mock driver without keys)
```

## Commands

| Verb     | Script                                                           |
| -------- | ---------------------------------------------------------------- |
| `setup`  | `npm install`                                                    |
| `dev`    | `tsx src/index.ts --help`                                        |
| `test`   | `vitest run`                                                     |
| `lint`   | `eslint . && tsc --noEmit`                                       |
| `format` | `prettier --write .`                                             |
| `build`  | `tsc -p tsconfig.build.json && tsc-alias -p tsconfig.build.json` |

Run the built CLI with `node dist/index.js` (binary `flow` via `package.json:bin`). Conventions live in [CLAUDE.md](CLAUDE.md);
decisions are recorded in [docs/adr/](docs/adr/).
