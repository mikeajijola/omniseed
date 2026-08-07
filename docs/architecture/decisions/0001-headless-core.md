# ADR 0001: Headless core and shared capability contracts

- Status: Accepted

## Decision

Core consumes Omniform and exposes deterministic structured operations and events without importing OmniSeed OS. Human, AI/software, and machine interfaces invoke the same capability contracts and policy semantics.

## Consequences

UI cannot own domain state; vendors remain providers; new interfaces do not require new implementations.
