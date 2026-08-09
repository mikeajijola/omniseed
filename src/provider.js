const providerStates = ["implementation_available", "configured", "connected", "healthy"];

export class ProviderRegistry {
  #providers = new Map();
  register(provider) {
    if (!provider?.metadata?.id) throw new Error("Provider implementation requires metadata.id");
    if (this.#providers.has(provider.metadata.id)) throw new Error(`Provider already registered: ${provider.metadata.id}`);
    this.#providers.set(provider.metadata.id, provider);
    return this;
  }
  get(id) { return this.#providers.get(id) ?? null; }
  require(id) { const provider = this.get(id); if (!provider) throw new Error(`Provider implementation unavailable: ${id}`); return provider; }
  list() { return [...this.#providers.values()]; }
  supportsPrimitiveFamily(providerId, family) { return this.get(providerId)?.metadata.families.includes(family) ?? false; }
  supportsCapabilityOffering(providerId, family, offering) {
    const provider = this.get(providerId);
    return Boolean(provider && provider.metadata.families.includes(family) && provider.metadata.offerings.some(item => item.id === offering && item.family === family));
  }
  statusForDesired(family, providerId) {
    const provider = this.get(providerId);
    if (!provider || !provider.metadata.families.includes(family)) return {
      family, providerId, desired: true, implementation_available: false, configured: false, connected: false, healthy: false, state: "unavailable"
    };
    const status = Object.fromEntries(providerStates.map(key => [key, Boolean(provider.status[key])]));
    const state = !status.implementation_available ? "unavailable" : !status.configured ? "unconfigured" : !status.connected ? "disconnected" : !status.healthy ? "unhealthy" : "healthy";
    return { family, providerId, desired: true, ...status, state };
  }
}

export class ReferenceProvider {
  constructor({ id, families, offerings = [], configured = true, connected = true, healthy = true }) {
    this.metadata = { id, name: id, version: "1", families, offerings };
    this.status = { implementation_available: true, configured, connected, healthy };
  }
  async validate(action) { return { valid: this.status.healthy && this.metadata.families.includes(action.family), issues: [] }; }
  async plan(action) { return { deterministic: true, actionId: action.id }; }
  async apply(action) { return { providerResourceId: `${this.metadata.id}/${action.family}/${action.resourceId}`, status: "deployed", attributes: action.desired.spec ?? {} }; }
  async observe(resource) {
    const status = this.status.healthy ? "healthy" : "unhealthy";
    return { status, checkedAt: new Date().toISOString(), evidence: [{ type: "provider_status", source: this.metadata.id, value: status }], providerResourceId: resource.providerResourceId };
  }
  async discover() { return []; }
  async health() { return { status: this.status.healthy ? "healthy" : "unhealthy" }; }
}

export class LocalProvider extends ReferenceProvider {
  constructor({ id = "local", families, offerings = [] }) {
    if (id !== "local" && !id.startsWith("local_") && !id.startsWith("mock_")) throw new Error("LocalProvider IDs must explicitly identify local/mock behavior");
    super({ id, families, offerings });
  }
}

export function providerGap(family, providerId, state = "unavailable") {
  return {
    type: state === "unavailable" ? "provider_unavailable" : `provider_${state}`,
    primitiveFamily: family,
    desiredProvider: providerId,
    desired: true,
    implementation: state === "unavailable" ? "unavailable" : "available",
    state,
    message: state === "unavailable" ? "No installed provider implementation is available." : `Provider implementation is ${state}.`
  };
}
