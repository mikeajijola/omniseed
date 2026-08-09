# OmniSeed

OmniSeed is the headless Company-as-Code engine: compiler, deterministic planner, provider orchestrator and reconciler.

```sh
npm install
npm test
npx omniseed plan ../omniform/examples/omniseed/omniform.yaml
npx omniseed inspect ../omniform/examples/omniseed/omniform.yaml
```

Runtime state defaults to `.omniseed/state.json`; it is deliberately separate from Omniform. Writes use optimistic versions and atomic replacement. The store is replaceable.

Declaring a provider never installs one. Implementations must be explicitly registered, configured, connected and healthy. Missing implementations produce structured provider and capability gaps. `LocalProvider` accepts only explicit `local*`/`mock*` IDs.

Plan generation persists an exact hashed plan. Approval binds an actor, permissions and selected action IDs to that hash. Apply accepts that same plan and approval; it never regenerates a plan and rejects definition or state drift as `plan_stale`.

The generated capability registry is the sole executable projection consumed by Lily, OmniSeed OS, the CLI, APIs, and future machine interfaces.

Run `node examples/customer-support.mjs` for the Generation 1 acceptance scenario with all reference providers and with the Connector Provider deliberately absent.

Distribution consumes the versioned `@omniseed/omniform` package. A sibling checkout may be linked for development, but is not a production topology. Licensing remains unresolved and this package declares no license metadata.

OmniSeed accepts canonical Omniform objects loaded from either YAML or JSON; runtime logic is serialization-neutral. `company_search` routes governed indexing and retrieval through an explicitly registered provider. The included `LocalCompanySearchProvider` is deterministic, isolated by company ID, and intended only for local development/tests. turbopuffer is a possible future adapter—not an OmniSeed dependency.

Company Search results use a provider-neutral shape with provenance, source, capability/evidence references, optional relevance, timestamps and metadata. Search is never authoritative for definitions, provider IDs, plans, approvals, permissions, state versions, applies, or evidence metadata.

The first production adapter lives in `providers/vercel`. It discovers and adopts an existing project, deploys preview artifacts deterministically, and observes project/deployment reality independently. See [`docs/how-omniseed-runs-omniseed.md`](docs/how-omniseed-runs-omniseed.md). No Vercel secret is accepted in Omniform, plan data, state, evidence, logs, or browser code.
