# flow

Flow — unified multi-model, multi-agent AI coding CLI (single `flow` entrypoint for solo and council modes).

## Quickstart

```bash
npm run setup        # install dependencies
cp .env.example .env # optional: adjust APP_PORT / APP_LOG_LEVEL
npm run dev          # start with reload on http://localhost:3000
curl localhost:3000/health
```

## Commands

| Verb     | Script                                                           |
| -------- | ---------------------------------------------------------------- |
| `setup`  | `npm install`                                                    |
| `dev`    | `tsx watch src/index.ts`                                         |
| `test`   | `vitest run`                                                     |
| `lint`   | `eslint . && tsc --noEmit`                                       |
| `format` | `prettier --write .`                                             |
| `build`  | `tsc -p tsconfig.build.json && tsc-alias -p tsconfig.build.json` |

Run the built server with `node dist/index.js`. Conventions live in [CLAUDE.md](CLAUDE.md);
decisions are recorded in [docs/adr/](docs/adr/).
