# OmniSeed

**Define once in Omniform. Execute through OmniSeed. Experience through any interface.**

**OmniSeed is the open headless reference engine for Omniform.** It validates definitions, calculates capability state, plans, applies approved changes, observes evidence, detects drift, and emits structured events.

> **Licensing blocker:** this public repository has no explicit license yet. The source is publicly readable but not licensed for reuse as open source pending a maintainer decision.

`Founder intent → reviewed draft → Omniform (meaning) → OmniSeed (persistent execution) → OmniSeed OS (interaction)`

It is for runtime contributors, provider authors, automation builders, and architects who need deterministic Company-as-Code execution without a frontend or external account.

## Try it

Requires Node.js 20+; no cloud account, Docker, database, or AI key is needed.

```sh
npm test
npm run omniseed -- validate examples/minimal --json
npm run omniseed -- plan examples/minimal --json
npm run runtime
```

The [getting-started guide](docs/getting-started/local-runtime.md) covers plan, apply, and restart. `npm run dev` exposes domain and founding operations over HTTP at port 8787. By default the company runtime lives in `.omniseed/omniseed.db`; set `OMNISEED_DATABASE_FILE` to change this. One runtime and one SQLite database hold many capabilities while desired state, deployed state, evidence, and metadata remain logically separate. Major commands produce structured output with `--json`.

## Ecosystem and contribution map

- [Omniform](https://github.com/mikeajijola/omniform): change portable semantics or reusable capability/monitor knowledge there.
- **OmniSeed**: change validation, graph, calculated state, planning/apply, provider contracts, events, or CLI here.
- [OmniSeed OS](https://github.com/mikeajijola/omniseedos): change operating experience, accessibility, or actor interfaces there.

External integrations implement [`@omniseed/provider-sdk`](packages/provider-sdk/src/index.mjs); vendor logic stays outside core. See [CONTRIBUTING](CONTRIBUTING.md), [docs](docs/index.md), and [architecture decisions](docs/architecture/decisions).
