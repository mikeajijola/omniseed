# Engine architecture

The control loop is `load → compile → diff → plan → approve → apply → observe → persist → compile`.

Provider adapters are explicitly registered and advertise primitive families and capability offerings. Desired, installed, configured, connected and healthy are distinct. The resolver moves from requirements and current coverage to candidate realisations; exact resources in Omniform are optional constraints.

A concrete plan binds every action to the provider selected for its family. Plans are persisted and content-hashed. Actor-scoped approval names the exact plan hash and selected action IDs. Definition and state-version checks prevent approval reuse against a different reality.

Semantic systems may propose Omniform or a realisation, but only this deterministic path mutates resources. Desired declarations, deployed resources, observations, evidence and history are stored as distinct records.

Declared operations compile into an executable registry containing implementation, permission, mutation, approval, provider dependency and availability truth. Declaration alone never makes an operation executable.

`company_search` is an ordinary provider family. Calls carry the canonical company ID as their namespace and return provider-neutral, sourced results. Lily, UI, API, CLI, agents and machines use the same operation; none talk directly to a vendor. Search indexes canonical truth for retrieval but never becomes that truth.
