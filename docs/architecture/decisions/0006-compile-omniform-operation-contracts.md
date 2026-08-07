# 0006 — Compile Omniform operation contracts

Status: accepted

## Decision

OmniSeed materializes the versioned Omniform operation catalogue and compiles it with separately registered runtime handlers. The compiler owns schema validation, implementation availability, permission and approval enforcement, handler conformance, and operation discovery. An implementation without an Omniform declaration is rejected; a declaration without an implementation remains visible as unavailable.

API metadata, agent tools, CLI registrations, machine descriptions, and generated reference pages derive from that compiled source. Materialized files record their source and CI checks them against the public Omniform repository.

## Consequences

Provider and runtime implementation remain replaceable. Interfaces no longer own semantic copies of operation permissions, inputs, outputs, mutation, or risk. Legacy operations migrate incrementally, beginning with `get_capability`, `generate_plan`, and `apply_plan`.
