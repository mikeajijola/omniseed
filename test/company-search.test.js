import test from "node:test";
import assert from "node:assert/strict";
import { parseOmniform } from "@omniseed/omniform";
import { definitionHash, LocalCompanySearchProvider, MemoryStateStore, OmniSeed, ProviderRegistry, ReferenceProvider } from "../src/index.js";

const authorization = { actorId: "owner", permissions: ["company_search.read", "plan.create"] };
const memoryYaml = declarationSource({ requirements: [{ id: "retained_company_knowledge", primitiveFamily: "memory" }], providers: { memory: "local_company_search" }, dependencies: ["memory"] });
const memoryJson = JSON.stringify({ kind: "Company", apiVersion: "omniform.org/v1alpha1", metadata: { id: "acme", name: "Acme" }, spec: { operations: [{ interfaces: ["lily", "ui", "api", "cli", "agent", "machine"], approval: "none", permissions: ["company_search.read"], mutation: false, output: {}, input: {}, description: "Search company", capability: "company_search", id: "search_company", providerDependencies: ["memory"] }], capabilities: [{ requires: [{ primitiveFamily: "memory", id: "retained_company_knowledge" }], description: "Find and retrieve relevant company knowledge", name: "Company Search", id: "company_search" }], providers: { memory: { provider: "local_company_search" } } } });

test("equivalent YAML and JSON preserve Company Search as an ordinary Capability", async () => {
  const fromYaml = parseOmniform(memoryYaml, "yaml"), fromJson = parseOmniform(memoryJson, "json");
  assert.deepEqual(fromYaml, fromJson); assert.equal(definitionHash(fromYaml), definitionHash(fromJson));
  assert.equal(fromYaml.spec.capabilities[0].id, "company_search");
  assert.equal(fromYaml.spec.operations[0].capability, "company_search");
});

test("memory-backed Company Search routes through the declared capability realisation", async () => {
  const declaration = parseOmniform(memoryYaml), provider = new LocalCompanySearchProvider({ family: "memory" }), providers = new ProviderRegistry().register(provider);
  await provider.index({ companyId: "acme", item: { id: "support_design", title: "Customer Support", content: "Customer Support uses the Support Agent.", provenance: { sourceReference: "omniform://acme/capabilities/customer_support", kind: "capability" }, evidenceReferences: ["evidence_1"] } });
  const store = new MemoryStateStore(), engine = new OmniSeed({ store, providers }), before = await store.load("acme");
  const results = await engine.invokeOperation(declaration, "search_company", { query: "customer support" }, authorization);
  assert.equal(results[0].sourceReference, "omniform://acme/capabilities/customer_support");
  assert.deepEqual(results[0].evidenceReferences, ["evidence_1"]);
  assert.deepEqual(await store.load("acme"), before, "search output cannot mutate canonical runtime state");
});

test("connector-backed federated search requires no memory or skills Provider", async () => {
  const declaration = parseOmniform(declarationSource({ requirements: [{ id: "access_company_sources", primitiveFamily: "connectors" }], providers: { connectors: "federated_sources" }, dependencies: ["connectors"] }));
  const provider = new FederatedSearchProvider(), engine = new OmniSeed({ store: new MemoryStateStore(), providers: new ProviderRegistry().register(provider) });
  const results = await engine.invokeOperation(declaration, "search_company", { query: "release" }, authorization);
  assert.equal(results[0].sourceReference, "github://example/release");
  assert.equal(declaration.spec.providers.memory, undefined);
  assert.equal(declaration.spec.providers.skills, undefined);
  assert.deepEqual(provider.lastRealisation.participants, [{ family: "connectors", providerId: "federated_sources", state: "healthy", executesOperation: true }]);
});

test("declared multi-primitive search strategy exposes all participants without equating the capability to one", async () => {
  const declaration = parseOmniform(declarationSource({ requirements: [{ id: "semantic_search", primitiveFamily: "skills" }, { id: "retained_company_knowledge", primitiveFamily: "memory" }], providers: { skills: "local_company_search", memory: "company_memory" }, dependencies: ["skills", "memory"] }));
  const search = new LocalCompanySearchProvider(), memory = new ReferenceProvider({ id: "company_memory", families: ["memory"], offerings: [{ family: "memory", id: "retained_company_knowledge" }] });
  await search.index({ companyId: "acme", item: { id: "policy", content: "Release policy", provenance: { sourceReference: "doc://policy", kind: "document" } } });
  const engine = new OmniSeed({ store: new MemoryStateStore(), providers: new ProviderRegistry().register(search).register(memory) });
  const [result] = await engine.invokeOperation(declaration, "search_company", { query: "release" }, authorization);
  assert.equal(result.sourceReference, "doc://policy");
  assert.deepEqual(search.lastCapabilityRealisation.participants.map(item => item.family), ["skills", "memory"]);
  assert.equal(search.lastCapabilityRealisation.capabilityId, "company_search");
});

test("missing declared search participant is a truthful gap with no fallback", async () => {
  const declaration = parseOmniform(declarationSource({ requirements: [{ id: "access_company_sources", primitiveFamily: "connectors" }], providers: { connectors: "missing_federated_sources" }, dependencies: ["connectors"] }));
  const registry = await new OmniSeed({ store: new MemoryStateStore(), providers: new ProviderRegistry() }).inspect(declaration);
  assert.equal(registry.providerGaps[0].primitiveFamily, "connectors");
  await assert.rejects(new OmniSeed({ store: new MemoryStateStore(), providers: new ProviderRegistry() }).invokeOperation(declaration, "search_company", { query: "support" }, authorization), error => error.code === "provider_unavailable");
});

test("company isolation prevents cross-company search leakage", async () => {
  const provider = new LocalCompanySearchProvider({ family: "memory" });
  await provider.index({ companyId: "acme", item: { id: "secret", content: "Customer Support", provenance: { sourceReference: "doc://secret", kind: "document" } } });
  assert.deepEqual(await provider.search({ companyId: "other", query: "customer" }), []);
});

class FederatedSearchProvider extends ReferenceProvider {
  constructor() { super({ id: "federated_sources", families: ["connectors"], operations: ["search_company"], offerings: [{ family: "connectors", id: "access_company_sources" }] }); this.lastRealisation = null; }
  async invoke(operation, input) { assert.equal(operation, "search"); this.lastRealisation = input.capabilityRealisation; return [{ id: "release", sourceReference: "github://example/release", kind: "document", provenance: { sourceReference: "github://example/release", kind: "document" } }]; }
}

function declarationSource({ requirements, providers, dependencies }) {
  return `apiVersion: omniform.org/v1alpha1
kind: Company
metadata: { id: acme, name: Acme }
spec:
  providers: { ${Object.entries(providers).map(([family, provider]) => `${family}: { provider: ${provider} }`).join(", ")} }
  capabilities:
    - id: company_search
      name: Company Search
      description: Find and retrieve relevant company knowledge
      requires: ${JSON.stringify(requirements)}
  operations:
    - { id: search_company, capability: company_search, description: Search company, input: {}, output: {}, mutation: false, permissions: [company_search.read], approval: none, interfaces: [lily, ui, api, cli, agent, machine], providerDependencies: ${JSON.stringify(dependencies)} }
`;
}
