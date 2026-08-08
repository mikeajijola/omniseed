import { createHash } from "node:crypto";
import { flattenResources, resourceKey } from "./compiler.js";

export function createPlan(declaration, runtimeState) {
  const deployedKeys = new Set((runtimeState.deployed ?? []).map(item => resourceKey(item.family, item.id)));
  const actions = flattenResources(declaration.spec.resources).filter(resource => !deployedKeys.has(resourceKey(resource.family, resource.id))).map(resource => ({
    action: "create",
    family: resource.family,
    resourceId: resource.id,
    provider: declaration.spec.providers[resource.family]?.provider ?? null,
    desired: resource,
    risk: resource.risk ?? "low"
  }));
  const offered = new Set(flattenResources(declaration.spec.resources).flatMap(resource => resource.offers ?? []));
  const gaps = declaration.spec.capabilities.flatMap(capability => capability.requires.filter(requirement => !offered.has(requirement.id)).map(requirement => ({ capabilityId: capability.id, requirementId: requirement.id, reason: "no desired resource offers this requirement" })));
  const content = JSON.stringify({ companyId: declaration.metadata.id, baseVersion: runtimeState.version, actions, gaps });
  return {
    id: createHash("sha256").update(content).digest("hex").slice(0, 16),
    companyId: declaration.metadata.id,
    baseVersion: runtimeState.version,
    createdAt: new Date().toISOString(),
    actions,
    gaps,
    approvalRequired: actions.length > 0,
    status: actions.length ? "pending" : "empty"
  };
}
