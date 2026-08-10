# OmniSeed

OmniSeed is the headless execution engine for Company-as-Code. It takes a validated Omniform declaration, compares desired capabilities with registered providers and persisted runtime state, and produces deterministic runtime truth and controlled changes.

This repository owns:

- compilation of a declaration plus runtime state into a capability/operation registry;
- truthful provider registration, status, and capability resolution;
- deterministic diffing and content-hashed plans;
- actor- and action-scoped approval of an exact persisted plan;
- stale-plan protection and provider-mediated apply/reconcile;
- separation of desired, deployed, observed, evidence, history, and plan records;
- provider-neutral operation invocation, including Company Search.

It is headless: it does not own a browser UI, Lily conversation UX, or an HTTP control plane.

## Place in the ecosystem

```text
@omniseed/omniform             @omniseed/engine                 @omniseed/os
desired company contract  →  runtime control and truth  →  per-company experience
```

- [Omniform](https://github.com/mikeajijola/omniform) owns the schema, parser, and semantics for desired company declarations. OmniSeed consumes its versioned `@omniseed/omniform` package and must not invent fields or mutate the declaration into runtime state.
- [OmniSeed OS](https://github.com/mikeajijola/omniseedos) consumes the versioned `@omniseed/engine` package. It projects `engine.inspect()` results and delegates plan, approval, apply, and operation calls back to the engine; it must not reproduce engine policy in UI/server code.

The runtime control loop is:

```text
load → compile → diff → plan → approve → apply → observe → persist → compile
```

Semantic agents may propose intent or a realisation, but only this deterministic path may mutate managed resources.

## Quick start

Requires Node.js 22 or newer. With this repository and `omniform` checked out as siblings:

```sh
npm install
npm test
npx omniseed validate ../omniform/examples/company.omniform.yaml
npx omniseed inspect ../omniform/examples/company.omniform.yaml
npx omniseed plan ../omniform/examples/company.omniform.yaml
```

The CLI intentionally does not expose a casual apply command: apply requires the exact stored plan, an approval bound to its hash and selected action IDs, and suitable actor permissions. Use the SDK or a trusted runtime API for that flow.

Runtime state defaults to `.omniseed/state.json`. `JsonStateStore` uses optimistic versions and atomic replacement; `MemoryStateStore` is available for tests. The store is replaceable.

## Provider truth

An Omniform provider selection is desired state. A provider becomes usable only when an implementation is explicitly registered for the family and reports configured, connected, and healthy. Missing implementations remain structured provider/capability gaps; OmniSeed never fabricates or silently substitutes them. `LocalProvider` and `LocalCompanySearchProvider` require explicit local/mock IDs and are intended for development and tests.

Plans bind each action to the selected provider, declaration hash, and state version. Approval binds an actor, permissions, and selected actions to the exact plan hash. Apply never regenerates a plan and rejects declaration or state drift as `plan_stale`.

Declared operations compile into the executable registry consumed by OmniSeed OS, Lily, CLI, API, agent, voice, and future machine interfaces. Availability reflects both a registered implementation and provider dependencies; declaration alone is insufficient.

Company Search requests are company-scoped and return provider-neutral results with provenance, source references, capability/evidence references, timestamps, metadata, and optional relevance. Search never owns definitions, provider identity, state, plans, approvals, permissions, applies, or evidence metadata. A future turbopuffer adapter would be a provider implementation, not an engine dependency.

See [`docs/architecture.md`](docs/architecture.md) and [`examples/customer-support.mjs`](examples/customer-support.mjs). Distribution consumes versioned packages; sibling links are local-development conveniences, not production topology. Licensing remains unresolved and this package declares no license metadata.
