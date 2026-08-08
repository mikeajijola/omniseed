# Engine architecture

The control loop is `load → compile → diff → plan → approve → apply → observe → persist → compile`.

Provider adapters advertise primitive families and implement validation, planning, application, observation, discovery and health. A concrete plan binds every action to the provider selected for its family. State-version checks prevent an approved plan from being applied against a different reality.

Semantic systems may propose Omniform or a realisation, but only this deterministic path mutates resources. Desired declarations, deployed resources, observations, evidence and history are stored as distinct records.
