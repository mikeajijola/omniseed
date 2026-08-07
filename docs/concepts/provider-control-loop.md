# External provider control loop

OmniSeed's first real external control loop uses GitHub repositories as a small, testable provider resource:

```text
approved portable plan
        ↓
GitHub provider apply
        ↓
external repository
        ↓
GitHub provider observe
        ↓
sanitized evidence
        ↓
deterministic drift comparison
        ↓
semantic evaluation boundary
        ↓
structured finding
        ↓
proposed response requiring authorization
```

The provider never decides Company-as-Code meaning. It translates between an approved resource change and GitHub's API. Core compares declared provider configuration with observation evidence, creates drift, evaluates an Omniform semantic observation through the replaceable evaluator boundary, and proposes a response.

An observation or finding cannot directly mutate GitHub. `response.proposed` records an option such as `generate_plan`; the normal policy, approval, planning, and apply boundaries still govern execution.

## Actor parity

The lifecycle is exposed as structured contracts. A human can approve it through an operating interface, a software or AI actor can call the same authorized operation, and a permitted machine controller can use the same transport. The actor changes; provider validation, authorization, evidence, drift, and audit semantics do not.

## Evidence and secrets

Provider evidence contains the repository's operational attributes and an opaque external identifier. Access tokens are constructor inputs only and must be supplied by a credential mechanism outside portable state. OmniSeed does not place authentication headers, tokens, or raw API responses in portable state.
