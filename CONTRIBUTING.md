# Contributing

Choose the owning layer before editing: Omniform owns portable meaning; this repository owns runtime execution and providers; OmniSeed OS owns interaction. Provider authors start with `packages/provider-sdk` and can test against `providers/mock`. Core contributors should preserve deterministic plans, explicit authorization, partial results, structured events, and state separation.

Run `npm run lint && npm test && npm run build`, then open a focused pull request with the capability/outcome, actor implications, tests, and evidence. Domain experts can improve examples and planning language without writing provider code. Follow the [Code of Conduct](CODE_OF_CONDUCT.md).
