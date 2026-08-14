# Engine architecture

The control loop is `load → compile → diff → plan → approve → apply → observe → persist → compile`.

## Repository map

- `compiler.js` combines Omniform and saved state into the current company registry.
- `resolver.js` finds candidate ways to cover unmet requirements.
- `provider.js` owns Provider registration, status, and adapter contracts.
- `planner.js` creates actions and stable company and plan hashes.
- `operations.js` owns handlers, permissions, approvals, dependencies, and authorization.
- `store.js` keeps deployed resources, observations, evidence, history, and plans separate.
- `company-change.js` owns deterministic definition patches, proposal hashing, candidate validation, evidence references, and preview impact.
- `engine.js` joins these parts and controls access to Provider side effects.

Provider adapters are explicitly registered and advertise primitive families and capability offerings. Desired, installed, configured, connected and healthy are distinct. The resolver moves from requirements and current coverage to candidate realisations; exact resources in Omniform are optional constraints.

A concrete plan binds every action to the provider selected for its family. Plans are persisted and content-hashed. Actor-scoped approval names the exact plan hash and selected action IDs. Definition and state-version checks prevent approval reuse against a different reality.

Semantic systems may propose Omniform or a realisation, but only this deterministic path mutates resources. Desired declarations, deployed resources, observations, evidence and history are stored as distinct records.

Company Change Proposals are persisted separately from Provider execution plans. Their approval binds an exact proposal hash and their base definition hash rejects stale changes. Applied candidates become the store-backed canonical definition, are recompiled, and expose ordinary realisation gaps. They never create resources or call Providers. See [`company-change.md`](company-change.md).

Declared operations compile into an executable registry containing implementation, permission, mutation, approval, provider dependency and availability truth. Declaration alone never makes an operation executable.

`company_search` is an ordinary provider family. Calls carry the canonical company ID as their namespace and return provider-neutral, sourced results. Lily, UI, API, CLI, agents and machines use the same operation; none talk directly to a vendor. Search indexes canonical truth for retrieval but never becomes that truth.

## State and execution details

Runtime state defaults to `.omniseed/state.json`. `JsonStateStore` uses optimistic versions and atomic replacement. `MemoryStateStore` is available for tests. The store contract is replaceable.

The CLI supports validate, inspect, plan and reconcile. Apply is intentionally not a casual CLI command. It requires the exact persisted plan, approval bound to that plan hash and selected action IDs, and suitable actor permissions. Apply never regenerates a plan. Definition or state drift produces `plan_stale`.

`LocalProvider` accepts only explicit local or mock IDs. `LocalCompanySearchProvider` is deterministic, isolated by company ID, and intended only for local development and tests. It is never an automatic fallback. A vendor such as turbopuffer would be an adapter, not an engine dependency.

Company Search results use a Provider-neutral shape. Results retain provenance, source, Capability and evidence references, optional relevance, timestamps, and metadata. Search does not own definitions, Provider identity, plans, approvals, permissions, state versions, applies, or evidence metadata.

Distribution consumes the versioned `@omniseed/omniform` package. OmniSeed OS consumes the versioned `@omniseed/engine` package. Sibling links are a development convenience only.

## Provider execution boundary

`ProviderRegistry` normalizes every implementation to one Provider handle. Existing JavaScript objects use `InProcessProviderHandle`. External implementations use `ProtocolProviderHandle` and a separate transport. The compiler, resolver, planner, engine lifecycle, store, and reconciliation do not branch on Provider language or transport.

Provider Protocol v1 is identified by `omniseed.provider.protocol/1.0`. Its first transport is newline-delimited JSON-RPC 2.0 over stdin/stdout. See [`provider-protocol-v1.md`](provider-protocol-v1.md) for the wire contract and authority boundary.
