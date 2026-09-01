import { createHash } from "node:crypto";
import { EngineError } from "./operations.js";

export const stewardshipReason = (code, message, details = {}) => ({ allowed: false, code, message, details });

export function compileStewardshipProfile(declaration, runtime = {}, now = new Date()) {
  const declared = declaration.spec.stewardship?.autonomy;
  if (!declared) return null;
  const control = runtime.stewardshipControl ?? { state: "disabled", enabledAt: null, expiresAt: null, pausedAt: null };
  const effectiveExpiry = control.expiresAt ?? declared.expiresAt ?? null;
  const expired = effectiveExpiry != null && Date.parse(effectiveExpiry) <= now.getTime();
  const day = now.toISOString().slice(0, 10);
  const storedUsage = runtime.stewardshipUsage ?? {};
  const usage = storedUsage.day === day
    ? { active: 0, dailyChanges: 0, actions: 0, repairRounds: 0, ...storedUsage, day }
    : { active: storedUsage.active ?? 0, dailyChanges: 0, actions: 0, repairRounds: 0, day };
  return {
    id: declared.stateReference, declaredMode: declared.mode,
    state: expired ? "expired" : control.state,
    activeFrom: declared.activeFrom ?? null, expiresAt: effectiveExpiry,
    triggers: [...declared.triggers], limits: structuredClone(declared.limits), gates: structuredClone(declared.gates),
    protectedCategories: [...declared.protectedCategories], duties: structuredClone(declared.duties), afterMerge: structuredClone(declared.afterMerge),
    usage: structuredClone(usage)
  };
}

export function evaluateStewardshipProposal(profile, proposal, { actorId, approval, checks = [], now = new Date() } = {}) {
  if (!profile) return stewardshipReason("stewardship_not_declared", "No autonomous stewardship profile is declared.");
  if (profile.state !== "enabled") return stewardshipReason(`stewardship_${profile.state}`, `Stewardship is ${profile.state}.`);
  if (profile.activeFrom && Date.parse(profile.activeFrom) > now.getTime()) return stewardshipReason("stewardship_not_active", "Stewardship activation has not begun.");
  if (profile.expiresAt && Date.parse(profile.expiresAt) <= now.getTime()) return stewardshipReason("stewardship_expired", "Stewardship authorization has expired.");
  const actionCount = proposal.actionCount ?? 1, repairRoundCount = proposal.repairRoundCount ?? 0;
  if (!Number.isSafeInteger(actionCount) || actionCount < 0 || !Number.isSafeInteger(repairRoundCount) || repairRoundCount < 0) return stewardshipReason("stewardship_usage_invalid", "Proposal usage must be expressed as non-negative integer counts.");
  const usage = profile.usage;
  if (usage.active >= profile.limits.concurrency) return stewardshipReason("stewardship_concurrency_exhausted", "The concurrency limit is exhausted.");
  if (usage.dailyChanges >= profile.limits.dailyChanges) return stewardshipReason("stewardship_daily_limit_exhausted", "The daily change limit is exhausted.");
  if (usage.actions + actionCount > profile.limits.actions) return stewardshipReason("stewardship_action_limit_exhausted", "The action limit is exhausted.");
  if (usage.repairRounds + repairRoundCount > profile.limits.repairRounds) return stewardshipReason("stewardship_repair_limit_exhausted", "The repair round limit is exhausted.");
  const protectedCategories = (proposal.categories ?? []).filter(item => profile.protectedCategories.includes(item));
  if (protectedCategories.length) return stewardshipReason("stewardship_owner_approval_required", "Protected changes require owner approval.", { protectedCategories });
  if (proposal.proposerActorId !== actorId) return stewardshipReason("stewardship_actor_mismatch", "The authenticated proposer does not match the proposal.");
  if (!approval) return stewardshipReason("stewardship_independent_review_required", "An independent exact-head approval is required.");
  if (approval.actorId === actorId) return stewardshipReason("stewardship_self_approval", "A proposer cannot approve its own change.");
  if (approval.proposalId !== proposal.id || approval.headSha !== proposal.headSha) return stewardshipReason("stewardship_changed_head", "Approval does not bind this proposal and exact head.");
  if (!checks.length || checks.some(check => check.status !== "successful")) return stewardshipReason("stewardship_checks_unsuccessful", "Every required check must be successful.");
  return { allowed: true, code: "stewardship_allowed", message: "Declared stewardship policy allows this exact proposal head.", exactHeadSha: proposal.headSha };
}

export function attestStewardshipApproval({ proposalId, headSha, actorId, outcome, reviewedAt = new Date().toISOString() }) {
  if (!proposalId || !/^[0-9a-f]{40,64}$/i.test(headSha ?? "") || !actorId || outcome !== "approved") throw new EngineError("stewardship_approval_invalid", "Approval requires an approved outcome bound to a proposal and exact head SHA.");
  const payload = { proposalId, headSha: headSha.toLowerCase(), actorId, outcome, reviewedAt };
  return { ...payload, attestation: createHash("sha256").update(JSON.stringify(payload)).digest("hex") };
}
