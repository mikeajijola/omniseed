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

Provider adapters are explicitly registered and advertise primitive families and capability offerings. Provider identity is the supplying organisation boundary; its products, services, frameworks, SDKs, and features are implementation choices beneath that Provider. Desired, installed, configured, connected and healthy are distinct. The resolver moves from requirements and current coverage to candidate realisations; exact resources in Omniform are optional constraints. A resource-level Provider binding wins over its family default, so one realisation can compositionally select different supplying organisations within the same primitive family. Planning, inspection, gaps, apply, and evidence retain that exact primitive-instance binding. See the authoritative [Provider semantics](https://github.com/mikeajijola/omniseed-ecosystem/blob/main/docs/provider-semantics.md).

A concrete plan binds every action to the provider selected for its family. Plans are persisted and content-hashed. Actor-scoped approval names the exact plan hash and selected action IDs. Definition and state-version checks prevent approval reuse against a different reality.

Semantic systems may propose Omniform or a realisation, but only this deterministic path mutates resources. Desired declarations, deployed resources, observations, evidence and history are stored as distinct records.

Reconciliation is itself an ordinary company Capability when a company declares it. Its realisation may compose workflow, connector, policy, memory, observation, and identity primitives. The Engine does not mark that Capability realised merely because it is the component interpreting Omniform: the declared primitive instances still require Provider-backed deployment and observation. `generate_plan`, `apply_plan`, and `observe_company` remain the ordinary governed operation surface; a bootstrap runner or scheduled workflow receives no private lifecycle or implicit approval path.

Company Change Proposals are persisted separately from Provider execution plans. Their approval binds an exact proposal hash and their base definition hash rejects stale changes. For a Git-backed company, apply submits the exact candidate to the configured company-repository boundary as a branch and pull request. It does not replace desired state in the runtime store; only a subsequently loaded merged branch is authoritative. The pre-Git alpha behavior remains only for declarations without `spec.governance` as a migration shim. See [`company-change.md`](company-change.md).

Inspection exposes canonical instance binding separately from company identity: Git authority and merged desired revision, Omniform version, environment, deployment identity, and observed-state revision. It also projects named realisations with primitive participants, family Provider bindings, deployment, observation, and evidence. The endpoint or OS process never defines company identity.

Declared operations compile into an executable registry containing implementation, permission, mutation, approval, provider dependency and availability truth. Declaration alone never makes an operation executable.

Company Search is the ordinary `company_search` Company Capability exposed through the governed `search_company` operation, not a primitive family. The operation resolves the participating Providers from its Capability strategy and declared `providerDependencies`; it never globally selects `memory`, `skills`, or another family. A memory-backed strategy, federated connector strategy, agent-led strategy, or hybrid can therefore retain the same Capability and operation IDs. One participating Provider must explicitly advertise `search_company` as the operation executor; all declared participants remain visible as the capability realisation context. This is deliberately smaller than a generic orchestration engine.

Calls carry the canonical company ID as their namespace and return Provider-neutral, sourced results. Lily, UI, API, CLI, agents and machines use the same operation; none talk directly to a vendor. Search results never become canonical truth and the read-only operation cannot mutate runtime or company-definition state. Any resulting design change still enters governed Company Change.

Historical deployed resources and evidence may retain the family recorded when they were created, including removed alpha vocabulary. OmniSeed keeps those records auditable. New desired declarations and new Provider advertisements use only the canonical Omniform families; no runtime code silently remaps `systems` or `company_search`.

## State and execution details

Runtime state defaults to `.omniseed/state.json`. `JsonStateStore` uses optimistic versions and atomic replacement. `MemoryStateStore` is available for tests. The store contract is replaceable.

The CLI supports validate, inspect, plan and reconcile. Apply is intentionally not a casual CLI command. It requires the exact persisted plan, approval bound to that plan hash and selected action IDs, and suitable actor permissions. Apply never regenerates a plan. Definition or state drift produces `plan_stale`.

`LocalProvider` accepts only explicit local or mock IDs. `LocalCompanySearchProvider` is deterministic, isolated by company ID, and intended only for local development and tests. It defaults to the `skills` responsibility because it executes retrieval/ranking; tests may explicitly configure it as `memory` when it is the retained knowledge implementation. It is never an automatic fallback. A vendor adapter must advertise the primitive responsibility it actually manifests, not the location where data happens to reside.

Company Search results use a Provider-neutral shape. Results retain provenance, source, Capability and evidence references, optional relevance, timestamps, and metadata. Search does not own definitions, Provider identity, plans, approvals, permissions, state versions, applies, or evidence metadata.

Distribution consumes the versioned `@omniseed/omniform` package. OmniSeed OS consumes the versioned `@omniseed/engine` package. Sibling links are a development convenience only.

## Provider execution boundary

`ProviderRegistry` normalizes every implementation to one Provider handle. Existing JavaScript objects use `InProcessProviderHandle`. External implementations use `ProtocolProviderHandle` and a separate transport. The compiler, resolver, planner, engine lifecycle, store, and reconciliation do not branch on Provider language or transport.

Provider Protocol v1 is identified by `omniseed.provider.protocol/1.0`. Its first transport is newline-delimited JSON-RPC 2.0 over stdin/stdout. See [`provider-protocol-v1.md`](provider-protocol-v1.md) for the wire contract and authority boundary.
