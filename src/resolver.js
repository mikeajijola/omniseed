import { flattenResources, resourceKey } from "./compiler.js";
import { providerGap } from "./provider.js";

export class CapabilityResolver {
  resolveCapability({ capability, currentState, providerRegistry, availableResources = [], providerMap, realisations = [], policy = {}, strategy = "recommended" }) {
    const deployed = new Map((currentState.deployed ?? []).map(item => [resourceKey(item.family, item.id), item]));
    const observed = new Map((currentState.observed ?? []).map(item => [resourceKey(item.family, item.id), item]));
    const declaredRealisations = realisations.filter(item => (capability.realisations ?? []).includes(item.id));
    const declaredParticipants = declaredRealisations.flatMap(item => item.participants.map(participant => participant.resource));
    const explicit = declaredParticipants.length ? new Set(declaredParticipants) : capability.realisation?.resources ? new Set(capability.realisation.resources) : null;
    const allowedResources = availableResources.filter(resource => !explicit || explicit.has(resource.id));
    const coveredRequirements = [];
    const missingRequirements = [];
    const unresolvedRequirements = [];
    const providerGaps = [];
    const candidates = new Map();

    for (const requirement of capability.requires) {
      const healthy = allowedResources.filter(resource => (resource.offers ?? []).includes(requirement.id) && deployed.has(resourceKey(resource.family, resource.id)) && observed.get(resourceKey(resource.family, resource.id))?.status === "healthy");
      if (healthy.length) {
        coveredRequirements.push({ ...requirement, resources: healthy.map(item => item.id) });
        continue;
      }
      missingRequirements.push(requirement);
      const exact = allowedResources.filter(resource => resource.family === requirement.primitiveFamily && (resource.offers ?? []).includes(requirement.id));
      if (exact.length) {
        for (const resource of exact) {
          const desiredProvider = resource.provider ?? providerMap[requirement.primitiveFamily]?.provider;
          if (!desiredProvider) {
            unresolvedRequirements.push(gap(capability, requirement, "missing_provider", `No provider is selected for primitive ${resource.id}.`));
            continue;
          }
          const status = providerRegistry.statusForDesired(requirement.primitiveFamily, desiredProvider);
          if (status.state === "healthy") candidates.set(resourceKey(resource.family, resource.id), resource);
          else {
            const pg = providerGap(requirement.primitiveFamily, desiredProvider, status.state);
            if (!providerGaps.some(item => item.primitiveFamily === pg.primitiveFamily && item.desiredProvider === pg.desiredProvider)) providerGaps.push(pg);
            unresolvedRequirements.push(gap(capability, requirement, "missing_provider", pg.message, { ...pg, resourceId: resource.id }));
          }
        }
        continue;
      }
      const desiredProvider = providerMap[requirement.primitiveFamily]?.provider;
      if (!desiredProvider) {
        unresolvedRequirements.push(gap(capability, requirement, "missing_provider", "No provider is selected for this primitive family."));
        continue;
      }
      const status = providerRegistry.statusForDesired(requirement.primitiveFamily, desiredProvider);
      if (status.state !== "healthy") {
        const pg = providerGap(requirement.primitiveFamily, desiredProvider, status.state);
        if (!providerGaps.some(item => item.primitiveFamily === pg.primitiveFamily && item.desiredProvider === pg.desiredProvider)) providerGaps.push(pg);
        unresolvedRequirements.push(gap(capability, requirement, "missing_provider", pg.message, pg));
        continue;
      }
      const provider = providerRegistry.get(desiredProvider);
      const offering = provider.metadata.offerings.find(item => item.family === requirement.primitiveFamily && item.id === requirement.id);
      if (offering?.resource) candidates.set(resourceKey(offering.resource.family, offering.resource.id), offering.resource);
      else unresolvedRequirements.push(gap(capability, requirement, "missing_implementation", "The provider does not offer a realisation for this requirement."));
    }
    // Providers may advertise a composition resource for the capability itself
    // (for example, a Support Workflow) in addition to requirement offerings.
    for (const [family, selection] of Object.entries(providerMap)) {
      const status = providerRegistry.statusForDesired(family, selection.provider);
      if (status.state !== "healthy") continue;
      const provider = providerRegistry.get(selection.provider);
      provider.metadata.offerings.filter(item => item.family === family && item.id === capability.id && item.resource).forEach(item => {
        candidates.set(resourceKey(item.resource.family, item.resource.id), item.resource);
      });
    }
    const resources = [...candidates.values()];
    const candidateRealisations = resources.length ? [{ id: `${capability.id}_${strategy}`, strategy, resources }] : [];
    return { capabilityId: capability.id, coveredRequirements, missingRequirements, candidateRealisations, recommendedRealisation: candidateRealisations[0] ?? null, unresolvedRequirements, providerGaps, policy };
  }

  resolveCompany({ declaration, currentState, providerRegistry, policy, strategy }) {
    const availableResources = [...new Map([
      ...flattenResources(declaration.spec.resources),
      ...(currentState.deployed ?? []).map(item => item.desired ?? item)
    ].map(resource => [resourceKey(resource.family, resource.id), resource])).values()];
    return declaration.spec.capabilities.map(capability => this.resolveCapability({ capability, currentState, providerRegistry, availableResources, providerMap: declaration.spec.providers, realisations: declaration.spec.realisations ?? [], policy, strategy }));
  }
}

function gap(capability, requirement, cause, message, provider = null) {
  return { type: "capability_gap", capabilityId: capability.id, capability: capability.name, requirementId: requirement.id, primitiveFamily: requirement.primitiveFamily, cause, message, provider };
}
