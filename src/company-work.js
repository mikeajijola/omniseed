import { createHash, randomUUID } from "node:crypto";
import { EngineError } from "./operations.js";

export const EVE_COMPATIBILITY_PROTOCOL = "eve.session/1";
export const COMPANY_WORK_TERMINAL_STATES = new Set(["completed", "failed", "blocked", "cancelled", "denied"]);
export const COMPANY_WORK_WAIT_STATES = new Set(["waiting_for_input", "waiting_for_user_input", "waiting_for_company_approval", "waiting_for_checks", "waiting_for_merge", "waiting_for_desired_revision", "waiting_for_apply", "waiting_for_observation"]);
export const COMPANY_WORK_STATES = new Set(["queued", "running", "applying", "observing", ...COMPANY_WORK_WAIT_STATES, ...COMPANY_WORK_TERMINAL_STATES]);
const ACTIVE = ["queued", "running", "applying", "observing", ...COMPANY_WORK_WAIT_STATES];

export function createCompanyWorkRun({ declaration, intent, actorId, idempotencyKey = null, conversationId = null, segmentId = null, desiredRevision = null, observedRevision = null, now = new Date().toISOString(), id = segmentId ?? `work_${randomUUID()}` }) {
  const steward = resolveStewardActorId(declaration);
  if (!steward) throw new EngineError("company_work_unavailable", "The company has no declared Agent participating in its stewardship realisation.");
  if (actorId !== steward) throw new EngineError("authorization_denied", "Only the declared steward Agent may own a company work segment.");
  const normalizedIntent = required(intent, "Company work intent"), conversation = optional(conversationId) ?? `conversation_${randomUUID()}`;
  return { id, segmentId: id, conversationId: conversation, companyId: declaration.metadata.id, actorId, initiatedBy: actorId, intent: normalizedIntent, idempotencyKey: optional(idempotencyKey), mode: "inspection", status: "queued", desiredRevisionAtStart: desiredRevision, observedRevisionAtStart: observedRevision, session: null, await: null, associations: { operationIds: [], planIds: [], proposalIds: [], providerActionIds: [], evidenceIds: [], outcomeIds: [] }, events: [{ id: `${id}:created`, type: "company_work_started", at: now, summary: normalizedIntent }], createdAt: now, updatedAt: now, completedAt: null };
}

export function migrateCompanyWorkState(state, companyId = null) {
  const conversations = structuredClone(state?.conversations ?? []).map(conversation => ({ ...conversation, session: migrateLegacySession(conversation.session) }));
  const result = { version: state?.version ?? 0, companyId: state?.companyId ?? companyId, runs: [], conversations, continuationEvents: structuredClone(state?.continuationEvents ?? []) };
  for (const source of state?.runs ?? []) {
    const run = structuredClone(source); run.segmentId ??= run.id; run.conversationId ??= `legacy:${run.id}`; run.await ??= legacyWait(run.status, run.associations);
    run.associations = { operationIds: [], planIds: [], proposalIds: [], providerActionIds: [], evidenceIds: [], outcomeIds: [], ...(run.associations ?? {}) };
    run.session = migrateLegacySession(run.session);
    result.runs.push(run);
    if (run.session && !result.conversations.some(item => item.id === run.conversationId)) result.conversations.push({ id: run.conversationId, companyId: run.companyId, actorId: run.actorId, session: run.session, createdAt: run.createdAt, updatedAt: run.updatedAt });
  }
  return result;
}

export function transitionCompanyWorkRun(run, status, { at = new Date().toISOString(), summary = null, awaited = undefined } = {}) {
  if (!COMPANY_WORK_STATES.has(status)) throw new EngineError("company_work_invalid", `Unsupported company work status: ${status}`);
  if (run.status !== status && (COMPANY_WORK_TERMINAL_STATES.has(run.status) || !ACTIVE.includes(run.status))) throw new EngineError("company_work_invalid_state", `Company work cannot move from ${run.status} to ${status}.`);
  const wait = awaited === undefined ? (COMPANY_WORK_WAIT_STATES.has(status) ? run.await : null) : normalizeAwait(awaited, status);
  if (COMPANY_WORK_WAIT_STATES.has(status) && !wait && !["waiting_for_input", "waiting_for_user_input"].includes(status)) throw new EngineError("company_work_invalid", `${status} requires an exact awaited governance fact.`);
  if (run.status === status && JSON.stringify(run.await) === JSON.stringify(wait)) return run;
  const event = { id: `${run.id}:status:${status}:${run.events.length}`, type: "company_work_status_changed", status, at, ...(summary ? { summary: String(summary) } : {}) };
  return { ...run, status, await: wait, updatedAt: at, completedAt: COMPANY_WORK_TERMINAL_STATES.has(status) ? at : null, events: [...run.events, event] };
}

export function normalizeRuntimeAssociation(session, existing = null) {
  const legacy = session?.protocolId == null && session?.id != null;
  const protocolId = optional(session?.protocolId) ?? (legacy ? EVE_COMPATIBILITY_PROTOCOL : existing?.protocolId), runtimeSessionId = optional(session?.runtimeSessionId) ?? (legacy ? optional(session?.id) : existing?.runtimeSessionId);
  const continuation = session?.continuation !== undefined ? session.continuation : (legacy ? session.continuationToken : existing?.continuation);
  if (!protocolId) throw new EngineError("company_work_invalid", "Agent interaction protocol identifier is required.");
  if (!runtimeSessionId) throw new EngineError("company_work_invalid", "Agent runtime session identifier is required.");
  if (continuation == null || !["string", "object"].includes(typeof continuation)) throw new EngineError("company_work_invalid", "Server-only Agent continuation material is required.");
  if (existing && (existing.protocolId !== protocolId || existing.runtimeSessionId !== runtimeSessionId)) throw new EngineError("company_work_session_conflict", "A conversation cannot be rebound to another Agent protocol session.");
  return { protocolId, runtimeSessionId, cursor: cursor(session?.cursor ?? session?.streamIndex, existing?.cursor ?? 0), continuation: structuredClone(continuation), lastEventId: optional(session?.lastEventId) ?? existing?.lastEventId ?? null, turnId: optional(session?.turnId) ?? existing?.turnId ?? null };
}
export function attachCompanyWorkSession(run, session, { at = new Date().toISOString() } = {}) { return { ...run, session: normalizeRuntimeAssociation(session, run.session), updatedAt: at }; }

export function recordCompanyWorkEvent(run, event, { at = new Date().toISOString() } = {}) {
  const normalized = normalizeEvent(event, at); if (run.events.some(item => item.id === normalized.id)) return run;
  const session = run.session ? { ...run.session, cursor: cursor(event.cursor ?? event.streamIndex, run.session.cursor), lastEventId: normalized.id, turnId: optional(event.turnId) ?? run.session.turnId, continuation: event.continuation !== undefined ? structuredClone(event.continuation) : (event.continuationToken !== undefined ? event.continuationToken : run.session.continuation) } : null;
  return { ...run, session, events: [...run.events, normalized], updatedAt: normalized.at };
}
export function associateCompanyWork(run, associations = {}, { at = new Date().toISOString() } = {}) { const next = { ...run.associations }; for (const field of ["operationIds", "planIds", "proposalIds", "providerActionIds", "evidenceIds", "outcomeIds"]) next[field] = unique([...(next[field] ?? []), ...strings(associations[field])]); return { ...run, associations: next, updatedAt: at }; }
export function markCompanyWorkMutating(run, activeRuns, { at = new Date().toISOString() } = {}) { const conflict = activeRuns.find(item => item.id !== run.id && item.mode === "mutation" && !COMPANY_WORK_TERMINAL_STATES.has(item.status)); if (conflict) throw new EngineError("company_work_conflict", `Mutating company work is already active: ${conflict.id}`, { activeWorkRunId: conflict.id }); return run.mode === "mutation" ? run : { ...run, mode: "mutation", updatedAt: at, events: [...run.events, { id: `${run.id}:mutation`, type: "company_work_mutation_identified", at }] }; }

export function continuationEventFor(run, fact, at = new Date().toISOString()) { const canonical = validateGovernanceFact(fact); if (!run.await || !matches(run.await, canonical)) return null; const digest = createHash("sha256").update(JSON.stringify({ companyId: run.companyId, segmentId: run.id, await: run.await, fact: canonical })).digest("hex"); return { id: `work_continuation_${digest.slice(0, 32)}`, companyId: run.companyId, conversationId: run.conversationId, workSegmentId: run.id, protocolId: run.session?.protocolId ?? null, runtimeSessionId: run.session?.runtimeSessionId ?? null, cursor: run.session?.cursor ?? 0, fact: canonical, status: "pending", createdAt: at, claimedAt: null, claimExpiresAt: null, claimedBy: null, completedAt: null, outcome: null }; }

export function projectCompanyWorkRun(source) { const run = migrateCompanyWorkState({ runs: [source] }, source.companyId).runs[0], session = run.session ? { protocolId: run.session.protocolId, runtimeSessionId: run.session.runtimeSessionId, cursor: run.session.cursor, lastEventId: run.session.lastEventId, turnId: run.session.turnId, ...(run.session.protocolId === EVE_COMPATIBILITY_PROTOCOL ? { id: run.session.runtimeSessionId, streamIndex: run.session.cursor } : {}) } : null; return { id: run.id, segmentId: run.segmentId, conversationId: run.conversationId, companyId: run.companyId, actorId: run.actorId, initiatedBy: run.initiatedBy, intent: run.intent, mode: run.mode, status: run.status, desiredRevisionAtStart: run.desiredRevisionAtStart, observedRevisionAtStart: run.observedRevisionAtStart, session, await: structuredClone(run.await), associations: structuredClone(run.associations), events: structuredClone(run.events), createdAt: run.createdAt, updatedAt: run.updatedAt, completedAt: run.completedAt }; }
export function runtimeCompanyWorkRun(source) { const run = structuredClone(source); if (run.session?.protocolId === EVE_COMPATIBILITY_PROTOCOL) run.session = { ...run.session, id: run.session.runtimeSessionId, streamIndex: run.session.cursor, continuationToken: run.session.continuation }; return run; }
export function projectContinuationEvent(event) { return structuredClone(event); }
export function resolveStewardActorId(declaration) { const realisation = (declaration.spec.realisations ?? []).find(item => item.id === declaration.spec.stewardship?.realisation), agents = new Set((declaration.spec.resources?.agents ?? []).map(item => item.id)); return realisation?.participants?.find(item => agents.has(item.resource))?.resource ?? null; }

function normalizeAwait(value, status) { if (!value) return null; return { type: required(value.type, "Awaited fact type"), reference: value.reference && typeof value.reference === "object" ? structuredClone(value.reference) : {}, status: status ?? null }; }
function migrateLegacySession(session) {
  if (!session || session.protocolId != null) return session ?? null;
  const runtimeSessionId = optional(session.id);
  if (!runtimeSessionId) return null;
  return { protocolId: EVE_COMPATIBILITY_PROTOCOL, runtimeSessionId, cursor: session.streamIndex ?? 0, continuation: session.continuationToken ?? null, lastEventId: session.lastEventId ?? null, turnId: session.turnId ?? null };
}
function matches(awaited, fact) { return awaited.type === fact.type && Object.entries(awaited.reference ?? {}).every(([key, value]) => JSON.stringify(fact[key]) === JSON.stringify(value)); }
function validateGovernanceFact(fact) {
  if (!fact || typeof fact !== "object" || Array.isArray(fact)) throw invalidFact("A governance continuation fact must be an object.");
  const value = structuredClone(fact), id = field => requiredFactString(value[field], field), digest = field => {
    const result = id(field); if (!/^[0-9a-f]{64}$/i.test(result)) throw invalidFact(`${field} must be a content digest.`); return result.toLowerCase();
  }, revision = field => {
    if (value[field] === null) return null;
    return id(field);
  }, stringArray = field => {
    if (!Array.isArray(value[field]) || value[field].some(item => typeof item !== "string" || !item.trim())) throw invalidFact(`${field} must be an array of identifiers.`);
    return [...new Set(value[field].map(item => item.trim()))];
  };
  switch (value.type) {
    case "company_approval": {
      const plan = value.planId != null, proposal = value.proposalId != null;
      if (plan === proposal) throw invalidFact("An approval fact must identify exactly one plan or proposal.");
      if (plan) return { type: value.type, planId: id("planId"), planHash: digest("planHash"), approvedActionIds: stringArray("approvedActionIds") };
      return { type: value.type, proposalId: id("proposalId"), proposalHash: digest("proposalHash") };
    }
    case "apply": return { type: value.type, planId: id("planId"), planHash: digest("planHash"), appliedActionIds: stringArray("appliedActionIds") };
    case "observation": return { type: value.type, observedRevision: revision("observedRevision") };
    case "desired_revision": return { type: value.type, desiredRevision: revision("desiredRevision") };
    case "merge": return { type: value.type, proposalId: id("proposalId"), proposalHash: digest("proposalHash"), headSha: id("headSha"), mergeCommitSha: id("mergeCommitSha") };
    case "checks": {
      const base = { type: value.type, proposalId: id("proposalId"), proposalHash: digest("proposalHash") };
      if (value.outcome === "denied") return { ...base, expectedHead: id("expectedHead"), actualHead: value.actualHead == null ? null : id("actualHead"), outcome: "denied", reason: id("reason") };
      if (!Array.isArray(value.checks) || value.checks.some(check => !check || typeof check !== "object" || typeof check.status !== "string" || !check.status)) throw invalidFact("checks must contain structured check results.");
      return { ...base, headSha: id("headSha"), observationId: id("observationId"), checks: structuredClone(value.checks) };
    }
    default: throw invalidFact("Governance continuation fact type is unsupported.");
  }
}
function requiredFactString(value, field) { if (typeof value !== "string" || !value.trim()) throw invalidFact(`${field} is required.`); return value.trim(); }
function invalidFact(message) { return new EngineError("company_work_fact_invalid", message); }
function legacyWait(status, associations = {}) { const type = ({ waiting_for_company_approval: "company_approval", waiting_for_checks: "checks", waiting_for_merge: "merge", waiting_for_desired_revision: "desired_revision", waiting_for_apply: "apply", waiting_for_observation: "observation" })[status]; if (!type) return null; const reference = {}; if (associations.planIds?.length === 1) reference.planId = associations.planIds[0]; if (associations.proposalIds?.length === 1) reference.proposalId = associations.proposalIds[0]; return { type, reference, status }; }
function normalizeEvent(event, at) { const id = required(event?.id, "Company work event ID"), type = required(event?.type, "Company work event type"); return { id, type, at: optional(event.at) ?? at, ...(optional(event.summary) ? { summary: String(event.summary).slice(0, 2_000) } : {}), ...(optional(event.operationId) ? { operationId: event.operationId } : {}), ...(optional(event.status) ? { status: event.status } : {}), ...(optional(event.reference) ? { reference: event.reference } : {}) }; }
function required(value, name) { const result = optional(value); if (!result) throw new EngineError("company_work_invalid", `${name} is required.`); return result; }
function optional(value) { return typeof value === "string" && value.trim() ? value.trim() : null; }
function strings(values) { return Array.isArray(values) ? values.map(optional).filter(Boolean) : []; }
function unique(values) { return [...new Set(values)]; }
function cursor(value, fallback) { return Number.isSafeInteger(value) && value >= 0 ? value : fallback; }
