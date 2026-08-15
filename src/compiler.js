import { assertOmniform, primitiveFamilies } from "@omniseed/omniform";

export function compileCompany(declaration, runtimeState = emptyRuntimeState(declaration?.metadata?.id), { providerRegistry, resolutions = [], operationRegistry, binding = {} } = {}) {
  assertOmniform(declaration);
  const deployed = new Map((runtimeState.deployed ?? []).map(item => [resourceKey(item.family, item.id), item]));
  const observed = new Map((runtimeState.observed ?? []).map(item => [resourceKey(item.family, item.id), item]));
  const desiredResources = new Map(flattenResources(declaration.spec.resources).map(item => [resourceKey(item.family, item.id), item]));
  for (const item of runtimeState.deployed ?? []) if (!desiredResources.has(resourceKey(item.family, item.id))) desiredResources.set(resourceKey(item.family, item.id), item.desired ?? item);
  const resources = [...desiredResources.values()].map(resource => {
    const key = resourceKey(resource.family, resource.id);
    return { ...resource, provider: declaration.spec.providers[resource.family]?.provider ?? null, deployed: deployed.get(key) ?? null, observed: observed.get(key) ?? null };
  });
  const resourceById = new Map(resources.map(resource => [resource.id, resource]));
  const evidenceFor = resource => (runtimeState.evidence ?? []).filter(item => item.family === resource.family && item.resourceId === resource.id);
  const realisations = (declaration.spec.realisations ?? []).map(realisation => {
    const participants = realisation.participants.map(participant => {
      const resource = resourceById.get(participant.resource);
      return { ...participant, family: resource?.family ?? null, provider: resource?.provider ?? null, desired: resource ?? null, deployed: resource?.deployed ?? null, observed: resource?.observed ?? null, evidence: resource ? evidenceFor(resource) : [] };
    });
    const status = participants.every(item => item.observed?.status === "healthy") ? "realised" : participants.some(item => item.deployed || item.observed) ? "partial" : "missing";
    return { ...realisation, status, participants, evidence: participants.flatMap(item => item.evidence) };
  });
  const realisationById = new Map(realisations.map(item => [item.id, item]));
  const byCapability = new Map(resolutions.map(item => [item.capabilityId, item]));
  const capabilities = declaration.spec.capabilities.map(capability => {
    const resolution = byCapability.get(capability.id) ?? { coveredRequirements: [], missingRequirements: capability.requires, unresolvedRequirements: [], providerGaps: [] };
    const covered = new Set(resolution.coveredRequirements.map(item => item.id));
    const requirements = capability.requires.map(item => ({ ...item, covered: covered.has(item.id) }));
    const state = requirements.every(item => item.covered) ? "realised" : requirements.some(item => item.covered) ? "partial" : "missing";
    return { ...capability, requirements, state, resolution, realisations: (capability.realisations ?? []).map(id => realisationById.get(id)).filter(Boolean) };
  });
  const providers = primitiveFamilies.map(family => {
    const id = declaration.spec.providers[family]?.provider;
    return id ? providerRegistry.statusForDesired(family, id) : null;
  }).filter(Boolean);
  const operations = declaration.spec.operations.map(operation => operationRegistry.describe(operation, { providers }));
  const authority = declaration.spec.governance?.desiredState ?? null;
  const instance = { companyId: declaration.metadata.id, companyName: declaration.metadata.name, desiredState: authority, desiredRevision: binding.desiredRevision ?? null, omniformVersion: declaration.apiVersion, observedStateRevision: runtimeState.version, environment: binding.environment ?? "unspecified", deployment: binding.deployment ?? null };
  const stewardship = declaration.spec.stewardship ? { ...declaration.spec.stewardship, capability: capabilities.find(item => item.id === declaration.spec.stewardship.capability) ?? null, realisation: realisationById.get(declaration.spec.stewardship.realisation) ?? null } : null;
  return { apiVersion: "omniseed.dev/registry/v1alpha1", company: declaration.metadata, instance, stewardship, generatedAt: new Date().toISOString(), providers, providerGaps: providers.filter(item => item.state !== "healthy").map(item => ({ type: "provider_unavailable", primitiveFamily: item.family, desiredProvider: item.providerId, state: item.state, message: item.state === "unavailable" ? "No installed provider implementation is available." : `Provider is ${item.state}.` })), capabilities, realisations, resources, operations, observations: runtimeState.observed ?? [], evidence: runtimeState.evidence ?? [], plans: runtimeState.plans ?? [], proposals: runtimeState.companyChanges ?? [], history: runtimeState.history ?? [] };
}

export function emptyRuntimeState(companyId = null) { return { version: 0, companyId, binding: { desiredRevision: null, observedRevision: null }, deployed: [], observed: [], evidence: [], history: [], plans: [], companyChanges: [] }; }
export function flattenResources(grouped = {}) { return Object.entries(grouped ?? {}).flatMap(([family, resources]) => resources.map(resource => ({ family, ...resource }))); }
export const resourceKey = (family, id) => `${family}:${id}`;
