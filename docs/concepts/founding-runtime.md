# Founding runtime

Founding is a structured capability, not an autonomous agent. `MockFoundingDesigner` converts free-form intent into a validated proposal without paid APIs. The replaceable designer contract supports intent analysis and refinement.

Sessions progress through intent, proposed, reviewed/accepted, and committed states. Proposed items carry workflow-only status, rationale, confidence, and source. Assumptions and open questions remain advisory. Founder actions accept, reject, edit, explain, or add items before commit.

`commitFoundingDraft` requires `commit_company` authorization. It selects accepted/edited canonical items, generates and validates Omniform, persists the desired definition, initializes version-zero state, calculates missing capabilities, creates an unresolved initial plan, and emits founding/company/state events. It never fabricates resources.
