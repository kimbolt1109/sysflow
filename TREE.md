# TREE.md — annotated layout of the flow project (scaffolded from ts-api template)

Excludes `node_modules/` and build output (`dist/`). A committed `package-lock.json`
lockfile exists at the root but is omitted below as lockfile noise.

```
flow/
├── .env.example                                  # every env var the app reads (APP_PORT, APP_LOG_LEVEL), commented
├── .gitignore                                    # ignores node_modules/, dist/, coverage/, .env, *.tsbuildinfo
├── .prettierignore                               # keeps prettier from reflowing the exact-copy CLAUDE.md
├── .prettierrc.json                              # prettier config: printWidth 100, double quotes, trailing commas
├── CLAUDE.md                                     # exact copy of the kit conventions + flow template addendum
├── README.md                                     # what this template is, quickstart, six-command table
├── TREE.md                                       # this file: annotated directory tree of the template
├── eslint.config.js                              # flat ESLint config (CJS): @eslint/js + typescript-eslint + prettier
├── package.json                                  # metadata, deps, and the six standard npm scripts
├── tsconfig.json                                 # strict compiler options, CommonJS, @/ path alias, src+tests+config
├── tsconfig.build.json                           # build-only config: extends tsconfig, emits src/ to dist/, skips tests
├── vitest.config.ts                              # vitest: node environment, @/ alias, colocated + integration globs
├── docs/
│   └── adr/
│       └── 001-record-architecture-decisions.md  # ADR stating decisions are recorded as ADRs in docs/adr/
├── src/
│   ├── api/
│   │   └── routes/
│   │       ├── health.ts                         # healthRouter(): GET /health liveness endpoint
│   │       └── items.ts                          # itemsRouter(service): GET /items, GET /items/:id, POST /items
│   ├── app.ts                                    # composition root factory createApp(config): wires repo, service, routers, error middleware
│   ├── config.ts                                 # loadConfig(): the only module that reads process.env
│   ├── domain/
│   │   ├── items.test.ts                         # colocated unit tests for ItemService with an inline fake repo
│   │   └── items.ts                              # Item/ItemCreate types, ItemsRepo port, ItemService domain logic
│   ├── index.ts                                  # thin bootstrap: loadConfig, createApp, listen, startup log
│   ├── infrastructure/
│   │   └── itemsRepo.ts                          # InMemoryItemsRepo: Map-backed adapter implementing ItemsRepo
│   └── lib/
│       ├── errors.ts                             # AppError root plus NotFoundError (404) and ValidationError (422)
│       └── logger.ts                             # Logger interface + createLogger: zero-dep leveled JSON console logger
└── tests/
    └── integration/
        └── app.test.ts                           # supertest suite booting createApp: health, CRUD, 404 and 422 paths
```
