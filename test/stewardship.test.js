import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { canonicalize, parseOmniform } from "@omniseed/omniform";
import { applyDefinitionPatch, attestStewardshipApproval, compileStewardshipProfile, definitionHash, MemoryStateStore, OmniSeed, ProviderRegistry } from "../src/index.js";

const autonomy = { mode: "autonomous_safe", stateReference: "stewardship_control", triggers: ["owner_request"], limits: { concurrency: 1, dailyChanges: 2, repairRounds: 1, actions: 3 }, gates: { validation: true, independentReview: true, unchangedHead: true, successfulChecks: true }, protectedCategories: ["authority"], duties: [{ actor: "steward", permissions: ["propose"] }, { actor: "reviewer", permissions: ["approve"] }, { actor: "executor", permissions: ["merge", "apply"] }, { actor: "observer", permissions: ["observe"] }], afterMerge: { reconcile: true, observe: true }, expiresAt: "2099-01-01T00:00:00Z" };
const head = "a".repeat(40);

function declaration(policy = autonomy) {
  const company = parseOmniform(`apiVersion: omniform.org/v1alpha1
kind: Company
metadata: { id: acme, name: Acme }
spec:
  providers: { agents: { provider: absent_agent } }
  capabilities:
    - { id: company_stewardship, name: Company Stewardship, requires: [{ id: steward_company, primitiveFamily: agents }], realisations: [primary_steward] }
  realisations:
    - { id: primary_steward, name: Primary steward, capability: company_stewardship, participants: [{ resource: lily, supplies: [steward_company] }] }
  resources:
    agents:
      - { id: lily, name: Lily, offers: [steward_company] }
  operations:
    - { id: inspect_company, capability: company_stewardship, description: Inspect, input: {}, output: {}, mutation: false, permissions: [company.read], approval: none, interfaces: [api] }
`);
  company.spec.stewardship = { capability: "company_stewardship", realisation: "primary_steward", autonomy: structuredClone(policy) };
  return company;
}

function fixture({ patch, checks = [{ status: "successful" }], policy = autonomy, observedAt = new Date().toISOString() } = {}) {
  const company = declaration(policy);
  const immutable = canonicalize({ companyId: "acme", proposedBy: { actorId: "steward" }, createdAt: "2026-09-01T00:00:00.000Z", baseDefinitionHash: definitionHash(company), proposedDefinitionHash: "c".repeat(64), reason: "safe change", evidence: [], targets: [], patch: patch ?? [{ op: "replace", path: "/metadata/name", value: "Acme Two" }], alternatives: [], assumptions: [], risks: [], requiredAuthority: { approve: ["company_change.approve"], apply: ["company_change.apply"] } });
  const hash = createHash("sha256").update(JSON.stringify(immutable)).digest("hex"), proposal = { id: `ccp_${hash.slice(0, 16)}`, status: "proposed", hash, ...immutable };
  const observation = { id: "obs_1", source: "provider", verified: true, proposalId: proposal.id, proposalDigest: proposal.hash, headSha: head, observedAt, checks, repairRoundCount: 0 };
  const state = { version: 0, companyId: "acme", canonicalDefinition: company, deployed: [], observed: [], evidence: [], history: [], plans: [], companyChanges: [{ ...proposal, status: "submitted", submission: { commit: head } }], stewardshipControl: { state: "enabled", expiresAt: "2098-01-01T00:00:00Z" }, stewardshipUsage: { active: 0, dailyChanges: 0, actions: 0, repairRounds: 0, day: null }, stewardshipObservations: [observation], stewardshipApprovals: [], stewardshipEvaluations: [] };
  return { company, proposal, observation, store: new MemoryStateStore(state) };
}

const reviewer = { actorId: "reviewer", permissions: ["stewardship.review"] };
const steward = { actorId: "steward", permissions: ["stewardship.propose"] };
const invoke = (engine, company, id, permission, input, authorization) => engine.operations.invoke({ id, permissions: [permission] }, input, { engine, declaration: company, authorization });

test("mandatory autonomous gates are rejected during candidate validation without bricking profile compilation", () => {
  for (const gate of ["validation", "independentReview", "unchangedHead", "successfulChecks"]) {
    const unsafe = declaration({ ...autonomy, gates: { ...autonomy.gates, [gate]: false } });
    assert.equal(compileStewardshipProfile(unsafe).gates[gate], false);
    assert.throws(() => applyDefinitionPatch(declaration(), [{ op: "replace", path: `/spec/stewardship/autonomy/gates/${gate}`, value: false }]), error => error.code === "stewardship_policy_unsafe" && error.details.disabledGates.includes(gate));
  }
});

test("attestations require persisted digest and observation bindings", () => assert.throws(() => attestStewardshipApproval({ proposalId: "p", headSha: head, actorId: "r", outcome: "approved" }), error => error.code === "stewardship_approval_invalid"));

test("caller-authored categories/checks cannot bypass facts derived from persisted patch", async () => {
  const f = fixture({ patch: [{ op: "replace", path: "/spec/stewardship/autonomy/gates/validation", value: true }] }), engine = new OmniSeed({ store: f.store, providers: new ProviderRegistry() });
  await engine.recordStewardshipApproval(f.company, { proposalId: f.proposal.id, observationId: f.observation.id, outcome: "approved", headSha: "b".repeat(40) }, reviewer);
  const result = await engine.evaluateStewardship(f.company, { proposalId: f.proposal.id, observationId: f.observation.id, categories: [], checks: [{ status: "successful" }] }, steward);
  assert.equal(result.code, "stewardship_owner_approval_required");
});

test("stale, mismatched, unverified and unsuccessful exact-head evidence is rejected", async () => {
  for (const change of [
    observation => { observation.proposalDigest = "b".repeat(64); },
    observation => { observation.headSha = "b".repeat(40); },
    observation => { observation.verified = false; },
    observation => { observation.observedAt = "2020-01-01T00:00:00Z"; }
  ]) {
    const f = fixture(); change(f.observation); const state = await f.store.load("acme"); state.stewardshipObservations = [f.observation]; const engine = new OmniSeed({ store: new MemoryStateStore(state), providers: new ProviderRegistry() });
    await assert.rejects(engine.recordStewardshipApproval(f.company, { proposalId: f.proposal.id, observationId: f.observation.id, outcome: "approved" }, reviewer), error => ["stewardship_evidence_unverified", "stewardship_changed_head", "stewardship_evidence_stale"].includes(error.code));
  }
  const f = fixture({ checks: [{ status: "failed" }] }), engine = new OmniSeed({ store: f.store, providers: new ProviderRegistry() });
  await engine.recordStewardshipApproval(f.company, { proposalId: f.proposal.id, observationId: f.observation.id, outcome: "approved" }, reviewer);
  assert.equal((await engine.evaluateStewardship(f.company, { proposalId: f.proposal.id, observationId: f.observation.id }, steward)).code, "stewardship_checks_unsuccessful");
});

test("approval, evaluation and completion retries are idempotent with exact-once release", async () => {
  const f = fixture(), engine = new OmniSeed({ store: f.store, providers: new ProviderRegistry() }), input = { proposalId: f.proposal.id, observationId: f.observation.id, outcome: "approved" };
  const approval = await invoke(engine, f.company, "record_stewardship_review", "stewardship.review", input, reviewer); assert.deepEqual(await invoke(engine, f.company, "record_stewardship_review", "stewardship.review", input, reviewer), approval);
  assert.equal((await invoke(engine, f.company, "evaluate_stewardship_proposal", "stewardship.propose", input, steward)).allowed, true); assert.equal((await invoke(engine, f.company, "evaluate_stewardship_proposal", "stewardship.propose", input, steward)).allowed, true);
  const completion = await invoke(engine, f.company, "complete_stewardship_proposal", "stewardship.propose", { proposalId: f.proposal.id, observationId: f.observation.id, outcome: "completed", evidence: ["e1"] }, steward);
  assert.deepEqual(await invoke(engine, f.company, "complete_stewardship_proposal", "stewardship.propose", { proposalId: f.proposal.id, observationId: f.observation.id, outcome: "failed" }, steward), completion);
  const state = await f.store.load("acme");
  assert.deepEqual(state.stewardshipUsage, { active: 0, dailyChanges: 1, actions: 1, repairRounds: 0, day: new Date().toISOString().slice(0, 10) });
  assert.equal(state.stewardshipApprovals.length, 1); assert.equal(state.stewardshipEvaluations.length, 1);
});

test("concurrent leases for one proposal and actor complete by exact observation", async () => {
  const f = fixture({ policy: { ...autonomy, limits: { ...autonomy.limits, concurrency: 2, dailyChanges: 2 } } });
  const second = { ...f.observation, id: "obs_2" };
  const state = await f.store.load("acme"); state.stewardshipObservations.push(second);
  const store = new MemoryStateStore(state), engine = new OmniSeed({ store, providers: new ProviderRegistry() });
  for (const observation of [f.observation, second]) {
    await engine.recordStewardshipApproval(f.company, { proposalId: f.proposal.id, observationId: observation.id, outcome: "approved" }, reviewer);
    assert.equal((await engine.evaluateStewardship(f.company, { proposalId: f.proposal.id, observationId: observation.id }, steward)).allowed, true);
  }
  await engine.completeStewardship(f.company, { proposalId: f.proposal.id, observationId: second.id, outcome: "completed" }, steward);
  assert.deepEqual((await store.load("acme")).stewardshipEvaluations.map(item => item.lease.status), ["active", "completed"]);
  await engine.completeStewardship(f.company, { proposalId: f.proposal.id, observationId: f.observation.id, outcome: "completed" }, steward);
  const completed = await store.load("acme");
  assert.deepEqual(completed.stewardshipEvaluations.map(item => item.lease.status), ["completed", "completed"]);
  assert.equal(completed.stewardshipUsage.active, 0);
});

test("zero budgets fail closed without consumption", async () => {
  for (const key of ["concurrency", "dailyChanges", "actions"]) {
    const f = fixture({ policy: { ...autonomy, limits: { ...autonomy.limits, [key]: 0 } } }), engine = new OmniSeed({ store: f.store, providers: new ProviderRegistry() });
    await engine.recordStewardshipApproval(f.company, { proposalId: f.proposal.id, observationId: f.observation.id, outcome: "approved" }, reviewer);
    assert.equal((await engine.evaluateStewardship(f.company, { proposalId: f.proposal.id, observationId: f.observation.id }, steward)).allowed, false);
    assert.equal((await f.store.load("acme")).stewardshipEvaluations.length, 0);
  }
});
