# Governed company changes

A Realisation Plan changes reality to match the company definition.

A Company Change Proposal proposes changing the company definition itself.

These are separate governed mutations. Applying a Company Change Proposal updates canonical desired state; it does not install a Provider, deploy a resource, or claim that a new Capability is realised. Compilation exposes the resulting gaps and the ordinary resolver, plan, approval, Provider apply, observation, and evidence loop handles them.

## Proposal contract

OmniSeed persists Company Change Proposals separately from realisation plans. A Generation 1 proposal contains:

- stable `id`, `companyId`, lifecycle `status`, creation time, and proposer actor identity;
- `baseDefinitionHash`, the inspected merged `baseDesiredRevision` when known, and the previewed `proposedDefinitionHash`;
- an exact proposal `hash` used by approval;
- rationale in `reason`, separate resolvable `evidence` references, assumptions, alternatives, and risks;
- inspectable target paths and a deterministic `patch`;
- required approval/apply permission sets, approval or rejection records, and resulting hash/application metadata.

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

Approval binds the exact persisted proposal hash. Before approval and apply, OmniSeed compares the active definition hash with `baseDefinitionHash` and, when recorded, the runtime's merged desired revision with `baseDesiredRevision`; mismatch records `stale` and returns `company_change_stale`. It never rebases or regenerates a proposal during apply. Approval and apply are separate authorities and need not belong to the proposer.

`requiredAuthority` is enforceable Generation 1 policy expressed through the existing permission model: `{ approve: string[], apply: string[] }`. OmniSeed always includes the baseline `company_change.approve` and `company_change.apply` permissions and deterministically enforces any additional proposal-specific permissions at the corresponding lifecycle transition. Merging a submitted Git-backed change additionally requires `company_change.merge`.

Authorisation is evaluated against the currently active company and permissions. A proposal that would weaken future governance cannot use that future governance to authorise itself.

## Public engine API and operations

The public inspection projection includes the exact parsed `definition`, its `definitionHash`, and the merged `instance.desiredRevision`. A caller can bind those inspection facts into `baseDefinitionHash` and `baseDesiredRevision` when proposing; stale input is rejected before persistence.

The public engine exposes `proposeCompanyChange`, `listCompanyChangeProposals`, `getCompanyChangeProposal`, `previewCompanyChange`, `approveCompanyChange`, `rejectCompanyChange`, `applyCompanyChange`, and `mergeCompanyChange`.

Declared Omniform operations can expose the same implementation-neutral capability as `propose_company_change`, `inspect_company_change`, `approve_company_change`, `reject_company_change`, `apply_company_change`, and `merge_company_change`. Lily, humans, agents, API clients, CLI clients, and machines use these ordinary operations subject to their actor permissions. Proposal and approval have no Provider side effects; apply and merge cross only the configured company-repository Provider boundary.

Semantic reasoning remains a rationale, not evidence. Lily or another replaceable reasoning system may conclude that repeated verified failures indicate a design problem and cite the relevant evidence records. Only deterministic validation, approval, and apply can change canonical company truth.

## Canonical Git document and merge

The company-repository boundary fetches the canonical document, verifies that its base revision is the exact merged revision bound into the reviewed proposal, and applies the reviewed JSON Patch to that document. Scalar replacements preserve unrelated YAML bytes, ordering, flow style, and comments. Other patch shapes preserve document structure and comments where YAML syntax permits. OmniSeed parses the formatted result and compares it with the exact approved candidate before Provider validation or mutation.

Merge remains a separate governed operation. The `workflows` Provider must confirm an unchanged pull-request head, actor merge authority, required repository approval, and passing checks. Merge evidence is persisted, but desired state changes only when OmniSeed subsequently resolves the merged canonical branch.
