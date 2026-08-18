import test from "node:test";
import assert from "node:assert/strict";
import { parseOmniform } from "@omniseed/omniform";
import { assembleRuntime, HttpStateStore, MemoryStateStore, ReferenceProvider } from "../src/index.js";

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

test("runtime assembly reports uninstalled desired Providers without fabricating them", async () => {
  const runtime = await assembleRuntime({ declaration, store: new MemoryStateStore() });
  const inspection = await runtime.engine.inspect(declaration);
  assert.equal(inspection.providers.find(item => item.providerId === "github").state, "unavailable");
  assert.equal(runtime.desiredProviderBindings.find(item => item.resourceId === "reconcile_workflow").providerId, "github");
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
