import { createHash } from "node:crypto";
import { assertOmniform, canonicalize } from "@omniseed/omniform";
import { definitionHash } from "./planner.js";
import { EngineError } from "./operations.js";

const supportedOperations = new Set(["add", "remove", "replace"]);
const forbiddenSegments = new Set(["__proto__", "prototype", "constructor"]);

export function createCompanyChangeProposal({ declaration, request, actor, evidence, createdAt = new Date().toISOString() }) {
  const patch = normalizePatch(request.patch);
  const candidate = applyDefinitionPatch(declaration, patch);
  const baseDefinitionHash = definitionHash(declaration);
  const proposedDefinitionHash = definitionHash(candidate);
  const evidenceReferences = normalizeEvidenceReferences(request.evidence, evidence);
  const targets = summarizeTargets(patch);
  const immutable = canonicalize({
    companyId: declaration.metadata.id,
    proposedBy: { actorId: actor.actorId, ...(actor.actorType ? { actorType: actor.actorType } : {}) },
    createdAt,
    baseDefinitionHash,
    proposedDefinitionHash,
    reason: requiredText(request.reason, "reason"),
    evidence: evidenceReferences,
    targets,
    patch,
    alternatives: request.alternatives ?? [],
    assumptions: request.assumptions ?? [],
    risks: request.risks ?? [],
    requiredAuthority: normalizeRequiredAuthority(request.requiredAuthority)
  });
  const hash = hashValue(immutable);
  return { id: `ccp_${hash.slice(0, 16)}`, status: "proposed", hash, ...immutable };
}

export function verifyCompanyChangeProposal(proposal) {
  return proposal?.hash === hashValue(proposalImmutable(proposal));
}

export function applyDefinitionPatch(declaration, patch) {
  const result = structuredClone(declaration);
  for (const change of normalizePatch(patch)) applyOperation(result, change);
  const candidate = canonicalize(result);
  validateCandidate(candidate);
  return candidate;
}

export function previewCompanyChange({ declaration, proposal, compile }) {
  if (!verifyCompanyChangeProposal(proposal)) throw new EngineError("company_change_tampered", "Proposal differs from the persisted exact change");
  if (definitionHash(declaration) !== proposal.baseDefinitionHash) throw new EngineError("company_change_stale", "Company definition changed after the proposal was created", { expected: proposal.baseDefinitionHash, actual: definitionHash(declaration) });
  const candidate = applyDefinitionPatch(declaration, proposal.patch);
  if (definitionHash(candidate) !== proposal.proposedDefinitionHash) throw new EngineError("company_change_tampered", "Previewed result differs from the persisted exact change");
  const validation = validateCandidate(candidate);
  const current = compile(declaration), proposed = compile(candidate);
  return {
    proposalId: proposal.id,
    currentDefinitionHash: definitionHash(declaration),
    proposedDefinitionHash: definitionHash(candidate),
    validation,
    impact: compareRegistries(current, proposed),
    candidateDefinition: candidate
  };
}

function normalizePatch(patch) {
  if (!Array.isArray(patch) || patch.length === 0) throw invalid("patch must be a non-empty array");
  return patch.map((change, index) => {
    if (!change || typeof change !== "object" || !supportedOperations.has(change.op)) throw invalid(`patch[${index}].op must be add, remove, or replace`);
    if (typeof change.path !== "string" || !change.path.startsWith("/")) throw invalid(`patch[${index}].path must be a JSON Pointer`);
    if ((change.op === "add" || change.op === "replace") && !("value" in change)) throw invalid(`patch[${index}].value is required`);
    return canonicalize({ op: change.op, path: change.path, ...("value" in change ? { value: change.value } : {}) });
  });
}

function applyOperation(document, change) {
  const segments = change.path.split("/").slice(1).map(decodePointer);
  if (!segments.length) throw invalid("the document root cannot be replaced in Generation 1");
  let parent = document;
  for (const segment of segments.slice(0, -1)) {
    if (forbiddenSegments.has(segment) || parent === null || typeof parent !== "object" || !(segment in parent)) throw invalid(`path does not exist: ${change.path}`);
    parent = parent[segment];
  }
  const key = segments.at(-1);
  if (forbiddenSegments.has(key) || parent === null || typeof parent !== "object") throw invalid(`path does not exist: ${change.path}`);
  if (Array.isArray(parent)) return applyArrayOperation(parent, key, change);
  const exists = Object.hasOwn(parent, key);
  if (change.op === "remove") {
    if (!exists) throw invalid(`remove path does not exist: ${change.path}`);
    delete parent[key];
  } else if (change.op === "replace") {
    if (!exists) throw invalid(`replace path does not exist: ${change.path}`);
    parent[key] = structuredClone(change.value);
  } else parent[key] = structuredClone(change.value);
}

function applyArrayOperation(parent, key, change) {
  if (key === "-") {
    if (change.op !== "add") throw invalid(`only add supports the '-' array position: ${change.path}`);
    parent.push(structuredClone(change.value)); return;
  }
  if (!/^(0|[1-9][0-9]*)$/.test(key)) throw invalid(`invalid array index: ${change.path}`);
  const index = Number(key);
  if (change.op === "add") {
    if (index > parent.length) throw invalid(`add index is outside the array: ${change.path}`);
    parent.splice(index, 0, structuredClone(change.value));
  } else {
    if (index >= parent.length) throw invalid(`${change.op} index is outside the array: ${change.path}`);
    if (change.op === "remove") parent.splice(index, 1); else parent[index] = structuredClone(change.value);
  }
}

function decodePointer(segment) {
  if (/~(?![01])/.test(segment)) throw invalid("invalid JSON Pointer escape");
  return segment.replace(/~1/g, "/").replace(/~0/g, "~");
}

function validateCandidate(candidate) {
  try { assertOmniform(candidate); return { valid: true, issues: [] }; }
  catch (error) { throw new EngineError("company_change_invalid", "Proposed mutation does not produce valid Omniform", { validation: error.issues ?? [{ message: error.message }] }); }
}

function normalizeEvidenceReferences(references = [], evidence = []) {
  if (!Array.isArray(references)) throw invalid("evidence must be an array of evidence IDs");
  const available = new Set(evidence.map(item => item.id ?? item.evidenceId).filter(Boolean));
  const missing = references.filter(reference => typeof reference !== "string" || !available.has(reference));
  if (missing.length) throw new EngineError("evidence_not_found", `Evidence references do not resolve: ${missing.join(", ")}`, { missing });
  return [...new Set(references)].sort().map(id => ({ id }));
}

function normalizeRequiredAuthority(authority) {
  if (authority !== undefined && (!authority || typeof authority !== "object" || Array.isArray(authority))) throw invalid("requiredAuthority must contain approve and apply permission arrays");
  const normalize = (value, baseline, field) => {
    if (value !== undefined && (!Array.isArray(value) || value.some(permission => typeof permission !== "string" || !permission.trim()))) throw invalid(`requiredAuthority.${field} must be an array of permission strings`);
    return [...new Set([baseline, ...(value ?? [])])].sort();
  };
  return { approve: normalize(authority?.approve, "company_change.approve", "approve"), apply: normalize(authority?.apply, "company_change.apply", "apply") };
}

function proposalImmutable(proposal) {
  const keys = ["companyId", "proposedBy", "createdAt", "baseDefinitionHash", "proposedDefinitionHash", "reason", "evidence", "targets", "patch", "alternatives", "assumptions", "risks", "requiredAuthority"];
  return canonicalize(Object.fromEntries(keys.map(key => [key, proposal?.[key]])));
}

function summarizeTargets(patch) {
  return [...new Set(patch.map(item => item.path.split("/").slice(0, 4).join("/") || "/"))].sort().map(path => ({ path }));
}

function compareRegistries(current, proposed) {
  return {
    capabilities: compareById(current.capabilities, proposed.capabilities),
    resources: compareById(current.resources, proposed.resources, item => `${item.family}:${item.id}`),
    operations: compareById(current.operations, proposed.operations),
    newlyUnmetCapabilities: proposed.capabilities.filter(item => item.state !== "realised" && !current.capabilities.some(existing => existing.id === item.id && existing.state !== "realised")).map(item => item.id).sort(),
    realisedCapabilitiesAffected: current.capabilities.filter(item => item.state === "realised" && proposed.capabilities.find(candidate => candidate.id === item.id)?.state !== "realised").map(item => item.id).sort()
  };
}

function compareById(before = [], after = [], identity = item => item.id) {
  const left = new Map(before.map(item => [identity(item), item])), right = new Map(after.map(item => [identity(item), item]));
  return {
    added: [...right.keys()].filter(id => !left.has(id)).sort(),
    changed: [...right.keys()].filter(id => left.has(id) && JSON.stringify(canonicalize(left.get(id))) !== JSON.stringify(canonicalize(right.get(id)))).sort(),
    removed: [...left.keys()].filter(id => !right.has(id)).sort()
  };
}

const requiredText = (value, field) => { if (typeof value !== "string" || !value.trim()) throw invalid(`${field} is required`); return value.trim(); };
const hashValue = value => createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
const invalid = message => new EngineError("company_change_invalid", message);
