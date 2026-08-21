import { createHash } from "node:crypto";
import { flattenResources, providerIdForResource, resourceKey } from "./compiler.js";

export function definitionHash(declaration) { return hash(stable(declaration)); }

export function createPlan(declaration, runtimeState, resolutions) {
  const deployed = new Map((runtimeState.deployed ?? []).map(item => [resourceKey(item.family, item.id), item]));
  const explicit = flattenResources(declaration.spec.resources);
  const resolved = resolutions.flatMap(item => item.recommendedRealisation?.resources ?? []);
  const desired = new Map([...explicit, ...resolved].map(resource => [resourceKey(resource.family, resource.id), resource]));
  const actions = [...desired.values()].flatMap(resource => {
    const existing = deployed.get(resourceKey(resource.family, resource.id));
    const provider = providerIdForResource(declaration, resource);
    const action = !existing ? "create" : stable(existing.desired) !== stable(resource) || existing.provider !== provider ? "update" : null;
    if (!action) return [];
    const base = { action, family: resource.family, resourceId: resource.id, provider, desired: resource, risk: resource.risk ?? "low" };
    return { id: `action_${hash(stable(base)).slice(0, 12)}`, ...base };
  });
  const gaps = resolutions.flatMap(item => item.unresolvedRequirements);
  const providerGaps = resolutions.flatMap(item => item.providerGaps).filter((item, index, all) => all.findIndex(other => other.primitiveFamily === item.primitiveFamily && other.desiredProvider === item.desiredProvider) === index);
  const body = { companyId: declaration.metadata.id, definitionHash: definitionHash(declaration), stateVersion: runtimeState.version + 1, actions, gaps, providerGaps };
  const planHash = hash(stable(body));
  return { id: `plan_${planHash.slice(0, 16)}`, hash: planHash, ...body, createdAt: new Date().toISOString(), approvalRequired: actions.length > 0, status: actions.length ? "pending" : "empty" };
}

export function verifyPlanHash(plan) {
  const { id, hash: existing, createdAt, approvalRequired, status, ...body } = plan;
  return existing === hash(stable(body));
}

const hash = value => createHash("sha256").update(value).digest("hex");
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
