# Governed company changes

A Realisation Plan changes reality to match the company definition.

A Company Change Proposal proposes changing the company definition itself.

These are separate governed mutations. Applying a Company Change Proposal updates canonical desired state; it does not install a Provider, deploy a resource, or claim that a new Capability is realised. Compilation exposes the resulting gaps and the ordinary resolver, plan, approval, Provider apply, observation, and evidence loop handles them.

## Proposal contract

OmniSeed persists Company Change Proposals separately from realisation plans. A Generation 1 proposal contains:

- stable `id`, `companyId`, lifecycle `status`, creation time, and proposer actor identity;
- `baseDefinitionHash` and the previewed `proposedDefinitionHash`;
- an exact proposal `hash` used by approval;
- rationale in `reason`, separate resolvable `evidence` references, assumptions, alternatives, and risks;
- inspectable target paths and a deterministic `patch`;
- required authority, approval or rejection records, and resulting hash/application metadata.

The patch is a deliberately narrow JSON Patch-compatible subset: `add`, `remove`, and `replace` operations using JSON Pointer paths. It operates on canonical parsed Omniform, never YAML text. Every candidate is validated by Omniform before persistence and again through exact deterministic application. Preview compiles current and candidate definitions without Provider side effects and reports added, changed, and removed capabilities, resources, and operations plus likely new gaps.

## Lifecycle and authority

```text
proposed → approved → applied
    │          │
    ├──────────┴→ stale
    └───────────→ rejected
```

The engine uses the existing actor permission mechanism:

- `company_change.propose`
- `company_change.read`
- `company_change.approve`
- `company_change.reject`
- `company_change.apply`

Approval binds the exact persisted proposal hash. Before approval and apply, OmniSeed compares the active definition hash with `baseDefinitionHash`; mismatch records `stale` and returns `company_change_stale`. It never rebases or regenerates a proposal during apply. Approval and apply are separate authorities and need not belong to the proposer.

Authorisation is evaluated against the currently active company and permissions. A proposal that would weaken future governance cannot use that future governance to authorise itself.

## Public engine API and operations

The public engine exposes `proposeCompanyChange`, `listCompanyChangeProposals`, `getCompanyChangeProposal`, `previewCompanyChange`, `approveCompanyChange`, `rejectCompanyChange`, and `applyCompanyChange`.

Declared Omniform operations can expose the same implementation-neutral capability as `propose_company_change`, `inspect_company_change`, `approve_company_change`, `reject_company_change`, and `apply_company_change`. Lily, humans, agents, API clients, CLI clients, and machines use these ordinary operations subject to their actor permissions. No operation talks to a Provider as part of changing the definition.

Semantic reasoning remains a rationale, not evidence. Lily or another replaceable reasoning system may conclude that repeated verified failures indicate a design problem and cite the relevant evidence records. Only deterministic validation, approval, and apply can change canonical company truth.
