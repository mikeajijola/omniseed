# Working in OmniSeed

OmniSeed is the deterministic runtime and control boundary between declarative company intent and provider side effects.

## Repository responsibilities

- `compiler.js` projects Omniform plus state into runtime capability, gap, provider, and operation truth.
- `resolver.js` selects candidate realisations from explicit requirements, resources, provider offerings, and current observations.
- `provider.js` owns explicit registration/status and provider-neutral adapter contracts.
- `planner.js` owns stable definition/plan hashing and deterministic action generation.
- `operations.js` owns executable handlers, permissions, approvals, dependencies, and invocation authorization.
- `store.js` owns versioned separation of deployed resources, observations, evidence, history, and plans.
- `engine.js` composes these pieces and is the only route to plan/approve/apply/reconcile behaviour.

Do not put UI rendering, Lily phrasing, HTTP routing, vendor-specific product policy, or Omniform schema ownership here. Provider-specific SDK code should be isolated in an adapter package/module behind the provider contract.

## Ecosystem contract

- Upstream [Omniform](https://github.com/mikeajijola/omniform) owns desired-state shape and validation. Consume only public `@omniseed/omniform` exports; do not reinterpret declarations locally.
- Downstream [OmniSeed OS](https://github.com/mikeajijola/omniseedos) consumes public `@omniseed/engine` exports and the compiled registry. Runtime truth must be complete enough that OS does not infer provider health, capability state, permissions, or approval requirements.
- Dependency direction is `omniform → omniseed → omniseedos`. Never import OS code into the engine.
- Published/versioned packages are the production boundary. Do not commit `file:../...` dependencies.

For an upstream Omniform contract change, update compiler/resolver fixtures, definition-hash expectations, and operation projections. For a public engine export or registry-shape change, version the package and update OmniSeed OS tests and distribution verification in the same release train.

## Safety and truth invariants

- Desired, installed, configured, connected, healthy, deployed, and observed are distinct states.
- Never fabricate a provider, fallback, healthy observation, successful apply, or executable operation.
- Planning is deterministic for the same declaration and state; persist the exact hashed plan.
- Approval binds actor, permissions, plan ID/hash, and selected action IDs.
- Apply uses the reviewed plan verbatim and rejects definition or state-version drift as `plan_stale`.
- Provider side effects occur only through authorized engine paths and are followed by observations/evidence persistence.
- Operation authorization must check actor identity and every required permission; mutating/approval semantics come from the compiled contract.
- Company Search is provider-neutral, company-isolated retrieval. Preserve provenance and never treat index contents as canonical state.
- Lily, UI, CLI, APIs, agents, and machines invoke registered OmniSeed operations rather than providers directly.

Run `npm test` for all changes. Add tests for failure truth as well as success: missing/unhealthy providers, insufficient permissions, stale plans, partial approvals, company isolation, and absent handlers should remain explicit structured outcomes.
