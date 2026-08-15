import test from "node:test";
import assert from "node:assert/strict";
import { parseOmniform } from "@omniseed/omniform";
import { definitionHash, LocalCompanySearchProvider, MemoryStateStore, OmniSeed, ProviderRegistry } from "../src/index.js";

const yaml = `# human format
apiVersion: omniform.org/v1alpha1
kind: Company
metadata: { name: Acme, id: acme }
spec:
  providers: { memory: { provider: local_company_search } }
  capabilities:
    - id: company_knowledge
      name: Company Knowledge
      requires: [{ id: retain_company_knowledge, primitiveFamily: memory }]
  operations:
    - { id: search_company, capability: company_knowledge, description: Search company, input: {}, output: {}, mutation: false, permissions: [company_search.read], approval: none, interfaces: [lily, ui, api, cli, agent, machine], providerDependencies: [memory] }
`;
const json = JSON.stringify({ kind: "Company", apiVersion: "omniform.org/v1alpha1", metadata: { id: "acme", name: "Acme" }, spec: { operations: [{ interfaces: ["lily", "ui", "api", "cli", "agent", "machine"], approval: "none", permissions: ["company_search.read"], mutation: false, output: {}, input: {}, description: "Search company", capability: "company_knowledge", id: "search_company", providerDependencies: ["memory"] }], capabilities: [{ requires: [{ primitiveFamily: "memory", id: "retain_company_knowledge" }], name: "Company Knowledge", id: "company_knowledge" }], providers: { memory: { provider: "local_company_search" } } } });
const authorization = { actorId: "owner", permissions: ["company_search.read", "plan.create"] };

test("equivalent YAML and JSON produce the same object, definition hash, registry and plan", async () => {
  const fromYaml = parseOmniform(yaml, "yaml"), fromJson = parseOmniform(json, "json");
  assert.deepEqual(fromYaml, fromJson); assert.equal(definitionHash(fromYaml), definitionHash(fromJson));
  const make = () => new OmniSeed({ store: new MemoryStateStore(), providers: new ProviderRegistry().register(new LocalCompanySearchProvider()) });
  const [yamlRegistry, jsonRegistry] = await Promise.all([make().inspect(fromYaml), make().inspect(fromJson)]);
  assert.deepEqual(stripGenerated(yamlRegistry), stripGenerated(jsonRegistry));
  const [yamlPlan, jsonPlan] = await Promise.all([make().plan(fromYaml, authorization), make().plan(fromJson, authorization)]);
  assert.equal(yamlPlan.hash, jsonPlan.hash); assert.deepEqual(yamlPlan.actions, jsonPlan.actions);
});

test("local search routes through provider-neutral operation and preserves provenance", async () => {
  const declaration = parseOmniform(yaml), provider = new LocalCompanySearchProvider(), providers = new ProviderRegistry().register(provider);
  await provider.index({ companyId: "acme", item: { id: "support_design", title: "Customer Support", content: "Customer Support uses the Support Agent and Gmail Connector.", provenance: { sourceReference: "omniform://acme/capabilities/customer_support", kind: "capability" }, capabilityReferences: ["customer_support"], evidenceReferences: ["evidence_1"] } });
  const engine = new OmniSeed({ store: new MemoryStateStore(), providers });
  const results = await engine.invokeOperation(declaration, "search_company", { query: "customer support" }, authorization);
  assert.equal(results[0].id, "support_design");
  assert.equal(results[0].sourceReference, "omniform://acme/capabilities/customer_support");
  assert.deepEqual(results[0].evidenceReferences, ["evidence_1"]);
});

test("company isolation prevents cross-company search leakage", async () => {
  const provider = new LocalCompanySearchProvider();
  await provider.index({ companyId: "acme", item: { id: "secret", content: "Customer Support", provenance: { sourceReference: "doc://secret", kind: "document" } } });
  assert.deepEqual(await provider.search({ companyId: "other", query: "customer" }), []);
});

test("missing desired search provider creates a gap with no fallback", async () => {
  const declaration = parseOmniform(yaml); declaration.spec.providers.memory.provider = "turbopuffer";
  const registry = await new OmniSeed({ store: new MemoryStateStore(), providers: new ProviderRegistry() }).inspect(declaration);
  assert.deepEqual(registry.providerGaps[0], { type: "provider_unavailable", primitiveFamily: "memory", desiredProvider: "turbopuffer", state: "unavailable", message: "No installed provider implementation is available." });
  await assert.rejects(new OmniSeed({ store: new MemoryStateStore(), providers: new ProviderRegistry() }).invokeOperation(declaration, "search_company", { query: "support" }, authorization), error => error.code === "provider_unavailable");
});

const stripGenerated = registry => { const copy = structuredClone(registry); delete copy.generatedAt; return copy; };
