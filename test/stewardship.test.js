import test from "node:test";
import assert from "node:assert/strict";
import { compileStewardshipProfile, evaluateStewardshipProposal, attestStewardshipApproval } from "../src/stewardship.js";

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
