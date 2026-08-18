import { OmniSeed } from "./engine.js";
import { connectStdioProvider } from "./provider-protocol.js";
import { ProviderRegistry } from "./provider.js";
import { flattenResources, providerIdForResource } from "./compiler.js";

/**
 * Assemble one replaceable Engine runtime from approved Omniform plus ordinary
 * runtime configuration. Missing Providers remain gaps; none are fabricated.
 */
export async function assembleRuntime({ declaration, store, providerHandles = [], protocolProviders = [], binding = {}, companyRepository = null, onDiagnostic } = {}) {
  if (!declaration?.metadata?.id || !store) throw new Error("Runtime assembly requires an approved company declaration and state store.");
  const registry = new ProviderRegistry();
  for (const provider of providerHandles) registry.register(provider);
  const connected = [];
  try {
    for (const configured of protocolProviders) {
      const handle = await connectStdioProvider({
        command: configured.command,
        args: configured.args ?? [],
        expectedProviderId: configured.id,
        configuration: configured.configuration ?? {},
        context: { companyId: declaration.metadata.id, ...(configured.context ?? {}) },
        startupTimeoutMs: configured.startupTimeoutMs,
        requestTimeoutMs: configured.requestTimeoutMs,
        onDiagnostic
      });
      registry.register(handle);
      connected.push(handle);
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
    close: async () => Promise.allSettled(registry.list().map(provider => provider.shutdown()))
  };
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
