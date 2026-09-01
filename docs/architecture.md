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

Runtime assembly consumes those Omniform selections without changing them. `ProviderImplementationCatalog` contains explicit installed implementation claims using the ecosystem `provider-package.schema.json` v1 vocabulary. It resolves one exact Provider ID claim that covers every selected primitive family and the running Engine version. Zero compatible claims and multiple compatible claims both fail closed; another Provider is never substituted. A manifest is static discovery evidence, not proof of installation, configuration, connection, health, or capability.

`assembleRuntime` loads each resolved claim through its generic loader, validates the loaded handle against the manifest, and advances configuration, connection, health, then registration. Each transition emits structured diagnostic evidence with implementation identity/version, claimed families, outcome, and an honest failure reason. Only healthy compatible handles enter `ProviderRegistry`. The returned `assemblyDiagnostics` is the machine projection; `renderProviderAssemblyDiagnostics` renders the same records for people. Server-side Provider configuration is supplied separately by Provider ID and is never read from or written into Omniform.

The `inference` family represents provisioned computational inference independently of the actor and integration framework using it. OmniSeed plans and observes the declared inference Resource through its selected supplying organisation just like every other primitive. An Agent may use that Resource, but model availability does not prove Agent health, and Agent health does not prove the selected model binding. Product names, model IDs, serving modes, SDKs, and frameworks stay in Provider-specific Resource configuration; they never become Provider identities.

A concrete plan binds every create or update action to the Provider selected for its primitive instance. An existing resource is not assumed current merely because its family and ID exist: a changed desired resource or Provider binding produces an update action, and successful apply replaces that resource's current deployed and observed records while retaining evidence history. Plans are persisted and content-hashed. Approval names the exact plan hash and selected action IDs and is itself durably persisted before apply. The approver and applier may be distinct authorised actors; neither permission implies the other. Definition and state-version checks prevent approval reuse against a different reality.

Semantic systems may propose Omniform or a realisation, but only this deterministic path mutates resources. Desired declarations, deployed resources, observations, evidence and history are stored as distinct records.

Reconciliation is itself an ordinary company Capability when a company declares it. Its realisation may compose workflow, connector, policy, memory, observation, and identity primitives. The Engine does not mark that Capability realised merely because it is the component interpreting Omniform: the declared primitive instances still require Provider-backed deployment and observation. `generate_plan`, `apply_plan`, and `observe_company` remain the ordinary governed operation surface; a bootstrap runner or scheduled workflow receives no private lifecycle or implicit approval path.

Company Change Proposals are persisted separately from Provider execution plans. Their approval binds an exact proposal hash and their base definition hash rejects stale changes. For a Git-backed company, apply submits the exact candidate to the configured company-repository boundary as a branch and pull request. It does not replace desired state in the runtime store; only a subsequently loaded merged branch is authoritative. The pre-Git alpha behavior remains only for declarations without `spec.governance` as a migration shim. See [`company-change.md`](company-change.md).

Inspection exposes canonical instance binding separately from company identity: Git authority and merged desired revision, Omniform version, environment, deployment identity, and observed-state revision. It also projects named realisations with primitive participants, family Provider bindings, deployment, observation, and evidence. The endpoint or OS process never defines company identity.

Engine also owns the redacted current snapshot consumed by UI and OS caches. Snapshot revisions identify the complete safe projection; missing observations are explicit and never fabricated. Consumer synchronization is create, update, no-op, or stale as documented in [`company-snapshots.md`](company-snapshots.md).

The runtime records a merged desired revision through the ordinary declared `bind_company` operation. The operation is permissioned, accepts only binding fields owned by the Engine, and is idempotent for an unchanged binding. A deployment or workflow therefore cannot smuggle authority into runtime state, and repeated reconciliation of the same approved revision does not create Activity churn.

Declared operations compile into an executable registry containing implementation, permission, mutation, approval, provider dependency and availability truth. Declaration alone never makes an operation executable.

Company Search is the ordinary `company_search` Company Capability exposed through the governed `search_company` operation, not a primitive family. The operation resolves the participating Providers from its Capability strategy and declared `providerDependencies`; it never globally selects `memory`, `skills`, or another family. A memory-backed strategy, federated connector strategy, agent-led strategy, or hybrid can therefore retain the same Capability and operation IDs. One participating Provider must explicitly advertise `search_company` as the operation executor; all declared participants remain visible as the capability realisation context. This is deliberately smaller than a generic orchestration engine.

Calls carry the canonical company ID as their namespace and return Provider-neutral, sourced results. Lily, UI, API, CLI, agents and machines use the same operation; none talk directly to a vendor. Search results never become canonical truth and the read-only operation cannot mutate runtime or company-definition state. Any resulting design change still enters governed Company Change.

Historical deployed resources and evidence may retain the family recorded when they were created, including removed alpha vocabulary. OmniSeed keeps those records auditable. New desired declarations and new Provider advertisements use only the canonical Omniform families; no runtime code silently remaps `systems` or `company_search`.

## Autonomous stewardship policy

The Engine compiles `spec.stewardship.autonomy` into an inspectable effective profile and persists its operator-controlled enabled, paused, disabled, or expired state separately from desired state. Autonomous modes are invalid unless validation, independent review, unchanged head, and successful checks are all enabled. Server-bound `stewardship.control`, `stewardship.review`, and `stewardship.propose` permissions protect control, independent exact-head approval, and evaluation. Evaluation accepts only stable proposal and observation identifiers: the Engine resolves and verifies the durable Company Change digest and current-definition binding, derives categories and action counts from its persisted patch, and accepts checks only from a recent Provider-authenticated or Engine-persisted observation bound to that digest and repository submission head. Independent review binds that same digest, observation, and exact head. An allowed evaluation creates a bounded one-hour concurrency lease and atomically retains daily-change, action, and repair-round accounting. The governed completion, failure, or cancellation operation accepts only typed stable identifiers resolving to persisted Engine evidence bound to the same company, proposal digest, and exact head, or to an equivalently bound verified Provider observation; missing, malformed, stale, fabricated, or mismatched evidence leaves the lease active. Valid completion releases that lease exactly once; retries return the durable terminal result, and pause or disable never clears usage or audit evidence. Expired active leases remain counted until that explicit authorised recovery operation, so expiry fails closed. Daily counters reset on the UTC day boundary without discarding active leases.

This policy is enforced again where authority takes effect. A Git-backed `apply_company_change` may create the reviewable branch and pull request because the submission head must exist before exact-head checks can run, but it does not change canonical desired state. `merge_company_change` requires an enabled profile and an active, unexpired, allowed evaluation bound to the persisted proposal digest, observation, and exact submission head before invoking the Provider merge. The pre-Git migration apply changes canonical desired state directly and therefore fails closed whenever autonomous stewardship is declared: it cannot supply the repository-head evidence the policy requires. Ordinary apply or merge permissions do not bypass these checks. Provider executors receive the verified allowed decision but do not decide company policy.

## Durable company work

An Agent conversation and company work are not the same thing. A semantic runtime such as Eve owns its durable model session, tool loop, continuation token, and raw event stream. OmniSeed owns the company-scoped operational projection: intent, actor, lifecycle state, ordinary operations invoked, governance pauses, proposal/plan references, Provider actions, observations, evidence, and outcome.

`CompanyWorkRun` is runtime state, never desired state. It is persisted through the same optimistic store as Activity and observations, while Git remains the sole approved desired-state authority. Its public projection deliberately omits the Eve continuation token and hidden reasoning.

The ordinary work operations are `start_company_work`, `list_company_work`, `get_company_work`, `continue_company_work`, and `cancel_company_work`. Runtime event recording requires `company_work.record` but is not exposed as a model tool. A declared steward can therefore operate through the existing plan and Company Change lifecycle without receiving an approval operation or a private Provider path.

Read-only work may coexist. As soon as a run requests a mutating operation, OmniSeed marks it mutating and permits only one non-terminal mutating run for that company. Event IDs and request idempotency keys make stream replay safe; store CAS protects concurrent writers.

Approval is company policy, not Agent-runtime HITL state. A work run may park at `waiting_for_company_approval` or `waiting_for_checks`; an independently recorded exact approval can wake the same semantic session. Apply and Provider-mediated merge still recheck the persisted plan/proposal, authority, revision, approvals, and checks.

## State and execution details

Runtime state defaults to `.omniseed/state.json`. `JsonStateStore` uses optimistic versions and atomic replacement. `MemoryStateStore` is available for tests. The store contract is replaceable.

The CLI supports validate, inspect, plan and reconcile. Apply is intentionally not a casual CLI command. It requires the exact persisted plan, approval bound to that plan hash and selected action IDs, and suitable actor permissions. Apply never regenerates a plan. Definition or state drift produces `plan_stale`.

`LocalProvider` accepts only explicit local or mock IDs. `LocalCompanySearchProvider` is deterministic, isolated by company ID, and intended only for local development and tests. It defaults to the `skills` responsibility because it executes retrieval/ranking; tests may explicitly configure it as `memory` when it is the retained knowledge implementation. It is never an automatic fallback. A vendor adapter must advertise the primitive responsibility it actually manifests, not the location where data happens to reside.

Company Search results use a Provider-neutral shape. Results retain provenance, source, Capability and evidence references, optional relevance, timestamps, and metadata. Search does not own definitions, Provider identity, plans, approvals, permissions, state versions, applies, or evidence metadata.

Distribution consumes the versioned `@omniseed/omniform` package. OmniSeed OS consumes the versioned `@omniseed/engine` package. Sibling links are a development convenience only.

## Provider execution boundary

`ProviderRegistry` normalizes every implementation to one Provider handle. Existing JavaScript objects use `InProcessProviderHandle`. External implementations use `ProtocolProviderHandle` and a separate transport. The compiler, resolver, planner, engine lifecycle, store, and reconciliation do not branch on Provider language or transport.

Discovery loaders own implementation/package/process loading and return that same normalized handle boundary. They may create an in-process implementation or connect a protocol-backed process; runtime assembly and Engine lifecycle do not branch on language, transport, package name, product, or vendor.

Provider Protocol v1 is identified by `omniseed.provider.protocol/1.0`. Its first transport is newline-delimited JSON-RPC 2.0 over stdin/stdout. See [`provider-protocol-v1.md`](provider-protocol-v1.md) for the wire contract and authority boundary.
