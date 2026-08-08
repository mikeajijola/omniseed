# OmniSeed

OmniSeed is the headless Company-as-Code engine: compiler, deterministic planner, provider orchestrator and reconciler.

```sh
npm install
npm test
npx omniseed plan ../omniform/examples/omniseed/omniform.yaml
npx omniseed apply ../omniform/examples/omniseed/omniform.yaml --approve
npx omniseed inspect ../omniform/examples/omniseed/omniform.yaml
```

Runtime state defaults to `.omniseed/state.json`; it is deliberately separate from Omniform. Writes use optimistic versions and atomic replacement. The store is replaceable, and the local provider is a deterministic reference adapter—not a claim that an external platform was provisioned.

The generated capability registry is the sole executable projection consumed by Lily, OmniSeed OS, the CLI, APIs, and future machine interfaces.
