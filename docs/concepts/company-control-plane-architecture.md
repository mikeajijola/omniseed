# Company control plane architecture

Omniform declares portable organisational meaning. OmniSeed compiles it into an executable registry and governs the realisation lifecycle. OmniSeed OS and Lily project that live state without recalculating it.

```text
USER
  ↓
LILY
  ↓
CAPABILITY
  ↓
REQUIREMENTS
  ↓
REALISATION
  ├─ Agents
  ├─ Skills
  ├─ Connectors
  ├─ Workflows
  ├─ Schedules
  ├─ Systems
  ├─ Humans / Partners
  └─ Machines
  ↓
PROVIDERS
  ↓
REAL WORLD
  ↓
EVIDENCE
  ↓
CAPABILITY STATE
  ↓
LILY
```

The semantic/deterministic boundary is explicit:

```text
SEMANTIC
intent / understanding / recommendation
  ↓
STRUCTURED HANDOFF
capability + concrete plan
  ↓
DETERMINISTIC
schema / coverage / policy / authorization / apply / providers / state
  ↓
REAL WORLD
  ↓
SEMANTIC + DETERMINISTIC OBSERVATION
  ↓
evidence / validated learning / next decision
```

Provider apply is never itself proof of realisation. OmniSeed observes independently, stores sanitized evidence, recalculates requirement coverage, and then chooses `realised`, `partial`, `missing`, `retryable`, `blocked`, `deferred`, or `accepted_gap`. Attempts are bounded and auditable.
