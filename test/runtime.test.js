import test from "node:test";
import assert from "node:assert/strict";
import { parseOmniform } from "@omniseed/omniform";
import { assembleRuntime, desiredResourcesForProvider, HttpStateStore, MemoryStateStore, ReferenceProvider, renderProviderAssemblyDiagnostics } from "../src/index.js";

const source = `apiVersion: omniform.org/v1alpha1
kind: Company
metadata: { id: repeatable_company, name: Repeatable Company }
spec:
  providers:
    workflows: { provider: github }
  capabilities:
    - id: reconcile_company
      name: Reconcile Company
      requires:
        - { id: desired_state_workflow, primitiveFamily: workflows }
      realisations: [reconciliation]
  realisations:
    - id: reconciliation
      name: Reconciliation
      capability: reconcile_company
      participants:
        - { resource: reconcile_workflow, supplies: [desired_state_workflow] }
  resources:
    workflows:
      - { id: reconcile_workflow, name: Reconcile workflow, provider: github, offers: [desired_state_workflow] }
  operations:
    - { id: generate_plan, capability: reconcile_company, description: Generate plan, input: {}, output: {}, mutation: false, permissions: [plan.create], approval: none, interfaces: [machine] }
    - { id: apply_plan, capability: reconcile_company, description: Apply plan, input: {}, output: {}, mutation: true, permissions: [plan.apply], approval: required, interfaces: [machine] }
    - { id: observe_company, capability: reconcile_company, description: Observe company, input: {}, output: {}, mutation: true, permissions: [state.reconcile], approval: policy, interfaces: [machine] }
`;
const declaration = parseOmniform(source);
const provider = () => new ReferenceProvider({ id: "github", families: ["workflows"] });
const planner = { actorId: "reconciler", permissions: ["plan.create"] };

test("same Omniform and equivalent installed Provider configuration produce the same plan", async () => {
  const first = await assembleRuntime({ declaration, store: new MemoryStateStore(), providerHandles: [provider()], binding: { desiredRevision: "approved-sha" } });
  const second = await assembleRuntime({ declaration, store: new MemoryStateStore(), providerHandles: [provider()], binding: { desiredRevision: "approved-sha" } });
  const firstPlan = await first.engine.invokeOperation(declaration, "generate_plan", {}, planner);
  const secondPlan = await second.engine.invokeOperation(declaration, "generate_plan", {}, planner);
  assert.equal(firstPlan.id, secondPlan.id);
  assert.equal(firstPlan.hash, secondPlan.hash);
  assert.deepEqual(firstPlan.actions, secondPlan.actions);
  assert.deepEqual(first.desiredProviderBindings, second.desiredProviderBindings);
  assert.equal(firstPlan.actions[0].provider, "github");
});

test("Provider context contains only its approved desired resources across primitive families", () => {
  const multiProviderDeclaration = structuredClone(declaration);
  multiProviderDeclaration.spec.providers.connectors = { provider: "github" };
  multiProviderDeclaration.spec.resources.connectors = [
    { id: "operations", name: "Operations", offers: ["operation_access"] },
    { id: "external", name: "External", provider: "vercel", offers: ["external_access"] }
  ];
  const github = desiredResourcesForProvider(multiProviderDeclaration, "github");
  const vercel = desiredResourcesForProvider(multiProviderDeclaration, "vercel");
  assert.deepEqual(github.map(item => `${item.family}:${item.id}`), ["workflows:reconcile_workflow", "connectors:operations"]);
  assert.deepEqual(vercel.map(item => `${item.family}:${item.id}`), ["connectors:external"]);
  github[0].id = "mutated";
  assert.equal(multiProviderDeclaration.spec.resources.workflows[0].id, "reconcile_workflow");
});

test("runtime assembly reports uninstalled desired Providers without fabricating them", async () => {
  const runtime = await assembleRuntime({ declaration, store: new MemoryStateStore() });
  const inspection = await runtime.engine.inspect(declaration);
  assert.equal(inspection.providers.find(item => item.providerId === "github").state, "unavailable");
  assert.equal(runtime.desiredProviderBindings.find(item => item.resourceId === "reconcile_workflow").providerId, "github");
});

test("discovery assembles selected GitHub, Google, Vercel, OmniSeed, and Neon-compatible claims deterministically", async () => {
  const selected = selectedDeclaration();
  const implementations = [
    implementation("github", ["workflows", "identity"]),
    implementation("google", ["inference"]),
    implementation("vercel", ["agents", "connectors"]),
    implementation("omniseed", ["skills", "policies", "observations"]),
    implementation("neon", ["memory"])
  ];
  const runtime = await assembleRuntime({ declaration: selected, store: new MemoryStateStore(), providerImplementations: implementations });
  assert.deepEqual(runtime.providers.list().map(item => item.metadata.id), ["github", "google", "neon", "omniseed", "vercel"]);
  assert.deepEqual(runtime.assemblyDiagnostics.map(item => [item.providerId, item.state]), [
    ["github", "healthy"], ["google", "healthy"], ["neon", "healthy"], ["omniseed", "healthy"], ["vercel", "healthy"]
  ]);
  assert.ok(runtime.assemblyDiagnostics.every(item => item.lifecycle.implementation === "available" && item.lifecycle.configure === "succeeded" && item.lifecycle.connect === "succeeded" && item.lifecycle.health === "succeeded" && item.lifecycle.register === "succeeded"));
  assert.ok((await runtime.engine.inspect(selected)).providers.every(item => item.state === "healthy"));
});

test("discovery fails closed with structured evidence for missing and incompatible implementations", async () => {
  const selected = selectedDeclaration();
  selected.spec.providers.machines = { provider: "missing" };
  const runtime = await assembleRuntime({
    declaration: selected,
    store: new MemoryStateStore(),
    providerImplementations: [implementation("github", ["workflows"]), implementation("google", ["inference"], { engineCompatibility: ">=2.0.0" })]
  });
  const github = runtime.assemblyDiagnostics.find(item => item.providerId === "github");
  const google = runtime.assemblyDiagnostics.find(item => item.providerId === "google");
  const missing = runtime.assemblyDiagnostics.find(item => item.providerId === "missing");
  assert.equal(github.state, "incompatible");
  assert.equal(github.failure.code, "provider_family_incompatible");
  assert.equal(google.failure.code, "provider_engine_incompatible");
  assert.equal(missing.state, "implementation_unavailable");
  assert.equal(runtime.providers.get("github"), null);
  assert.equal(runtime.providers.get("missing"), null);
  assert.equal(missing.evidence[0].reason.code, missing.failure.code);
});

for (const scenario of [
  { name: "failed configuration", status: { configured: false }, state: "configuration_failed", code: "provider_configuration_failed" },
  { name: "failed connection", status: { connected: false }, state: "connection_failed", code: "provider_connection_failed" },
  { name: "unhealthy status", status: { healthy: false }, state: "unhealthy", code: "provider_unhealthy" }
]) test(`discovery records ${scenario.name} and does not register the implementation`, async () => {
  const runtime = await assembleRuntime({ declaration, store: new MemoryStateStore(), providerImplementations: [implementation("github", ["workflows"], { status: scenario.status })] });
  assert.equal(runtime.providers.get("github"), null);
  assert.equal(runtime.assemblyDiagnostics[0].state, scenario.state);
  assert.equal(runtime.assemblyDiagnostics[0].failure.code, scenario.code);
  assert.equal(runtime.assemblyDiagnostics[0].evidence.at(-1).state, "failed");
});

test("a lifecycle exception is attributed to its exact failed transition", async () => {
  const claim = implementation("github", ["workflows"]);
  claim.load = async () => {
    const provider = new ReferenceProvider({ id: "github", families: ["workflows"], version: "1.2.3" });
    provider.connect = async () => { throw new Error("connection refused"); };
    return provider;
  };
  const runtime = await assembleRuntime({ declaration, store: new MemoryStateStore(), providerImplementations: [claim] });
  assert.equal(runtime.assemblyDiagnostics[0].state, "connection_failed");
  assert.equal(runtime.assemblyDiagnostics[0].failure.code, "provider_connection_failed");
  assert.equal(runtime.assemblyDiagnostics[0].evidence.at(-1).stage, "connect");
});

test("machine and human Provider diagnostics communicate the same identity, families, state, version, and failure", async () => {
  const selected = selectedDeclaration();
  selected.spec.providers.machines = { provider: "missing" };
  const runtime = await assembleRuntime({ declaration: selected, store: new MemoryStateStore(), providerImplementations: [
    implementation("github", ["workflows", "identity"]), implementation("google", ["inference"]), implementation("vercel", ["agents", "connectors"]), implementation("omniseed", ["skills", "policies", "observations"]), implementation("neon", ["memory"])
  ] });
  const rendered = renderProviderAssemblyDiagnostics(runtime.assemblyDiagnostics);
  assert.match(rendered, /github \[identity, workflows\]: healthy implementation 1\.2\.3/);
  assert.match(rendered, /missing \[machines\]: implementation_unavailable; provider_implementation_unavailable:/);
  assert.equal(runtime.assemblyDiagnostics.find(item => item.providerId === "github").implementation.version, "1.2.3");
});

test("repeated planning against unchanged desired and runtime state returns the exact persisted plan", async () => {
  const runtime = await assembleRuntime({ declaration, store: new MemoryStateStore(), providerHandles: [provider()], binding: { desiredRevision: "approved-sha" } });
  const first = await runtime.engine.invokeOperation(declaration, "generate_plan", {}, planner);
  const second = await runtime.engine.invokeOperation(declaration, "generate_plan", {}, planner);
  const state = await runtime.engine.store.load("repeatable_company");
  assert.deepEqual(second, first);
  assert.equal(state.plans.length, 1);
  assert.equal(state.history.filter(item => item.type === "plan_generated").length, 1);
});

test("HTTP state remains company-scoped and uses optimistic concurrency", async () => {
  let saved = null;
  const fetchImpl = async (url, init = {}) => {
    if (!url.endsWith("/companies/repeatable_company/state")) return response(404, {});
    if (!init.method) return saved ? response(200, saved) : response(404, {});
    const expected = Number(init.headers["if-match"]);
    if ((saved?.version ?? 0) !== expected) return response(412, {});
    saved = { ...JSON.parse(init.body), version: expected + 1 };
    return response(200, saved);
  };
  const first = new HttpStateStore({ endpoint: "https://state.example/api/state", token: "server-secret", fetchImpl });
  const initial = await first.load("repeatable_company");
  const persisted = await first.save({ ...initial, history: [{ type: "started" }] }, 0);
  const restarted = new HttpStateStore({ endpoint: "https://state.example/api/state", token: "server-secret", fetchImpl });
  assert.deepEqual((await restarted.load("repeatable_company")).history, [{ type: "started" }]);
  await assert.rejects(restarted.save(persisted, 0), /State conflict/);
});

function response(status, body) { return { status, ok: status >= 200 && status < 300, json: async () => structuredClone(body) }; }

function selectedDeclaration() {
  const selected = structuredClone(declaration);
  selected.spec.providers = {
    agents: { provider: "vercel" }, skills: { provider: "omniseed" }, connectors: { provider: "vercel" },
    workflows: { provider: "github" }, policies: { provider: "omniseed" }, observations: { provider: "omniseed" },
    memory: { provider: "neon" }, identity: { provider: "github" }, inference: { provider: "google" }
  };
  return selected;
}

function implementation(id, families, { engineCompatibility = ">=1.0.0 <2.0.0", status = {} } = {}) {
  return {
    manifest: {
      manifestVersion: "1.0", id, organisation: `${id} organisation`, version: "1.2.3", engineCompatibility,
      primitiveFamilies: families,
      implementations: families.map(family => ({ family, products: [`${id} test double`] })),
      operations: [], configurationSchema: "./configuration.schema.json", observationTypes: [], evidenceTypes: ["provider_status"], permissions: []
    },
    load: async () => new ReferenceProvider({ id, families, version: "1.2.3", ...status })
  };
}
