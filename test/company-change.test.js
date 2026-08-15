import test from "node:test";
import assert from "node:assert/strict";
import { parseOmniform } from "@omniseed/omniform";
import { MemoryStateStore, OmniSeed, ProviderRegistry, ReferenceProvider } from "../src/index.js";

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
