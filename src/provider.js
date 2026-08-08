export class ProviderRegistry {
  #providers = new Map();
  register(provider) { this.#providers.set(provider.metadata.id, provider); return this; }
  get(id) { const provider = this.#providers.get(id); if (!provider) throw new Error(`Provider not configured: ${id}`); return provider; }
  validateSelection(family, id) {
    const provider = this.get(id);
    if (!provider.metadata.families.includes(family)) throw new Error(`Provider ${id} does not implement ${family}`);
    return provider;
  }
}

export class LocalProvider {
  constructor(id = "local", families = []) {
    this.metadata = { id, name: id, version: "1", families };
  }
  async validate(action) { return { valid: this.metadata.families.includes(action.family), issues: [] }; }
  async plan(action) { return { deterministic: true, action }; }
  async apply(action) {
    return { providerResourceId: `${this.metadata.id}/${action.family}/${action.resourceId}`, status: "deployed", attributes: action.desired.spec ?? {} };
  }
  async observe(resource) {
    return { status: "healthy", checkedAt: new Date().toISOString(), evidence: [{ type: "provider_status", source: this.metadata.id, value: "healthy" }], providerResourceId: resource.providerResourceId };
  }
  async discover() { return []; }
  async health() { return { status: "healthy" }; }
}

export function registryForDeclaration(declaration) {
  const byProvider = new Map();
  for (const [family, selection] of Object.entries(declaration.spec.providers)) {
    const families = byProvider.get(selection.provider) ?? [];
    families.push(family);
    byProvider.set(selection.provider, families);
  }
  const registry = new ProviderRegistry();
  for (const [id, families] of byProvider) registry.register(new LocalProvider(id, families));
  return registry;
}
