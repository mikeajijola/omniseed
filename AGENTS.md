# Agent instructions

OmniSeed owns headless execution of Omniform. Read the README, relevant ADRs, and provider contract first.

- Consume Omniform; do not invent hidden portable semantics.
- Keep configuration, deployment state, observed state, and evidence separate. Missing capabilities are valid.
- Plan is not authorization; apply only approved changes and represent partial outcomes.
- Keep provider/vendor logic outside core. Never store secrets in portable state.
- Deterministic logic handles validation, hashes, graphs, diffs, permissions, approvals, and bookkeeping; AI cannot bypass it.
- No frontend business logic or OmniSeed OS dependency.
- Major capabilities need structured machine surfaces usable by humans, software/AI, and future embodied machines.
- Keep the runtime operations boundary stable; clients use transports rather than importing internal core modules.
- Make the smallest coherent change; update tests, docs, examples, and events. Run `npm run lint && npm test && npm run build` and report evidence.
