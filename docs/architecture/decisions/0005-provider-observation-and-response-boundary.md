# ADR 0005: Provider observation and response boundary

Status: Accepted

## Context

OmniSeed must control real external systems without moving vendor semantics into Omniform or allowing an observation, semantic evaluator, or provider to bypass authorization.

## Decision

Provider implementations translate `validate`, `plan`, `apply`, and `observe` operations. Core turns sanitized provider observations into evidence, calculates drift deterministically, invokes replaceable semantic evaluators where meaning is required, and represents the result as structured findings. A finding may create a proposed response, but that response must re-enter normal planning, policy, approval, and apply.

GitHub repository support is the first implementation. Its vendor configuration remains behind the provider contract and is not a portable Omniform primitive. Tests inject a fake HTTP boundary; real credentials are runtime-only inputs.

## Consequences

- Core and Omniform remain independent of GitHub.
- External mutations require the same authorization regardless of actor or interface.
- Evidence is traceable without storing provider credentials.
- Drift is deterministic; semantic interpretation remains replaceable and structured.
- Proposed responses cannot directly repair external state.
- Additional GitHub resource types and providers can reuse the control-loop contract.
