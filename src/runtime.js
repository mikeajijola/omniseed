import { OmniSeed } from "./engine.js";
import { connectStdioProvider } from "./provider-protocol.js";
import { ProviderRegistry } from "./provider.js";
import { flattenResources, providerIdForResource } from "./compiler.js";
import { ProviderImplementationCatalog, activateProviderImplementation } from "./provider-discovery.js";
import enginePackage from "../package.json" with { type: "json" };

/**
 * Assemble one replaceable Engine runtime from approved Omniform plus ordinary
 * runtime configuration. Missing Providers remain gaps; none are fabricated.
 */
export async function assembleRuntime({ declaration, store, providerHandles = [], protocolProviders = [], providerImplementations = [], providerConfiguration = {}, engineVersion = enginePackage.version, binding = {}, companyRepository = null, onDiagnostic } = {}) {
  if (!declaration?.metadata?.id || !store) throw new Error("Runtime assembly requires an approved company declaration and state store.");
  const registry = new ProviderRegistry();
  for (const provider of providerHandles) registry.register(provider);
  const connected = [];
  const assemblyDiagnostics = [];
  try {
    for (const configured of protocolProviders) {
      const desiredResources = desiredResourcesForProvider(declaration, configured.id);
      const handle = await connectStdioProvider({
        command: configured.command,
        args: configured.args ?? [],
        expectedProviderId: configured.id,
        configuration: configured.configuration ?? {},
        context: {
          ...(configured.context ?? {}),
          companyId: declaration.metadata.id,
          desiredResources
        },
        startupTimeoutMs: configured.startupTimeoutMs,
        requestTimeoutMs: configured.requestTimeoutMs,
        onDiagnostic
      });
      registry.register(handle);
      connected.push(handle);
    }
    const catalog = providerImplementations instanceof ProviderImplementationCatalog ? providerImplementations : new ProviderImplementationCatalog(providerImplementations);
    for (const selection of selectedProviders(declaration)) {
      if (registry.get(selection.providerId)) continue;
      let claim;
      try {
        claim = catalog.resolve(selection.providerId, selection.families, engineVersion);
      } catch (error) {
        const diagnostic = failedDiagnostic(selection, error);
        assemblyDiagnostics.push(diagnostic); onDiagnostic?.(structuredClone(diagnostic)); continue;
      }
      try {
        const activated = await activateProviderImplementation({
          claim, providerId: selection.providerId, families: selection.families,
          configuration: providerConfiguration[selection.providerId] ?? {},
          context: { companyId: declaration.metadata.id, desiredResources: desiredResourcesForProvider(declaration, selection.providerId) },
          onEvidence: evidence => onDiagnostic?.({ type: "provider_assembly_evidence", ...evidence })
        });
        registry.register(activated.handle); connected.push(activated.handle);
        const registrationEvidence = { stage: "register", state: "succeeded", providerId: selection.providerId, implementationVersion: claim.manifest.version, families: [...selection.families] };
        activated.evidence.push(registrationEvidence); onDiagnostic?.({ type: "provider_assembly_evidence", ...registrationEvidence });
        const diagnostic = { providerId: selection.providerId, families: selection.families, state: "healthy", implementation: implementationProjection(claim.manifest, activated.handle), lifecycle: lifecycleProjection(activated.evidence), evidence: activated.evidence };
        assemblyDiagnostics.push(diagnostic); onDiagnostic?.(structuredClone(diagnostic));
      } catch (error) {
        const diagnostic = failedDiagnostic(selection, error, claim.manifest);
        assemblyDiagnostics.push(diagnostic); onDiagnostic?.(structuredClone(diagnostic));
      }
    }
  } catch (error) {
    await Promise.allSettled(connected.map(provider => provider.shutdown()));
    throw error;
  }
  const engine = new OmniSeed({ store, providers: registry, binding, companyRepository });
  return {
    engine,
    providers: registry,
    desiredProviderBindings: desiredProviderBindings(declaration),
    assemblyDiagnostics,
    close: async () => Promise.allSettled(registry.list().map(provider => provider.shutdown()))
  };
}

function selectedProviders(declaration) {
  const grouped = new Map();
  for (const binding of desiredProviderBindings(declaration)) {
    if (!binding.providerId) continue;
    const families = grouped.get(binding.providerId) ?? new Set(); families.add(binding.family); grouped.set(binding.providerId, families);
  }
  return [...grouped].sort(([left], [right]) => left.localeCompare(right)).map(([providerId, families]) => ({ providerId, families: [...families].sort() }));
}
function failedDiagnostic(selection, error, manifest) {
  const evidence = error.evidence ?? [{ stage: "discovery", state: "failed", providerId: selection.providerId, families: selection.families, reason: { code: error.code ?? "provider_discovery_failed", message: error.message, details: error.details ?? {} } }];
  return { providerId: selection.providerId, families: selection.families, state: stateForFailure(error.code), implementation: manifest ? { id: manifest.id, version: manifest.version, organisation: manifest.organisation, families: manifest.primitiveFamilies } : null, lifecycle: lifecycleProjection(evidence), failure: { code: error.code ?? "provider_discovery_failed", message: error.message, details: error.details ?? {} }, evidence };
}
function stateForFailure(code = "") { return code === "provider_implementation_unavailable" ? "implementation_unavailable" : code.includes("incompatible") || code.includes("mismatch") || code.includes("manifest") || code.includes("ambiguous") ? "incompatible" : code.includes("configuration") ? "configuration_failed" : code.includes("connection") ? "connection_failed" : code.includes("unhealthy") || code.includes("health") ? "unhealthy" : "load_failed"; }
function implementationProjection(manifest, handle) { return { id: manifest.id, version: manifest.version, organisation: manifest.organisation, families: [...handle.metadata.families], kind: handle.kind }; }
function lifecycleProjection(evidence) { return Object.fromEntries(evidence.map(item => [item.stage, item.state])); }

/**
 * Return only the approved desired resources selected for one Provider.
 *
 * A Provider may implement several primitive-family contracts and may need to
 * reconcile shared implementation resources across those contracts. Supplying
 * this company-scoped subset avoids hidden Provider configuration while
 * preventing access to desired resources owned by another Provider.
 */
export function desiredResourcesForProvider(declaration, providerId) {
  return flattenResources(declaration.spec.resources)
    .filter(resource => providerIdForResource(declaration, resource) === providerId)
    .map(resource => structuredClone(resource));
}

export function desiredProviderBindings(declaration) {
  const defaults = Object.entries(declaration.spec.providers ?? {}).map(([family, selection]) => ({ family, providerId: selection.provider, scope: "family", resourceId: null }));
  const resources = flattenResources(declaration.spec.resources).filter(resource => resource.provider).map(resource => ({
    family: resource.family,
    providerId: providerIdForResource(declaration, resource),
    scope: "resource",
    resourceId: resource.id
  }));
  return [...defaults, ...resources];
}
