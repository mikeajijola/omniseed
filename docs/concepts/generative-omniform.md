# Generative Omniform contracts

```text
Omniform operation catalogue
        ↓ compile with handlers
ExecutableCapabilityRegistry
        ↓
UI · Lily · CLI · API · machine controller
        ↓ executeOperation
policy · authorization · provider
        ↓
evidence · observed state · reconciliation
```

Define once in Omniform. Execute through OmniSeed. Experience through any interface.

The committed `generated/omniform-core.operations.json` is a materialization of the canonical Omniform catalogue, not an independently maintained definition. `npm run contracts:check` detects drift. `npm run contracts:generate` produces agent tools, CLI metadata, OpenAPI-compatible operation paths, and runtime reference pages.

Runtime discovery uses `getCapabilityRegistry`, `listOperations`, and `describeOperation`. Canonical execution uses `executeOperation` or `POST /operations/{omniform_operation_id}`. Existing ergonomic methods and CLI aliases delegate to the same handlers while migration continues.
