import { createHash } from "node:crypto";

const REDACTED = "[REDACTED]";
const SENSITIVE_KEY = /authorization|credential|password|privatekey|secret|token|apikey/;

/** Build the deterministic, consumer-safe current-state projection owned by Engine. */
export function createCompanySnapshot(registry) {
  const resources = [...(registry.resources ?? [])]
    .map(resource => ({
      family: resource.family,
      id: resource.id,
      provider: resource.provider ?? null,
      deployed: resource.deployed ? redact(resource.deployed) : null,
      observation: resource.observed
        ? { ...redact(resource.observed), state: "observed" }
        : { state: "missing", status: null, checkedAt: null, evidence: [] }
    }))
    .sort((left, right) => `${left.family}/${left.id}`.localeCompare(`${right.family}/${right.id}`));
  const body = {
    apiVersion: "omniseed.dev/company-snapshot/v1alpha1",
    companyId: registry.instance.companyId,
    definitionHash: registry.definitionHash,
    stateVersion: registry.instance.observedStateRevision,
    desiredRevision: registry.instance.desiredRevision ?? null,
    observedRevision: registry.instance.observedRevision ?? null,
    capabilities: [...(registry.capabilities ?? [])].map(item => ({ id: item.id, state: item.state })).sort(byId),
    resources
  };
  return { ...body, revision: snapshotRevision(body) };
}

/** Tell a cache how to consume an authoritative Engine snapshot without accepting consumer state as truth. */
export function compareCompanySnapshot(current, authoritative) {
  if (!current) return { outcome: "create", snapshot: structuredClone(authoritative) };
  const supplied = current.revision;
  if (current.companyId !== authoritative.companyId || !validRevision(supplied)) return stale(authoritative);
  if (supplied === authoritative.revision) return { outcome: "no-op", snapshot: structuredClone(authoritative) };
  if (!Number.isInteger(current.stateVersion) || current.stateVersion >= authoritative.stateVersion) return stale(authoritative);
  return { outcome: "update", snapshot: structuredClone(authoritative) };
}

export function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, SENSITIVE_KEY.test(key.toLowerCase().replace(/[^a-z0-9]/g, "")) ? REDACTED : redact(item)]));
}

function snapshotRevision(body) {
  return `sha256:${createHash("sha256").update(stable(body)).digest("hex")}`;
}
function validRevision(value) { return typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value); }
function stale(authoritative) { return { outcome: "stale", snapshot: structuredClone(authoritative) }; }
function byId(left, right) { return left.id.localeCompare(right.id); }
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
