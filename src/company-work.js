import { randomUUID } from "node:crypto";
import { EngineError } from "./operations.js";

export const COMPANY_WORK_TERMINAL_STATES = new Set(["completed", "failed", "blocked", "cancelled"]);
export const COMPANY_WORK_STATES = new Set([
  "queued",
  "running",
  "waiting_for_input",
  "waiting_for_company_approval",
  "waiting_for_checks",
  "observing",
  ...COMPANY_WORK_TERMINAL_STATES,
]);

const TRANSITIONS = {
  queued: new Set(["running", "failed", "blocked", "cancelled"]),
  running: new Set(["waiting_for_input", "waiting_for_company_approval", "waiting_for_checks", "observing", "completed", "failed", "blocked", "cancelled"]),
  waiting_for_input: new Set(["running", "failed", "blocked", "cancelled"]),
  waiting_for_company_approval: new Set(["running", "waiting_for_checks", "failed", "blocked", "cancelled"]),
  waiting_for_checks: new Set(["running", "observing", "failed", "blocked", "cancelled"]),
  observing: new Set(["running", "waiting_for_company_approval", "completed", "failed", "blocked", "cancelled"]),
};

export function createCompanyWorkRun({ declaration, intent, actorId, idempotencyKey = null, desiredRevision = null, observedRevision = null, now = new Date().toISOString(), id = `work_${randomUUID()}` }) {
  const stewardActorId = resolveStewardActorId(declaration);
  if (!stewardActorId) throw new EngineError("company_work_unavailable", "The company has no declared Agent participating in its stewardship realisation.");
  if (actorId !== stewardActorId) throw new EngineError("authorization_denied", "Only the declared steward Agent may own a company work run.");
  const normalizedIntent = String(intent ?? "").trim();
  if (!normalizedIntent) throw new EngineError("company_work_invalid", "Company work requires a non-empty intent.");
  return {
    id,
    companyId: declaration.metadata.id,
    actorId,
    initiatedBy: actorId,
    intent: normalizedIntent,
    idempotencyKey: normalizeOptionalString(idempotencyKey),
    mode: "inspection",
    status: "queued",
    desiredRevisionAtStart: desiredRevision,
    observedRevisionAtStart: observedRevision,
    session: { id: null, continuationToken: null, streamIndex: 0, lastEventId: null, turnId: null },
    associations: { planIds: [], proposalIds: [], providerActionIds: [], evidenceIds: [] },
    events: [{ id: `${id}:created`, type: "company_work_started", at: now, summary: normalizedIntent }],
    createdAt: now,
    updatedAt: now,
    completedAt: null,
  };
}

export function transitionCompanyWorkRun(run, status, { at = new Date().toISOString(), summary = null } = {}) {
  if (!COMPANY_WORK_STATES.has(status)) throw new EngineError("company_work_invalid", `Unsupported company work status: ${status}`);
  if (run.status === status) return { ...run, updatedAt: at };
  if (COMPANY_WORK_TERMINAL_STATES.has(run.status) || !TRANSITIONS[run.status]?.has(status)) {
    throw new EngineError("company_work_invalid_state", `Company work cannot move from ${run.status} to ${status}.`);
  }
  const event = { id: `${run.id}:status:${status}:${run.events.length}`, type: "company_work_status_changed", status, at, ...(summary ? { summary: String(summary) } : {}) };
  return { ...run, status, updatedAt: at, completedAt: COMPANY_WORK_TERMINAL_STATES.has(status) ? at : null, events: [...run.events, event] };
}

export function attachCompanyWorkSession(run, session, { at = new Date().toISOString() } = {}) {
  const id = normalizeRequiredString(session?.id, "Eve session ID");
  const continuationToken = normalizeRequiredString(session?.continuationToken, "Eve continuation token");
  if (run.session.id && run.session.id !== id) throw new EngineError("company_work_session_conflict", "A work run cannot be rebound to another Eve session.");
  return {
    ...run,
    session: { ...run.session, id, continuationToken, streamIndex: integer(session.streamIndex, run.session.streamIndex), turnId: normalizeOptionalString(session.turnId) ?? run.session.turnId },
    updatedAt: at,
  };
}

export function recordCompanyWorkEvent(run, event, { at = new Date().toISOString() } = {}) {
  const normalized = normalizeEvent(event, at);
  if (run.events.some(item => item.id === normalized.id)) return run;
  const session = {
    ...run.session,
    streamIndex: integer(event.streamIndex, run.session.streamIndex),
    lastEventId: normalized.id,
    turnId: normalizeOptionalString(event.turnId) ?? run.session.turnId,
    continuationToken: normalizeOptionalString(event.continuationToken) ?? run.session.continuationToken,
  };
  return { ...run, session, events: [...run.events, normalized], updatedAt: normalized.at };
}

export function associateCompanyWork(run, associations = {}, { at = new Date().toISOString() } = {}) {
  const next = { ...run.associations };
  for (const [field, values] of Object.entries({
    planIds: associations.planIds,
    proposalIds: associations.proposalIds,
    providerActionIds: associations.providerActionIds,
    evidenceIds: associations.evidenceIds,
  })) next[field] = unique([...(next[field] ?? []), ...normalizeStrings(values)]);
  return { ...run, associations: next, updatedAt: at };
}

export function markCompanyWorkMutating(run, activeRuns, { at = new Date().toISOString() } = {}) {
  const conflicting = activeRuns.find(item => item.id !== run.id && item.mode === "mutation" && !COMPANY_WORK_TERMINAL_STATES.has(item.status));
  if (conflicting) throw new EngineError("company_work_conflict", `Mutating company work is already active: ${conflicting.id}`, { activeWorkRunId: conflicting.id });
  return run.mode === "mutation" ? run : { ...run, mode: "mutation", updatedAt: at, events: [...run.events, { id: `${run.id}:mutation`, type: "company_work_mutation_identified", at }] };
}

export function projectCompanyWorkRun(run) {
  return {
    id: run.id,
    companyId: run.companyId,
    actorId: run.actorId,
    initiatedBy: run.initiatedBy,
    intent: run.intent,
    mode: run.mode,
    status: run.status,
    desiredRevisionAtStart: run.desiredRevisionAtStart,
    observedRevisionAtStart: run.observedRevisionAtStart,
    session: { id: run.session.id, streamIndex: run.session.streamIndex, lastEventId: run.session.lastEventId, turnId: run.session.turnId },
    associations: structuredClone(run.associations),
    events: structuredClone(run.events),
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    completedAt: run.completedAt,
  };
}

export function resolveStewardActorId(declaration) {
  const realisationId = declaration.spec.stewardship?.realisation;
  const realisation = (declaration.spec.realisations ?? []).find(item => item.id === realisationId);
  const agentIds = new Set((declaration.spec.resources?.agents ?? []).map(item => item.id));
  return realisation?.participants?.find(item => agentIds.has(item.resource))?.resource ?? null;
}

function normalizeEvent(event, fallbackAt) {
  const id = normalizeRequiredString(event?.id, "Company work event ID");
  const type = normalizeRequiredString(event?.type, "Company work event type");
  return {
    id,
    type,
    at: normalizeOptionalString(event.at) ?? fallbackAt,
    ...(normalizeOptionalString(event.summary) ? { summary: String(event.summary).slice(0, 2_000) } : {}),
    ...(normalizeOptionalString(event.operationId) ? { operationId: event.operationId } : {}),
    ...(normalizeOptionalString(event.status) ? { status: event.status } : {}),
    ...(normalizeOptionalString(event.reference) ? { reference: event.reference } : {}),
  };
}

function normalizeRequiredString(value, name) {
  const normalized = normalizeOptionalString(value);
  if (!normalized) throw new EngineError("company_work_invalid", `${name} is required.`);
  return normalized;
}
function normalizeOptionalString(value) { return typeof value === "string" && value.trim() ? value.trim() : null; }
function normalizeStrings(values) { return Array.isArray(values) ? values.map(normalizeOptionalString).filter(Boolean) : []; }
function unique(values) { return [...new Set(values)]; }
function integer(value, fallback) { return Number.isSafeInteger(value) && value >= 0 ? value : fallback; }
