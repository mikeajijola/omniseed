const providerStates = ["implementation_available", "configured", "connected", "healthy"];

/** Normalized boundary for existing in-process Provider objects. */
export class InProcessProviderHandle {
  constructor(provider) {
    if (!provider?.metadata?.id) throw new Error("Provider implementation requires metadata.id");
    this.provider = provider;
    this.metadata = provider.metadata;
    this.status = provider.status;
    this.kind = "in_process";
  }
  async validate(action) { return this.provider.validate(action); }
  async plan(action) { return this.provider.plan(action); }
  async apply(action) { return this.provider.apply(action); }
  async observe(resource) { return this.provider.observe(resource); }
  async invoke(operation, input, actor) {
    if (typeof this.provider.invoke === "function") return this.provider.invoke(operation, input, actor);
    const handler = this.provider[operation];
    if (typeof handler !== "function") throw new Error(`Provider does not implement operation: ${operation}`);
    return handler.call(this.provider, input, actor);
  }
  async index(input, actor) { return this.invoke("index", input, actor); }
  async update(input, actor) { return this.invoke("update", input, actor); }
  async remove(input, actor) { return this.invoke("remove", input, actor); }
  async search(input, actor) { return this.invoke("search", input, actor); }
  async retrieve(input, actor) { return this.invoke("retrieve", input, actor); }
  async shutdown() { if (typeof this.provider.shutdown === "function") await this.provider.shutdown(); }
}

export function providerHandle(provider) {
  return provider?.providerHandle === true ? provider : new InProcessProviderHandle(provider);
}

export class ProviderRegistry {
  #providers = new Map();
  register(provider) {
    const handle = providerHandle(provider);
    if (this.#providers.has(handle.metadata.id)) throw new Error(`Provider already registered: ${handle.metadata.id}`);
    this.#providers.set(handle.metadata.id, handle);
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

export class CompanySearchProvider extends ReferenceProvider {
  constructor({ id, offerings = [], configured = true, connected = true, healthy = true }) {
    super({ id, families: ["company_search"], offerings, configured, connected, healthy });
  }
  async index() { throw new Error("Company Search provider does not implement index"); }
  async update(request) { return this.index(request); }
  async remove() { throw new Error("Company Search provider does not implement remove"); }
  async search() { throw new Error("Company Search provider does not implement search"); }
  async retrieve() { throw new Error("Company Search provider does not implement retrieve"); }
}

/** Explicit deterministic test/local implementation; never selected as a fallback. */
export class LocalCompanySearchProvider extends CompanySearchProvider {
  #companies = new Map();
  constructor({ id = "local_company_search" } = {}) {
    if (id !== "local_company_search" && !id.startsWith("mock_company_search")) throw new Error("Local Company Search requires an explicit local/mock provider ID");
    const resource = { family: "company_search", id: "company_search_index", name: "Company Search Index", offers: ["search_company_content"] };
    super({ id, offerings: [
      { family: "company_search", id: "search_company_content", resource },
      ...["index", "update", "remove", "search", "retrieve", "keyword_search", "metadata_filtering"].map(offering => ({ family: "company_search", id: offering }))
    ] });
  }
  async index({ companyId, item }) {
    requireCompany(companyId); validateSearchItem(item);
    const company = this.#companies.get(companyId) ?? new Map();
    const indexedAt = item.indexedAt ?? new Date().toISOString();
    company.set(item.id, { ...structuredClone(item), companyId, indexedAt }); this.#companies.set(companyId, company);
    return { id: item.id, companyId, indexedAt };
  }
  async update(request) { return this.index(request); }
  async remove({ companyId, id }) { requireCompany(companyId); return this.#companies.get(companyId)?.delete(id) ?? false; }
  async retrieve({ companyId, id }) { requireCompany(companyId); const item = this.#companies.get(companyId)?.get(id); return item ? toSearchResult(item, 1) : null; }
  async search({ companyId, query, filters = {} }) {
    requireCompany(companyId);
    const terms = String(query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
    return [...(this.#companies.get(companyId)?.values() ?? [])]
      .filter(item => !filters.capability || item.capabilityReferences?.includes(filters.capability))
      .filter(item => !filters.source || item.provenance.sourceReference === filters.source)
      .map(item => ({ item, score: terms.reduce((score, term) => score + searchable(item).filter(value => value.includes(term)).length, 0) }))
      .filter(match => terms.length === 0 || match.score > 0)
      .sort((a, b) => b.score - a.score || a.item.id.localeCompare(b.item.id))
      .map(match => toSearchResult(match.item, terms.length ? match.score / terms.length : undefined));
  }
}

function validateSearchItem(item) {
  if (!item?.id || !item?.provenance?.sourceReference || !item?.provenance?.kind) throw new Error("Search items require id and provenance sourceReference/kind");
}
function requireCompany(companyId) { if (!companyId) throw new Error("Company Search requests require companyId isolation"); }
function searchable(item) { return [item.title, item.summary, item.content].filter(Boolean).map(value => value.toLowerCase()); }
function toSearchResult(item, relevanceScore) {
  return {
    id: item.id,
    sourceReference: item.provenance.sourceReference,
    kind: item.provenance.kind,
    title: item.title ?? null,
    summary: item.summary ?? null,
    content: item.content ?? null,
    provenance: structuredClone(item.provenance),
    relevanceScore,
    capabilityReferences: item.capabilityReferences ?? [],
    evidenceReferences: item.evidenceReferences ?? [],
    indexedAt: item.indexedAt,
    metadata: item.metadata ?? {}
  };
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
