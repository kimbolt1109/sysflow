# 004. Publish as flow-ai-cli with a flow binary

Date: 2026-09-18
Status: accepted

## Context

Spec §13: check whether the npm name `flow` is taken; if so publish as
`flow-ai-cli` with a `flow` binary. `npm view flow` returns 0.2.3 (taken);
`npm view flow-ai-cli` returns 404 (free).

## Decision

Package name `flow-ai-cli`, MIT license, `bin: { flow: dist/index.js }`,
`files: [dist]`, `engines: node >= 20`. Keep `private: true` until a human
with npm auth runs the first `npm publish` — flipping that flag plus
`npm publish` is the only remaining release step.

## Consequences

`npm install -g flow-ai-cli` yields the `flow` command with no rename
needed later. No code depends on the package name (only `package.json`).
