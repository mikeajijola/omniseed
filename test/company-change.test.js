import test from "node:test";
import assert from "node:assert/strict";
import { parseOmniform, serializeCanonical } from "@omniseed/omniform";
import { applyDefinitionPatch, InMemoryGitCompanyRepository, MemoryStateStore, OmniSeed, ProviderGitCompanyRepository, ProviderRegistry, ReferenceProvider } from "../src/index.js";

const actors = {
  lily: { actorId: "lily", actorType: "ai", permissions: ["company_change.propose"] },
  human: { actorId: "owner", actorType: "human", permissions: ["company_change.propose", "company_change.approve", "company_change.reject", "company_change.apply", "plan.create", "plan.approve", "plan.apply", "state.reconcile"] },
  machine: { actorId: "automation", actorType: "machine", permissions: ["company_change.propose"] }
};

const source = `apiVersion: omniform.org/v1alpha1
kind: Company
metadata: { id: acme, name: Acme }
spec:
  providers: { workflows: { provider: reference_workflows } }
  capabilities:
    - { id: customer_support, name: Customer Support, requires: [{ id: support_workflow, primitiveFamily: workflows }] }
  operations:
    - { id: propose_company_change, capability: customer_support, description: Propose a governed company definition change, input: {}, output: {}, mutation: true, permissions: [company_change.propose], approval: none, interfaces: [lily, ui, api, cli, agent, machine] }
    - { id: inspect_company_change, capability: customer_support, description: Inspect company change proposals, input: {}, output: {}, mutation: false, permissions: [company_change.read], approval: none, interfaces: [lily, ui, api, cli, agent, machine] }
    - { id: approve_company_change, capability: customer_support, description: Approve an exact company change, input: {}, output: {}, mutation: true, permissions: [company_change.approve], approval: none, interfaces: [ui, api, cli, agent, machine] }
    - { id: reject_company_change, capability: customer_support, description: Reject a company change, input: {}, output: {}, mutation: true, permissions: [company_change.reject], approval: none, interfaces: [ui, api, cli, agent, machine] }
    - { id: apply_company_change, capability: customer_support, description: Apply an approved company change, input: {}, output: {}, mutation: true, permissions: [company_change.apply], approval: required, interfaces: [ui, api, cli, agent, machine] }
`;

const declaration = parseOmniform(source);
const addTriage = [{ op: "add", path: "/spec/capabilities/-", value: { id: "customer_triage", name: "Customer Triage", requires: [{ id: "triage_workflow", primitiveFamily: "workflows" }] } }];

function engine(state) { return new OmniSeed({ store: new MemoryStateStore(state), providers: new ProviderRegistry() }); }
function request(patch = addTriage) {
  return { reason: "Verified outcomes show support needs a separate triage responsibility.", evidence: ["evidence_support_failures"], patch, assumptions: ["The fixture evidence remains representative."], risks: ["A new capability initially has no realised resource."] };
}
function stateWithEvidence() {
  return { version: 0, companyId: "acme", deployed: [], observed: [], evidence: [{ id: "evidence_support_failures", type: "verified_outcome", outcome: "failed", observedAt: "2026-08-14T09:00:00.000Z" }], history: [], plans: [], companyChanges: [] };
}

test("authorised Lily, human, and machine actors use the same proposal capability", async () => {
  for (const actor of [actors.lily, actors.human, actors.machine]) {
    const proposal = await engine(stateWithEvidence()).invokeOperation(declaration, "propose_company_change", request(), actor);
    assert.equal(proposal.proposedBy.actorId, actor.actorId);
    assert.equal(proposal.proposedBy.actorType, actor.actorType);
    assert.equal(proposal.baseDefinitionHash.length, 64);
    assert.deepEqual(proposal.evidence, [{ id: "evidence_support_failures" }]);
    assert.equal(proposal.status, "proposed");
    assert.equal(proposal.hash.length, 64);
  }
});

test("proposal creation requires authority and resolvable evidence", async () => {
  await assert.rejects(engine(stateWithEvidence()).proposeCompanyChange(declaration, request(), { actorId: "viewer", permissions: [] }), error => error.code === "authorization_denied");
  await assert.rejects(engine(stateWithEvidence()).proposeCompanyChange(declaration, { ...request(), evidence: ["invented"] }, actors.lily), error => error.code === "evidence_not_found");
});

test("invalid patches and invalid resulting Omniform are rejected", async () => {
  await assert.rejects(engine(stateWithEvidence()).proposeCompanyChange(declaration, request([{ op: "invent", path: "/spec" }]), actors.lily), error => error.code === "company_change_invalid");
  await assert.rejects(engine(stateWithEvidence()).proposeCompanyChange(declaration, request([{ op: "remove", path: "/metadata/id" }]), actors.lily), error => error.code === "company_change_invalid" && error.details.validation.length > 0);
});

test("preview is deterministic, validates and has no Provider side effects", async () => {
  const store = new MemoryStateStore(stateWithEvidence()), subject = new OmniSeed({ store, providers: new ProviderRegistry() });
  const proposal = await subject.proposeCompanyChange(declaration, request(), actors.lily);
  const before = await store.load("acme"), preview = await subject.previewCompanyChange(declaration, proposal.id, { actorId: "reviewer", permissions: ["company_change.read"] }), after = await store.load("acme");
  assert.equal(preview.validation.valid, true);
  assert.equal(preview.currentDefinitionHash, proposal.baseDefinitionHash);
  assert.equal(preview.proposedDefinitionHash, proposal.proposedDefinitionHash);
  assert.deepEqual(preview.impact.capabilities.added, ["customer_triage"]);
  assert.deepEqual(preview.impact.newlyUnmetCapabilities, ["customer_triage"]);
  assert.deepEqual(after, before);
});

test("approval binds the persisted proposal hash and rejection prevents apply", async () => {
  const subject = engine(stateWithEvidence());
  const proposal = await subject.proposeCompanyChange(declaration, request(), actors.lily);
  await assert.rejects(subject.approveCompanyChange(declaration, proposal.id, proposal.hash, actors.lily), error => error.code === "authorization_denied");
  await assert.rejects(subject.approveCompanyChange(declaration, proposal.id, "changed", actors.human), error => error.code === "approval_invalid");
  const approval = await subject.approveCompanyChange(declaration, proposal.id, proposal.hash, actors.human);
  assert.equal(approval.proposalHash, proposal.hash);

  const rejectedSubject = engine(stateWithEvidence());
  const rejected = await rejectedSubject.proposeCompanyChange(declaration, request(), actors.lily);
  await rejectedSubject.rejectCompanyChange(declaration, rejected.id, "Choose a smaller change.", actors.human);
  await assert.rejects(rejectedSubject.applyCompanyChange(declaration, rejected.id, actors.human), error => error.code === "company_change_invalid_state");
});

test("proposal-specific required authority is hashed and enforced for approval and apply", async () => {
  const subject = engine(stateWithEvidence());
  const proposal = await subject.proposeCompanyChange(declaration, { ...request(), requiredAuthority: { approve: ["board.approve"], apply: ["release.apply"] } }, actors.lily);
  assert.deepEqual(proposal.requiredAuthority, { approve: ["board.approve", "company_change.approve"], apply: ["company_change.apply", "release.apply"] });
  await assert.rejects(subject.approveCompanyChange(declaration, proposal.id, proposal.hash, actors.human), error => error.code === "authorization_denied" && error.details.missing.includes("board.approve"));
  const board = { ...actors.human, permissions: [...actors.human.permissions, "board.approve"] };
  await subject.approveCompanyChange(declaration, proposal.id, proposal.hash, board);
  await assert.rejects(subject.applyCompanyChange(declaration, proposal.id, actors.human), error => error.code === "authorization_denied" && error.details.missing.includes("release.apply"));
  const release = { ...actors.human, permissions: [...actors.human.permissions, "release.apply"] };
  assert.equal((await subject.applyCompanyChange(declaration, proposal.id, release)).proposal.status, "applied");
});

test("definition drift marks an approved proposal stale without rebasing", async () => {
  const subject = engine(stateWithEvidence());
  const proposal = await subject.proposeCompanyChange(declaration, request(), actors.lily);
  await subject.approveCompanyChange(declaration, proposal.id, proposal.hash, actors.human);
  const changed = structuredClone(declaration); changed.metadata.name = "Acme Changed Elsewhere";
  await assert.rejects(subject.applyCompanyChange(changed, proposal.id, actors.human), error => error.code === "company_change_stale");
  assert.equal((await subject.getCompanyChangeProposal(changed, proposal.id, { actorId: "reader", permissions: ["company_change.read"] })).status, "stale");
});

test("approved exact proposal changes desired state but does not fabricate realisation", async () => {
  const subject = engine(stateWithEvidence());
  const proposal = await subject.proposeCompanyChange(declaration, request(), actors.lily);
  await subject.approveCompanyChange(declaration, proposal.id, proposal.hash, actors.human);
  const applied = await subject.applyCompanyChange(declaration, proposal.id, actors.human);
  assert.equal(applied.proposal.status, "applied");
  assert.equal(applied.proposal.resultingDefinitionHash, applied.registry.definitionHash);
  assert.equal(applied.registry.capabilities.find(item => item.id === "customer_triage").state, "missing");
  assert.equal(applied.state.deployed.length, 0);
  assert.equal(applied.state.history.at(-1).type, "company_change_applied");
});

test("current governance authorises a proposal that would alter future governance", async () => {
  const subject = engine(stateWithEvidence());
  const patch = [{ op: "replace", path: "/spec/operations/4/approval", value: "none" }];
  const proposal = await subject.proposeCompanyChange(declaration, request(patch), actors.lily);
  await assert.rejects(subject.applyCompanyChange(declaration, proposal.id, { actorId: "future_policy", permissions: ["company_change.apply"] }), error => error.code === "company_change_invalid_state");
  await subject.approveCompanyChange(declaration, proposal.id, proposal.hash, actors.human);
  const applied = await subject.applyCompanyChange(declaration, proposal.id, actors.human);
  assert.equal(applied.declaration.spec.operations[4].approval, "none");
});

test("full loop changes design then uses the ordinary realisation plan and observation path", async () => {
  const provider = new ReferenceProvider({ id: "reference_workflows", families: ["workflows"], offerings: [
    { family: "workflows", id: "support_workflow", resource: { family: "workflows", id: "support_process", name: "Support Process", offers: ["support_workflow"] } },
    { family: "workflows", id: "triage_workflow", resource: { family: "workflows", id: "triage_process", name: "Triage Process", offers: ["triage_workflow"] } }
  ] });
  const subject = new OmniSeed({ store: new MemoryStateStore(stateWithEvidence()), providers: new ProviderRegistry().register(provider) });
  const proposal = await subject.proposeCompanyChange(declaration, request(), actors.lily);
  await subject.approveCompanyChange(declaration, proposal.id, proposal.hash, actors.human);
  const changed = await subject.applyCompanyChange(declaration, proposal.id, actors.human);
  assert.equal(changed.registry.capabilities.find(item => item.id === "customer_triage").state, "missing");
  const plan = await subject.plan(changed.declaration, actors.human);
  assert.ok(plan.actions.some(action => action.resourceId === "triage_process"));
  const approval = await subject.approve(plan, plan.actions.map(action => action.id), actors.human);
  const realised = await subject.apply(changed.declaration, plan, approval, actors.human);
  assert.equal(realised.registry.capabilities.find(item => item.id === "customer_triage").state, "realised");
  assert.ok(realised.state.evidence.length > 1);
});

test("Git-backed company change opens a proposal and cannot replace merged desired state", async () => {
  const canonical = structuredClone(declaration);
  canonical.spec.governance = { desiredState: { repository: "https://github.com/example/acme-company.git", branch: "main", path: "omniform.yaml", changeMode: "pull_request" } };
  const repository = new InMemoryGitCompanyRepository();
  const subject = new OmniSeed({ store: new MemoryStateStore(stateWithEvidence()), providers: new ProviderRegistry(), companyRepository: repository });
  const proposal = await subject.proposeCompanyChange(canonical, request(), actors.lily);
  await subject.approveCompanyChange(canonical, proposal.id, proposal.hash, actors.human);
  const submitted = await subject.applyCompanyChange(canonical, proposal.id, actors.human);
  assert.equal(submitted.proposal.status, "submitted");
  assert.equal(submitted.submission.status, "open");
  assert.equal(submitted.declaration.spec.capabilities.some(item => item.id === "customer_triage"), false);
  assert.equal(submitted.candidateDeclaration.spec.capabilities.some(item => item.id === "customer_triage"), true);
  assert.equal((await subject.inspect(canonical)).capabilities.some(item => item.id === "customer_triage"), false);
  assert.equal(repository.submissions.length, 1);
});

test("Git-backed company change fails closed without a repository connection", async () => {
  const canonical = structuredClone(declaration);
  canonical.spec.governance = { desiredState: { repository: "https://github.com/example/acme-company.git", branch: "main", path: "omniform.yaml", changeMode: "pull_request" } };
  const subject = engine(stateWithEvidence());
  const proposal = await subject.proposeCompanyChange(canonical, request(), actors.lily);
  await subject.approveCompanyChange(canonical, proposal.id, proposal.hash, actors.human);
  await assert.rejects(subject.applyCompanyChange(canonical, proposal.id, actors.human), error => error.code === "company_repository_unavailable");
});

test("Provider-backed company repository submits the exact candidate through a workflows Provider", async () => {
  const calls = [];
  const canonical = structuredClone(declaration);
  canonical.spec.governance = { desiredState: { repository: "https://github.com/example/acme-company.git", branch: "main", path: "omniform.yaml", changeMode: "pull_request" } };
  const provider = {
    metadata: { id: "github_protocol", families: ["workflows"], operations: ["company.repository.inspect"] },
    async invoke(operation, input) {
      calls.push({ method: "invoke", operation, input });
      return { repository: input.repository, baseBranch: input.baseBranch, baseSha: "a".repeat(40), document: { path: input.path, content: `${serializeCanonical(canonical)}\n` } };
    },
    async validate(action) { calls.push({ method: "validate", action }); return { valid: true, issues: [] }; },
    async plan(action) { calls.push({ method: "plan", action }); return { deterministic: true, actionId: action.id }; },
    async apply(action) {
      calls.push({ method: "apply", action });
      return { providerResourceId: "github://example/acme-company/pull/7", status: "proposed", attributes: { baseSha: "a".repeat(40), commitSha: "b".repeat(40), pullRequestNumber: 7, pullRequestUrl: "https://github.com/example/acme-company/pull/7" } };
    },
    async observe(resource) {
      calls.push({ method: "observe", resource });
      return { status: "healthy", checkedAt: "2026-08-15T00:00:00Z", evidence: [{ type: "software_change_state", source: "github_protocol" }], snapshot: { pullRequest: { state: "open", merged: false } } };
    }
  };
  const repository = new ProviderGitCompanyRepository({ provider });
  const subject = new OmniSeed({ store: new MemoryStateStore(stateWithEvidence()), providers: new ProviderRegistry(), companyRepository: repository });
  const proposal = await subject.proposeCompanyChange(canonical, request(), actors.lily);
  await subject.approveCompanyChange(canonical, proposal.id, proposal.hash, actors.human);
  const submitted = await subject.applyCompanyChange(canonical, proposal.id, actors.human);
  assert.equal(submitted.submission.pullRequest, "https://github.com/example/acme-company/pull/7");
  assert.equal(submitted.submission.baseRevision, "a".repeat(40));
  assert.equal(submitted.submission.commit, "b".repeat(40));
  const action = calls.find(call => call.method === "apply").action;
  assert.equal(action.family, "workflows");
  assert.equal(action.desired.spec.path, "omniform.yaml");
  assert.deepEqual(parseOmniform(action.desired.spec.content), submitted.candidateDeclaration);
  assert.deepEqual(calls.map(call => call.method), ["invoke", "validate", "plan", "apply", "observe"]);
  const observed = await repository.inspectSubmission({ submission: submitted.submission });
  assert.equal(observed.status, "open");
  assert.equal(observed.merged, false);
  assert.equal(observed.currentDesiredRevision, null);
});

test("Provider-backed company repository rejects a Provider outside workflows", () => {
  assert.throws(() => new ProviderGitCompanyRepository({ provider: { metadata: { id: "wrong", families: ["agents"], operations: ["company.repository.inspect"] } } }), error => error.code === "company_repository_invalid");
});

test("Provider-backed company repository preserves YAML comments, ordering, and unrelated bytes", async () => {
  const yaml = `# company header\napiVersion: omniform.org/v1alpha1\nkind: Company\nmetadata:\n  id: acme\n  name: Acme # keep name comment\nspec:\n  intent: Original intent\n  providers: { workflows: { provider: reference_workflows } } # keep flow style\n  capabilities:\n    - { id: customer_support, name: Customer Support, requires: [{ id: support_workflow, primitiveFamily: workflows }] }\n  operations:\n    - { id: inspect_company, capability: customer_support, description: Inspect company, input: {}, output: {}, mutation: false, permissions: [], approval: none, interfaces: [api] }\n`;
  const current = parseOmniform(yaml);
  const patch = [{ op: "replace", path: "/spec/intent", value: "Clarified intent" }];
  const candidate = applyDefinitionPatch(current, patch);
  let applied;
  const provider = {
    metadata: { id: "github_protocol", families: ["workflows"], operations: ["company.repository.inspect"] },
    async invoke() { return { baseSha: "a".repeat(40), document: { path: "omniform.yaml", content: yaml } }; },
    async validate() { return { valid: true, issues: [] }; }, async plan(action) { return { deterministic: true, actionId: action.id }; },
    async apply(action) { applied = action; return { providerResourceId: "github://example/acme/pull/8", status: "proposed", attributes: { baseSha: "a".repeat(40), commitSha: "b".repeat(40), pullRequestNumber: 8, pullRequestUrl: "https://github.com/example/acme/pull/8" } }; },
    async observe() { return { status: "healthy", checkedAt: "2026-08-15T00:00:00Z", evidence: [], snapshot: { pullRequest: { state: "open" } } }; }
  };
  const repository = new ProviderGitCompanyRepository({ provider });
  await repository.submit({ authority: { repository: "https://github.com/example/acme.git", branch: "main", path: "omniform.yaml", changeMode: "pull_request" }, candidate, proposal: { id: "ccp_format", hash: "hash", reason: "Clarify intent", proposedBy: { actorId: "lily" }, patch } });
  assert.equal(applied.desired.spec.content, yaml.replace("  intent: Original intent", "  intent: Clarified intent"));
});

test("Provider-backed company repository preserves indentation for nested object replacements", async () => {
  const yaml = `apiVersion: omniform.org/v1alpha1
kind: Company
metadata: { id: acme, name: Acme }
spec:
  providers: { connectors: { provider: reference_connectors } }
  capabilities:
    - id: customer_support
      name: Customer Support
      requires: [{ id: support_connector, primitiveFamily: connectors }]
  resources:
    connectors:
      - { id: support, name: Support, offers: [support_connector] }
  operations:
    - { id: inspect_company, capability: customer_support, description: Inspect company, input: {}, output: {}, mutation: false, permissions: [], approval: none, interfaces: [api] }
`;
  const current = parseOmniform(yaml);
  const replacement = { id: "support", name: "Support", offers: ["support_connector"], spec: { endpoint: "https://example.com", authentication: { credentialReference: "SUPPORT_TOKEN" } } };
  const patch = [{ op: "replace", path: "/spec/resources/connectors/0", value: replacement }];
  const candidate = applyDefinitionPatch(current, patch);
  let applied;
  const provider = {
    metadata: { id: "github_protocol", families: ["workflows"], operations: ["company.repository.inspect"] },
    async invoke() { return { baseSha: "a".repeat(40), document: { path: "omniform.yaml", content: yaml } }; },
    async validate() { return { valid: true, issues: [] }; }, async plan(action) { return { deterministic: true, actionId: action.id }; },
    async apply(action) { applied = action; return { providerResourceId: "github://example/acme/pull/10", status: "proposed", attributes: { baseSha: "a".repeat(40), commitSha: "b".repeat(40), pullRequestNumber: 10, pullRequestUrl: "https://github.com/example/acme/pull/10" } }; },
    async observe() { return { status: "healthy", checkedAt: "2026-08-16T00:00:00Z", evidence: [], snapshot: { pullRequest: { state: "open" } } }; }
  };
  const repository = new ProviderGitCompanyRepository({ provider });
  await repository.submit({ authority: { repository: "https://github.com/example/acme.git", branch: "main", path: "omniform.yaml", changeMode: "pull_request" }, candidate, proposal: { id: "ccp_nested", hash: "hash", reason: "Bind runtime", proposedBy: { actorId: "lily" }, patch } });
  assert.deepEqual(parseOmniform(applied.desired.spec.content), candidate);
  assert.match(applied.desired.spec.content, /      - id: support\n        name: Support/);
});

test("Provider-backed company repository preserves the newline after a replaced block", async () => {
  const yaml = `apiVersion: omniform.org/v1alpha1
kind: Company
metadata: { id: acme, name: Acme }
spec:
  providers: { connectors: { provider: reference_connectors } }
  capabilities:
    - id: customer_support
      name: Customer Support
      requires: [{ id: support_connector, primitiveFamily: connectors }]
  resources:
    connectors:
      - { id: support, name: Support, offers: [support_connector] }
  operations:
    - { id: inspect_company, capability: customer_support, description: Inspect company, input: {}, output: {}, mutation: false, permissions: [], approval: none, interfaces: [api] }
`;
  const current = parseOmniform(yaml);
  const resources = structuredClone(current.spec.resources);
  resources.connectors[0].spec = { endpoint: "https://example.com" };
  const patch = [{ op: "replace", path: "/spec/resources", value: resources }];
  const candidate = applyDefinitionPatch(current, patch);
  let applied;
  const provider = {
    metadata: { id: "github_protocol", families: ["workflows"], operations: ["company.repository.inspect"] },
    async invoke() { return { baseSha: "a".repeat(40), document: { path: "omniform.yaml", content: yaml } }; },
    async validate() { return { valid: true, issues: [] }; }, async plan(action) { return { deterministic: true, actionId: action.id }; },
    async apply(action) { applied = action; return { providerResourceId: "github://example/acme/pull/11", status: "proposed", attributes: { baseSha: "a".repeat(40), commitSha: "b".repeat(40), pullRequestNumber: 11, pullRequestUrl: "https://github.com/example/acme/pull/11" } }; },
    async observe() { return { status: "healthy", checkedAt: "2026-08-16T00:00:00Z", evidence: [], snapshot: { pullRequest: { state: "open" } } }; }
  };
  const repository = new ProviderGitCompanyRepository({ provider });
  await repository.submit({ authority: { repository: "https://github.com/example/acme.git", branch: "main", path: "omniform.yaml", changeMode: "pull_request" }, candidate, proposal: { id: "ccp_block", hash: "hash", reason: "Bind resources", proposedBy: { actorId: "lily" }, patch } });
  assert.deepEqual(parseOmniform(applied.desired.spec.content), candidate);
  assert.match(applied.desired.spec.content, /endpoint: https:\/\/example.com\n  operations:/);
});

test("format mismatch is rejected before Provider validation or mutation", async () => {
  let providerCalls = 0;
  const provider = {
    metadata: { id: "github_protocol", families: ["workflows"], operations: ["company.repository.inspect"] },
    async invoke() { return { baseSha: "a".repeat(40), document: { path: "omniform.yaml", content: source } }; },
    async validate() { providerCalls += 1; return { valid: true, issues: [] }; }, async plan() { providerCalls += 1; }, async apply() { providerCalls += 1; }, async observe() { providerCalls += 1; }
  };
  const repository = new ProviderGitCompanyRepository({ provider });
  await assert.rejects(repository.submit({ authority: { repository: "https://github.com/example/acme.git", branch: "main", path: "omniform.yaml", changeMode: "pull_request" }, candidate: declaration, proposal: { id: "ccp_bad", hash: "hash", reason: "Bad", proposedBy: { actorId: "lily" }, patch: [{ op: "replace", path: "/metadata/name", value: "Different" }] } }), error => error.code === "company_repository_serialization_invalid");
  assert.equal(providerCalls, 0);
});

test("governed company merge requires authority and persists Provider evidence", async () => {
  const canonical = structuredClone(declaration);
  canonical.spec.governance = { desiredState: { repository: "https://github.com/example/acme-company.git", branch: "main", path: "omniform.yaml", changeMode: "pull_request" } };
  let mergeCalls = 0;
  const repository = {
    async submit() { return { repository: canonical.spec.governance.desiredState.repository, baseBranch: "main", baseRevision: "a".repeat(40), branch: "omniseed/change", commit: "b".repeat(40), pullRequest: "https://github.com/example/acme-company/pull/9", pullRequestNumber: 9, providerResourceId: "github://example/acme-company/pull/9", status: "open", evidence: [] }; },
    async mergeSubmission({ authorization }) { mergeCalls += 1; assert.equal(authorization.actorId, "owner"); return { merged: true, mergeCommitSha: "c".repeat(40), mergedAt: "2026-08-15T00:00:00Z", evidence: [{ id: "merge_9", type: "company_change_merged", source: "github_protocol" }] }; }
  };
  const subject = new OmniSeed({ store: new MemoryStateStore(stateWithEvidence()), providers: new ProviderRegistry(), companyRepository: repository });
  const proposal = await subject.proposeCompanyChange(canonical, request(), actors.lily);
  await subject.approveCompanyChange(canonical, proposal.id, proposal.hash, actors.human);
  await subject.applyCompanyChange(canonical, proposal.id, actors.human);
  await assert.rejects(subject.mergeCompanyChange(canonical, proposal.id, { actorId: "lily", permissions: [] }), error => error.code === "authorization_denied");
  const result = await subject.mergeCompanyChange(canonical, proposal.id, { actorId: "owner", permissions: ["company_change.merge"] });
  assert.equal(result.proposal.status, "merged");
  assert.equal(result.proposal.merge.mergeCommitSha, "c".repeat(40));
  assert.equal(result.state.evidence.at(-1).id, "merge_9");
  assert.equal(mergeCalls, 1);
});
