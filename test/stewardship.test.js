import test from "node:test";
import assert from "node:assert/strict";
import { parseOmniform } from "@omniseed/omniform";
import { compileStewardshipProfile, evaluateStewardshipProposal, attestStewardshipApproval, MemoryStateStore, OmniSeed, ProviderRegistry } from "../src/index.js";

const autonomy = { mode: "autonomous_safe", stateReference: "stewardship_control", triggers: ["owner_request"], limits: { concurrency: 1, dailyChanges: 2, repairRounds: 1, actions: 3 }, gates: { validation: true, independentReview: true, unchangedHead: true, successfulChecks: true }, protectedCategories: ["authority"], duties: [{ actor: "steward", permissions: ["propose"] }, { actor: "reviewer", permissions: ["approve"] }, { actor: "executor", permissions: ["merge", "apply"] }, { actor: "observer", permissions: ["observe"] }], afterMerge: { reconcile: true, observe: true }, expiresAt: "2099-01-01T00:00:00Z" };
const declaration = { spec: { stewardship: { autonomy } } };
const head = "a".repeat(40), proposal = { id: "proposal_1", headSha: head, proposerActorId: "steward", categories: ["ordinary"], actionCount: 1 };
const approval = attestStewardshipApproval({ proposalId: proposal.id, headSha: head, actorId: "reviewer", outcome: "approved" });
const profile = compileStewardshipProfile(declaration, { stewardshipControl: { state: "enabled", expiresAt: "2098-01-01T00:00:00Z" } }, new Date("2097-01-01T00:00:00Z"));

test("ordinary safe exact head passes independent approval and checks", () => assert.equal(evaluateStewardshipProposal(profile, proposal, { actorId: "steward", approval, checks: [{ status: "successful" }], now: new Date("2097-01-01") }).allowed, true));
test("self approval, changed heads, failed checks and protected authority fail with machine reasons", () => {
  assert.equal(evaluateStewardshipProposal(profile, proposal, { actorId: "steward", approval: { ...approval, actorId: "steward" }, checks: [{ status: "successful" }], now: new Date("2097-01-01") }).code, "stewardship_self_approval");
  assert.equal(evaluateStewardshipProposal(profile, proposal, { actorId: "steward", approval: { ...approval, headSha: "b".repeat(40) }, checks: [{ status: "successful" }], now: new Date("2097-01-01") }).code, "stewardship_changed_head");
  assert.equal(evaluateStewardshipProposal(profile, proposal, { actorId: "steward", approval, checks: [{ status: "failed" }], now: new Date("2097-01-01") }).code, "stewardship_checks_unsuccessful");
  assert.equal(evaluateStewardshipProposal(profile, { ...proposal, categories: ["authority"] }, { actorId: "steward", approval, checks: [{ status: "successful" }], now: new Date("2097-01-01") }).code, "stewardship_owner_approval_required");
});
test("expiry, disable and limits fail closed", () => {
  assert.equal(evaluateStewardshipProposal({ ...profile, state: "disabled" }, proposal, {}).code, "stewardship_disabled");
  assert.equal(evaluateStewardshipProposal({ ...profile, expiresAt: "2020-01-01T00:00:00Z" }, proposal, { now: new Date("2021-01-01") }).code, "stewardship_expired");
  assert.equal(evaluateStewardshipProposal({ ...profile, usage: { ...profile.usage, active: 1 } }, proposal, { now: new Date("2097-01-01") }).code, "stewardship_concurrency_exhausted");
});

const operationIds = ["inspect_stewardship", "enable_stewardship", "pause_stewardship", "disable_stewardship", "evaluate_stewardship_proposal", "record_stewardship_review"];
const operationPermissions = {
  inspect_stewardship: "stewardship.read",
  enable_stewardship: "stewardship.control",
  pause_stewardship: "stewardship.control",
  disable_stewardship: "stewardship.control",
  evaluate_stewardship_proposal: "stewardship.propose",
  record_stewardship_review: "stewardship.review"
};

function engineDeclaration(policy = autonomy) {
  const company = parseOmniform(`apiVersion: omniform.org/v1alpha1
kind: Company
metadata: { id: acme, name: Acme }
spec:
  providers: { agents: { provider: absent_agent } }
  capabilities:
    - { id: company_stewardship, name: Company Stewardship, requires: [{ id: steward_company, primitiveFamily: agents }] }
  operations:
    - { id: inspect_company, capability: company_stewardship, description: Inspect, input: {}, output: {}, mutation: false, permissions: [company.read], approval: none, interfaces: [api] }
`);
  company.spec.stewardship = { capability: "company_stewardship", autonomy: structuredClone(policy) };
  company.spec.operations = operationIds.map(id => ({ id, capability: "company_stewardship", description: id, input: {}, output: {}, mutation: id !== "inspect_stewardship" && id !== "evaluate_stewardship_proposal", permissions: [operationPermissions[id]], approval: "none", interfaces: ["api"] }));
  return company;
}

test("engine stewardship methods enforce the canonical governance-amended policy", async () => {
  const raw = engineDeclaration();
  const canonical = engineDeclaration({ ...autonomy, expiresAt: "2097-01-01T00:00:00Z", protectedCategories: ["authority", "ordinary"], limits: { ...autonomy.limits, concurrency: 0 } });
  const store = new MemoryStateStore({ version: 4, companyId: "acme", canonicalDefinition: canonical, deployed: [], observed: [], evidence: [], history: [], plans: [], companyChanges: [], stewardshipControl: { state: "disabled", enabledAt: null, expiresAt: null, pausedAt: null }, stewardshipUsage: { active: 0, dailyChanges: 0, actions: 0, repairRounds: 0, day: "2096-01-01" }, stewardshipApprovals: [] });
  const engine = new OmniSeed({ store, providers: new ProviderRegistry() });
  const controller = { actorId: "owner", permissions: ["stewardship.control"] };

  await assert.rejects(engine.enableStewardship(raw, { expiresAt: "2098-01-01T00:00:00Z" }, controller), error => error.code === "stewardship_expiry_invalid");
  const enabled = await engine.enableStewardship(raw, { expiresAt: "2096-01-01T00:00:00Z" }, controller);
  assert.deepEqual(enabled.protectedCategories, ["authority", "ordinary"]);
  assert.equal((await engine.setStewardshipState(raw, "paused", controller)).limits.concurrency, 0);
  await engine.enableStewardship(raw, { expiresAt: "2096-01-01T00:00:00Z" }, controller);
  assert.equal((await engine.evaluateStewardship(raw, proposal, [{ status: "successful" }], { actorId: "steward", permissions: ["stewardship.propose"] })).code, "stewardship_concurrency_exhausted");
});

test("all stewardship operations route through the registry and persist versioned control and exact-head approval state", async () => {
  const company = engineDeclaration();
  const usage = { active: 0, dailyChanges: 0, actions: 1, repairRounds: 0, day: "2096-01-01" };
  const store = new MemoryStateStore({ version: 0, companyId: "acme", deployed: [], observed: [], evidence: [], history: [], plans: [], companyChanges: [], stewardshipControl: { state: "disabled", enabledAt: null, expiresAt: null, pausedAt: null }, stewardshipUsage: usage, stewardshipApprovals: [] });
  const engine = new OmniSeed({ store, providers: new ProviderRegistry() });
  const actor = { actorId: "owner", permissions: Object.values(operationPermissions) };
  const invoke = (id, input, authorization = actor) => engine.operations.invoke({ id, permissions: [operationPermissions[id]] }, input, { engine, declaration: company, authorization });

  assert.equal((await invoke("inspect_stewardship", {})).state, "disabled");
  assert.equal((await invoke("enable_stewardship", { expiresAt: "2098-01-01T00:00:00Z" })).state, "enabled");
  assert.equal((await invoke("pause_stewardship", {})).state, "paused");
  await invoke("enable_stewardship", { expiresAt: "2098-01-01T00:00:00Z" });
  const review = await invoke("record_stewardship_review", { proposalId: proposal.id, headSha: head, outcome: "approved" }, { ...actor, actorId: "reviewer" });
  assert.equal(review.headSha, head);
  assert.equal((await invoke("evaluate_stewardship_proposal", { proposal, checks: [{ status: "successful" }] }, { ...actor, actorId: "steward" })).allowed, true);
  assert.equal((await invoke("disable_stewardship", {})).state, "disabled");

  const state = await store.load("acme");
  assert.equal(state.version, 5);
  assert.deepEqual(state.stewardshipUsage, usage);
  assert.equal(state.stewardshipApprovals.length, 1);
  assert.deepEqual(state.history.map(item => item.type), ["stewardship_enabled", "stewardship_paused", "stewardship_enabled", "stewardship_exact_head_approved", "stewardship_disabled"]);
});
