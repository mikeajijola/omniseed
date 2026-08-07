# Capability realisation

OmniSeed deterministically compares a required company capability with active resource offerings. A resource merely attached to a capability does not make it realised.

```text
intent -> desired capability -> coverage -> gap -> candidate realisations
  -> plan -> policy and authorization -> provider apply -> observation
  -> evidence -> capability re-evaluation -> continue or finish
```

`CapabilityResolver` returns existing coverage, missing requirements, candidate provider offerings, a policy-ranked recommendation, and unresolved requirements. Semantic reasoning may propose decomposition or rank ambiguous candidates, but the handoff is structured. After approval, provider execution and state transitions are deterministic.

States include `missing`, `partial`, `realised`, `blocked`, `deferred`, `gap_accepted`, and `retryable`. Attempts are bounded and auditable. Accepting a gap is a governed decision, not a validation failure.

Human participation is represented as a precise requirement such as a qualified signatory or delegated refund authority. The company-wide autonomy projection is evidence-backed from coverage; it is not an AI score.

Schedules are portable invocation intent. The scheduler implementation can be local, Vercel Cron, GitHub Actions, Azure, AWS, or another provider without changing company semantics.
