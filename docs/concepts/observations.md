# Observation execution

Omniform defines Observation. OmniSeed executes it as an `ObservationExecution` containing observation/capability identity, status, evidence references, and evaluator metadata. The first executor is deterministic `assertion`: it compares a declared resource state with deployment state and returns `satisfied` or `unsatisfied`.

Semantic evaluation remains replaceable. An evaluator accepts a semantic observation and evidence, then returns structured findings with identity, confidence, impact, urgency, response, timestamp, evidence references, and evaluator version. Provider-specific model prose is never runtime state.
