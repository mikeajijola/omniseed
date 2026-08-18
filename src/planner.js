import { createHash } from "node:crypto";
import { flattenResources, providerIdForResource, resourceKey } from "./compiler.js";

export function definitionHash(declaration) { return hash(stable(declaration)); }

export function createPlan(declaration, runtimeState, resolutions) {
  const deployedKeys = new Set((runtimeState.deployed ?? []).map(item => resourceKey(item.family, item.id)));
  const explicit = flattenResources(declaration.spec.resources);
  const resolved = resolutions.flatMap(item => item.recommendedRealisation?.resources ?? []);
  const desired = new Map([...explicit, ...resolved].map(resource => [resourceKey(resource.family, resource.id), resource]));
  const actions = [...desired.values()].filter(resource => !deployedKeys.has(resourceKey(resource.family, resource.id))).map(resource => {
    const base = { action: "create", family: resource.family, resourceId: resource.id, provider: providerIdForResource(declaration, resource), desired: resource, risk: resource.risk ?? "low" };
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
