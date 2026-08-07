# Runtime operations and transport

The stable domain operations are `getCompany`, `listCapabilities`, `getCapability`, `listGaps`, `getCurrentPlan`, `generatePlan`, `cancelPlan`, `getState`, `listActivity`, `listObservations`, `listFindings`, and `applyPlan`. HTTP clients POST JSON to `/operations/{operation}` and receive `{ "ok": true, "result": ... }`.

`applyPlan` requires the current plan ID, explicit approved change IDs, and authorization containing an actor and `apply_plan` permission. There are deliberately no direct database writes, forced resource state, or capability-state setters.

| Operation | Human | Software/AI | Embodied-machine/controller |
| --- | --- | --- | --- |
| Read state/gaps/findings | OS views or Eve answer | Structured tool/API | Same transport operation |
| Generate plan | Plan action | `generatePlan` tool/API | Same operation through controller |
| Apply approved changes | Approval/apply control | Authorized `applyPlan` tool | Authorized operation through controller |

All interfaces share policy, authorization, state transition, events, and evidence.
