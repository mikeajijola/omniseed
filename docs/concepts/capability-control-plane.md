# Capability control plane

OmniSeed publishes an operation registry so every actor can discover the same governed capability surface. Each operation declares its runtime operation, permissions, inputs, outputs, risk, mutation and approval properties, applicable types, and available interfaces. UI controls, Lily, APIs, the CLI, and permitted machine controllers select from this registry; none receives a private business operation.

Natural-language requests cross a structured intent boundary. An `IntentResolver` receives the utterance, company context, and available operations, then returns `resolved`, `clarification_required`, `rejected`, or `unsupported` intent. A resolved intent is only a proposal. Policy and authorization are evaluated again before the runtime operation, and providers remain the only layer that calls vendor APIs.

Lily's operational actor is `company_steward`. “Lily” is its default presentation name and can change without changing permissions, memory, policies, or audit identity.

Organisational learning is separate from conversation history. A candidate `OrganisationalLearning` retains capability relationships, evidence provenance, confidence, source, validation status, and time. Only validated learning should become durable organisational memory.
