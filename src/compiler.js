import { assertOmniform, primitiveFamilies } from "@omniseed/omniform";

export function compileCompany(declaration, runtimeState = emptyRuntimeState(declaration?.metadata?.id)) {
  assertOmniform(declaration);
  const resources = flattenResources(declaration.spec.resources);
  const deployed = new Map((runtimeState.deployed ?? []).map(item => [resourceKey(item.family, item.id), item]));
  const observed = new Map((runtimeState.observed ?? []).map(item => [resourceKey(item.family, item.id), item]));

  const compiledResources = resources.map(resource => {
    const key = resourceKey(resource.family, resource.id);
    return { ...resource, provider: declaration.spec.providers[resource.family]?.provider ?? null, deployed: deployed.get(key) ?? null, observed: observed.get(key) ?? null };
  });

  const capabilities = declaration.spec.capabilities.map(capability => {
    const allowed = capability.realisation?.resources ? new Set(capability.realisation.resources) : null;
    const candidates = compiledResources.filter(resource => !allowed || allowed.has(resource.id));
    const requirements = capability.requires.map(requirement => {
      const covering = candidates.filter(resource => (resource.offers ?? []).includes(requirement.id));
      const healthy = covering.filter(resource => resource.deployed && resource.observed?.status === "healthy");
      return { ...requirement, covered: healthy.length > 0, resources: covering.map(resource => resource.id), evidence: healthy.flatMap(resource => resource.observed.evidence ?? []) };
    });
    return { ...capability, requirements, state: capabilityState(requirements, candidates) };
  });

  return {
    apiVersion: "omniseed.dev/registry/v1alpha1",
    company: declaration.metadata,
    generatedAt: new Date().toISOString(),
    providers: primitiveFamilies.map(family => ({ family, provider: declaration.spec.providers[family]?.provider ?? null })).filter(item => item.provider),
    capabilities,
    resources: compiledResources,
    operations: buildOperations(capabilities)
  };
}

export function emptyRuntimeState(companyId = null) {
  return { version: 0, companyId, deployed: [], observed: [], evidence: [], history: [] };
}

export function flattenResources(grouped = {}) {
  return Object.entries(grouped).flatMap(([family, resources]) => resources.map(resource => ({ family, ...resource })));
}

export const resourceKey = (family, id) => `${family}:${id}`;

function capabilityState(requirements, candidates) {
  if (requirements.every(item => item.covered)) return "realised";
  if (requirements.some(item => item.covered)) return "partial";
  if (candidates.some(item => item.deployed)) return "degraded";
  return "missing";
}

function buildOperations(capabilities) {
  return capabilities.flatMap(capability => [
    { id: `inspect_${capability.id}`, capability: capability.id, action: "inspect", available: true, approval: "none" },
    { id: `realise_${capability.id}`, capability: capability.id, action: "plan", available: capability.state !== "realised", approval: "policy" }
  ]);
}
