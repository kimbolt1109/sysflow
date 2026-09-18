These conventions are authoritative. Follow them even where your defaults differ.
Rationale and worked examples: PROJECT_STRUCTURE.md — consult it for *why*, never for rules.

## Project layout

- Use a `src/` layout in every repo. Production code lives only in `src/`.
- Root always contains: README.md, CLAUDE.md, .gitignore, .env.example, docs/ (with docs/adr/),
  tests/, and the language metadata file (pyproject.toml or package.json).
- Organize servers by layer: `api/` · `domain/` · `infrastructure/` · `lib/`.
  Organize UIs by feature: `src/features/<name>/` holding component + hook + test together.
- Keep all Python tool config (ruff, pyright, pytest) inside pyproject.toml — no extra config files.
- Nest at most 3 directory levels below `src/` (React feature folders may reach 4).
- Split a file at ~400 lines or ~7 public symbols; split a folder at ~10 modules.
- `scripts/` may import `src/`; nothing imports `scripts/`.

## Import & dependency rules

- Allowed arrows only: entrypoint → anything; api → {domain, lib}; infrastructure → {domain, lib};
  domain → lib only; lib → nothing local.
- Never import upward or sideways: api never imports infrastructure; domain never imports
  api, infrastructure, or settings/config.
- Define ports (interfaces) in domain; implement them in infrastructure; wire concrete
  implementations only in the entrypoint (main.py / index.ts) — the composition root.
- Python: absolute imports always (`from pkg.domain.items import ItemService`).
  Relative allowed only inside an `__init__.py` re-export.
- TypeScript: alias `@/` → `src/` (tsconfig `paths` + vite/vitest `resolve.alias`).
  Relative imports only within the same folder; never `../`.
- Keep every app `__init__.py` empty; no barrel `index.ts` in apps. A shared/published package
  exposes exactly one barrel (its root `index.ts` / `__init__.py`) as its whole public API.
- On a circular import, extract shared types into a lower module (`domain/models`);
  never fix a cycle with a mid-function import.
- Never create `utils` / `helpers` / `constants` grab-bag modules. Name modules by content
  (`dates.py`, `slug.ts`); constants live in the module that owns the concept.

## Naming

- Python: `snake_case` files/functions, `PascalCase` classes, `UPPER_SNAKE` constants.
- TypeScript: `camelCase` files/functions (`itemsRepo.ts`), `PascalCase` types and React
  components (`Counter.tsx`), no `I` prefix on interfaces, `kebab-case` folders.
- Tests: Python `tests/unit/test_<module>.py`; TS colocated `<module>.test.ts`,
  integration in `tests/integration/`.
- Env vars: `APP_` prefix + `UPPER_SNAKE`. Branches: `feat/<slug>`, `fix/<slug>`,
  `chore/<slug>`, `docs/<slug>`.
- Functions are verbs; booleans are predicates (`is_ready`, `hasAccess`);
  React hooks are `use<Thing>` in `use<Thing>.ts`.

## Testing

- Python: all tests under `tests/` mirroring `src/`; unit in `tests/unit` (no I/O, fakes only),
  integration in `tests/integration`; shared fixtures in `tests/conftest.py`.
- TS: unit tests colocated next to source; integration tests in `tests/integration`
  boot the app factory (`create_app()` / `createApp()`), never hand-wired graphs.
- Ship every new public function with its test in the same commit.
- Name tests for behavior: `test_missing_item_raises_not_found`,
  `it("returns 404 for a missing item")`.

## Config

- Read env vars in exactly one module: `settings.py` (pydantic-settings, `env_prefix="APP_"`)
  or `src/config.ts` (`loadConfig()`). Nothing else touches `os.environ` / `process.env`.
- The entrypoint loads config once and passes values down. Domain code never reads config.
- Commit `.env.example` listing every var with a safe default and a comment; gitignore `.env`.
  Never give a secret a default in code — a missing secret fails at startup.
- Errors: one `AppError` root with per-category subclasses; raise deep, catch only at the
  boundary (API error handler / CLI `main`).
- Logging: configure once in the entrypoint; modules use `logging.getLogger(__name__)` /
  the shared `lib/logger`. No `print()` outside a CLI's actual output.
- Typing strict from day one: pyright `strict`; tsconfig `strict` + `noUncheckedIndexedAccess`;
  no `any` — use `unknown` and narrow.

## Commands

Define the same six verbs in every repo — Makefile (Python) or package.json scripts (TS):

- `setup` → `uv sync` / `npm install`
- `dev` → run with reload (`uvicorn --reload`, `tsx watch`, `vite`)
- `test` → `uv run pytest` / `vitest run`
- `lint` → `ruff check` + `pyright` / `eslint` + `tsc --noEmit` (lint always includes types)
- `format` → `ruff format .` / `prettier --write .`
- `build` → `uv build` / `tsc -p tsconfig.build.json` / `vite build`

Toolchain: Python = uv + ruff + pyright + pytest. TS = npm (pnpm for monorepos) +
prettier + eslint + tsc + vitest. Commit lockfiles.

## Steps when adding a new feature

1. Locate or create the domain module (`domain/<concept>`, or `features/<name>/` in a UI).
2. Write the domain logic pure: no I/O, no config, no framework imports; define a port
   in domain if it needs external data.
3. Write its unit test and make it pass.
4. Implement any new port in `infrastructure/`, returning domain types.
5. Expose it at the edge: route/command in `api/` (or component in `features/`),
   importing only domain + lib.
6. Wire the new pieces in the entrypoint — the only file that may import everything.
7. Add an integration test through the app factory; update `.env.example` for new env vars.
8. Run `format`, `lint`, `test` — all must pass before commit. Record hard-to-reverse
   decisions in `docs/adr/NNN-title.md`.

## Template addendum — flow (scaffolded from ts-api, adapting to CLI per §9)

- Entry point: `src/index.ts` (thin bootstrap); `src/app.ts` is the composition root factory `createApp(config)`.
- Build is plain `tsc` to CommonJS in `dist/`; `tsc-alias` rewrites `@/` aliases — no bundler.
- Run the compiled server with `node dist/index.js`; `npm run dev` uses `tsx watch`.
- `eslint.config.js` uses `require()` because this package is CommonJS (no `"type": "module"`).
- `InMemoryItemsRepo` is the default `ItemsRepo` port implementation; swap adapters in `src/app.ts` only.
- CLI adaptation (Path B): `src/api/` hosts CLI commands (commander-style argv parsing) over `domain/`; `src/app.ts` remains the only composition root. The Express items example is skeleton-only and will be deleted when the first real Flow feature (M1 config + REPL) lands. Binary name is `flow` via `package.json:bin` (`flow-ai-cli` package).
