# TREE.md — annotated layout of the sys project

Excludes `node_modules/`, build output (`dist/`), and gitignored research/sidecars.
Committed `package-lock.json` omitted below as lockfile noise.

````
sysflow/
├── .env.example                                  # every APP_* var (keys have no defaults — never commit secrets)
├── .github/workflows/ci.yml                      # CI: npm ci → lint → test → build on win+ubuntu, Node 24
├── .gitignore                                    # node_modules, dist, .env, research/, foreign CLI sidecars
├── CLAUDE.md                                     # kit conventions + sys CLI addendum
├── DECISIONS.md                                  # working log of judgment calls (spec §15)
├── LICENSE                                       # MIT
├── README.md                                     # what/why, install, demo, command table, links
├── TREE.md                                       # this file
├── flow.json                                     # model registry, routing table (gemini→agy), quota thresholds
├── package.json                                  # sysflow package, sys binary, six standard scripts
├── docs/
│   ├── ARCHITECTURE.md                           # Path B decision + layer map
│   ├── FEATURE_MATRIX.md                         # 7 tools vs features + gap-fill list
│   ├── USAGE.md                                  # full user guide (commands, config, council, hooks, MCP)
│   └── adr/
│       ├── 001-record-architecture-decisions.md
│       ├── 002-choose-path-b-greenfield.md
│       ├── 003-cli-layer-adaptation.md           # readline over Ink, ports, api type-only rule
│       └── 004-npm-name.md                       # flow taken → flow-ai-cli + flow binary
├── src/
│   ├── index.ts                                  # thin bootstrap: argv → selector/REPL/headless/doctor
│   ├── app.ts                                    # composition root createApp(): wires drivers/tools/stores
│   ├── config.ts                                 # ONLY module reading process.env (APP_*)
│   ├── api/                                      # CLI edge (imports domain+lib; api-internal values)
│   │   ├── cli.ts                                # argv parsing + help (§10 surface)
│   │   ├── modelPicker.ts                        # interactive picker: highlight, filter, checkboxes
│   │   ├── selector.ts                           # model picker, mode picker, last-selection memory
│   │   ├── repl.ts                               # solo/council REPL, slash dispatch, compaction, checkpoints
│   │   ├── toolCommands.ts                       # /read/write/edit/bash/glob/grep + y/a/e/n approvals
│   │   ├── council.ts                            # CouncilSession: modes, badges, interjections, live view
│   │   ├── headless.ts                           # flow -p with text/json/stream-json + cost gate
│   │   ├── doctor.ts                             # prints app.diagnose() report
│   │   ├── costView.ts                           # /status + /cost rendering
│   │   ├── configView.ts                         # secret-masked config rendering
│   │   └── theming.ts                            # presets, truecolor/NO_COLOR detection, badges
│   ├── domain/                                   # pure logic (imports lib only)
│   │   ├── models.ts                             # ModelInfo, RoutingRule, ChatMessage, QuotaInfo, …
│   │   ├── drivers.ts                            # Driver port (native + CLI behind one interface)
│   │   ├── toolDefs.ts                           # ToolName, ToolsPort, arg substitution helpers
│   │   ├── modelRegistry.ts                      # list/find/group models
│   │   ├── discovery.ts                          # merge registry with discovered models
│   │   ├── routing.ts                            # first-match-wins glob routing (agy default)
│   │   ├── permissions.ts                        # modes + Tool(pattern) matcher, last-wins
│   │   ├── tokenizer.ts                          # chars/4 estimates, /context bars
│   │   ├── compaction.ts                         # 85% auto-compact + tool-output microcompaction
│   │   ├── blackboard.ts                         # shared council doc, scores, file locks
│   │   ├── orchestrator.ts                       # council/relay/workers/auto + pickMode heuristic
│   │   ├── sessions.ts                           # project hash, previews
│   │   ├── commands.ts                           # full slash registry + $ARGUMENTS substitution
│   │   ├── frontmatter.ts                        # YAML-lite frontmatter for skills/agents/commands
│   │   ├── skills.ts · memory.ts · hooks.ts      # SKILL.md, FLOW.md hierarchy, hook events/decisions
│   │   ├── subagents.ts · mcp.ts                 # agent defs, mcp__server__tool names + config parse
│   │   ├── quota.ts                              # pricing, budget levels, 429 backoff/failover
│   │   ├── checkpoints.ts                        # snapshot/restore plans
│   │   └── doctor.ts                             # check rows + rendering
│   ├── infrastructure/                           # adapters implementing domain ports
│   │   ├── nativeAnthropic.ts · nativeGoogle.ts  # Anthropic Messages + Gemini generateContent (SSE)
│   │   ├── openaiCompat.ts                       # OpenAI-compatible: openai/openrouter/ollama factories
│   │   ├── mockDriver.ts                         # offline echo driver (tests, keyless fallback)
│   │   ├── cliDrivers.ts                         # installed-CLI subprocess drivers + passthrough
│   │   ├── agentLoop.ts                          # provider-agnostic tool-call loop (```tool:* fences)
│   │   ├── driverAgent.ts                        # Driver → Orchestrant adapter (council member)
│   │   ├── discovery.ts                          # opencode/agy/grok/ollama/openrouter probers + cache
│   │   ├── localTools.ts                         # read/write/edit/bash/glob/grep/remove in workspace
│   │   ├── sessionStore.ts                       # JSONL sessions + fork/rename
│   │   ├── permissionStore.ts · userSettings.ts  # rules + defaultModel persistence
│   │   ├── skillStore.ts · subagentStore.ts      # SKILL.md / agents discovery (project overrides user)
│   │   ├── commandStore.ts · memoryStore.ts      # custom commands, FLOW.md, legacy import, $EDITOR
│   │   ├── hookRunner.ts                         # JSON-stdin hooks, exit-2/JSON block semantics
│   │   ├── mcpClients.ts                         # stdio + HTTP/SSE MCP, inventory, allowlists
│   │   ├── usageStore.ts · quota paths           # daily spend accumulation
│   │   ├── checkpointStore.ts                    # workspace snapshots outside git
│   │   ├── notifier.ts · keychain.ts             # best-effort toast+bell, credential-manager probe
│   └── lib/
│       ├── errors.ts                             # AppError + Auth/Quota/Driver/NotFound/Validation
│       └── logger.ts                             # zero-dep JSON logger, configured once in index
└── tests/
    ├── fixtures/
    │   ├── cliEcho.js                            # fake external CLI (jsonl/raw/fail/slow)
    │   └── mcpEcho.js                            # minimal stdio MCP server (echo tool)
    └── integration/
        ├── cli.test.ts                           # headless, cost gate, routing, tools via createApp
        ├── council.test.ts                       # 2-agent phases land in the session log
        └── e2e.test.ts                           # temp git repo → council task → file change
````
