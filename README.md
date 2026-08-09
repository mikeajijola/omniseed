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
