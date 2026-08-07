# Agent instructions

OmniSeed owns headless execution of Omniform. Read the README, relevant ADRs, and provider contract first.

- Consume Omniform; do not invent hidden portable semantics.
- Keep configuration, deployment state, observed state, and evidence separate. Missing capabilities are valid.
- Plan is not authorization; apply only approved changes and represent partial outcomes.
- Keep provider/vendor logic outside core. Never store secrets in portable state.
- Deterministic logic handles validation, hashes, graphs, diffs, permissions, approvals, and bookkeeping; AI cannot bypass it.
- No frontend business logic or OmniSeed OS dependency.
- Major capabilities need structured machine surfaces usable by humans, software/AI, and future embodied machines.
- Portable operation semantics come from the materialized Omniform catalogue. Do not add an executable handler without an Omniform operation or duplicate its schemas, permissions, mutation, approval, risk, or interface metadata downstream.
- Keep the runtime operations boundary stable; clients use transports rather than importing internal core modules.
- Keep founding proposals non-canonical until authorized commit; never persist proposal workflow fields into Omniform.
- Keep definition, portable state, evidence, and runtime metadata in separate stores and snapshots free of secrets.
- Do not introduce a resource abstraction that competes with Capability. Agents, skills, connectors, workflows, schedules, providers, people, partners, and machines realise capabilities through explicit offerings.
- Resolve natural language into structured capability intent. Coverage, policy, approved execution, persistence, schedules, audit, and evidence remain deterministic; Lily never calls provider SDKs.
- Make the smallest coherent change; update tests, docs, examples, and events. Run `npm run lint && npm test && npm run build` and report evidence.
