import test from "node:test";
import assert from "node:assert/strict";
import { parseOmniform } from "@omniseed/omniform";
import { CapabilityResolver, LocalProvider, MemoryStateStore, OmniSeed, ProviderRegistry, ReferenceProvider } from "../src/index.js";

const owner = { actorId: "owner", permissions: ["plan.create", "plan.approve", "plan.apply", "state.reconcile"] };
const supportSource = `apiVersion: omniform.org/v1alpha1
kind: Company
metadata: { id: acme, name: Acme }
spec:
  providers:
    agents: { provider: reference_agents }
    connectors: { provider: reference_connectors }
    workflows: { provider: reference_workflows }
  capabilities:
    - id: customer_support
      name: Customer Support
      requires:
        - { id: receive_request, primitiveFamily: connectors }
        - { id: understand_request, primitiveFamily: agents }
        - { id: access_context, primitiveFamily: connectors }
        - { id: communicate_response, primitiveFamily: connectors }
  operations:
    - { id: get_capability, capability: customer_support, description: Get capability, input: {}, output: {}, mutation: false, permissions: [capability.read], approval: none, interfaces: [lily, api] }
    - { id: generate_plan, capability: customer_support, description: Generate plan, input: {}, output: {}, mutation: false, permissions: [plan.create], approval: none, interfaces: [lily, api] }
    - { id: apply_plan, capability: customer_support, description: Apply plan, input: {}, output: {}, mutation: true, permissions: [plan.apply], approval: required, interfaces: [api] }
`;

const declaration = parseOmniform(supportSource);
const resource = (family, id, name, offers) => ({ family, id, name, offers });
function providers({ connectors = true } = {}) {
  const registry = new ProviderRegistry()
    .register(new ReferenceProvider({ id: "reference_agents", families: ["agents"], offerings: [{ family: "agents", id: "understand_request", resource: resource("agents", "support_agent", "Support Agent", ["understand_request"]) }] }))
    .register(new ReferenceProvider({ id: "reference_workflows", families: ["workflows"], offerings: [{ family: "workflows", id: "customer_support", resource: resource("workflows", "support_workflow", "Support Workflow", []) }] }));
  if (connectors) registry.register(new ReferenceProvider({ id: "reference_connectors", families: ["connectors"], offerings: [
    { family: "connectors", id: "receive_request", resource: resource("connectors", "email_connector", "Email Connector", ["receive_request", "communicate_response"]) },
    { family: "connectors", id: "communicate_response", resource: resource("connectors", "email_connector", "Email Connector", ["receive_request", "communicate_response"]) },
    { family: "connectors", id: "access_context", resource: resource("connectors", "crm_connector", "CRM Connector", ["access_context"]) }
  ] }));
  return registry;
}

test("desired provider without implementation is an explicit gap and never fabricated", async () => {
  const engine = new OmniSeed({ store: new MemoryStateStore(), providers: providers({ connectors: false }) });
  const registry = await engine.inspect(declaration);
  assert.equal(registry.providers.find(item => item.family === "connectors").state, "unavailable");
  assert.equal(registry.providerGaps.find(item => item.primitiveFamily === "connectors").type, "provider_unavailable");
  assert.equal(registry.capabilities[0].resolution.unresolvedRequirements.filter(item => item.cause === "missing_provider").length, 3);
});

test("LocalProvider works only under an explicitly local/mock identity", () => {
  assert.throws(() => new LocalProvider({ id: "vercel_connect", families: ["connectors"] }), /explicitly/);
  assert.equal(new LocalProvider({ id: "local_connectors", families: ["connectors"] }).metadata.id, "local_connectors");
});

test("CapabilityResolver proposes resources without predeclared resources", () => {
  const resolution = new CapabilityResolver().resolveCompany({ declaration, currentState: { deployed: [], observed: [] }, providerRegistry: providers() })[0];
  assert.deepEqual(resolution.recommendedRealisation.resources.map(item => item.id).sort(), ["crm_connector", "email_connector", "support_agent", "support_workflow"]);
});

test("exact plan approval applies only selected action IDs", async () => {
  const engine = new OmniSeed({ store: new MemoryStateStore(), providers: providers() });
  const plan = await engine.plan(declaration, owner);
  const selected = plan.actions.slice(0, 2).map(item => item.id);
  const approval = await engine.approve(plan, selected, owner);
  const result = await engine.apply(declaration, plan, approval, owner);
  assert.equal(result.results.length, 2);
  assert.deepEqual(result.plan.appliedActionIds, selected);
});

test("state change makes a reviewed plan stale", async () => {
  const store = new MemoryStateStore(), engine = new OmniSeed({ store, providers: providers() });
  const p1 = await engine.plan(declaration, owner), approval = await engine.approve(p1, p1.actions.map(item => item.id), owner);
  const p2 = await engine.plan(declaration, owner);
  await assert.rejects(engine.apply(declaration, p1, approval, owner), error => error.code === "plan_stale");
  const p2Approval = await engine.approve(p2, p2.actions.map(item => item.id), owner);
  const result = await engine.apply(declaration, p2, p2Approval, owner);
  assert.equal(result.plan.id, p2.id);
});

test("definition change makes a reviewed plan stale", async () => {
  const engine = new OmniSeed({ store: new MemoryStateStore(), providers: providers() });
  const plan = await engine.plan(declaration, owner), approval = await engine.approve(plan, plan.actions.map(item => item.id), owner);
  const changed = structuredClone(declaration); changed.metadata.name = "Changed";
  await assert.rejects(engine.apply(changed, plan, approval, owner), error => error.code === "plan_stale");
});

test("actor identity and permissions are enforced", async () => {
  const engine = new OmniSeed({ store: new MemoryStateStore(), providers: providers() });
  await assert.rejects(engine.plan(declaration, { actorId: "viewer", permissions: [] }), error => error.code === "authorization_denied");
  await assert.rejects(engine.plan(declaration, { permissions: ["plan.create"] }), error => error.code === "authorization_denied");
});

test("declared operation without a registered handler is unimplemented", async () => {
  const changed = structuredClone(declaration);
  changed.spec.operations.push({ id: "custom_support", capability: "customer_support", description: "Custom", input: {}, output: {}, mutation: false, permissions: [], approval: "none", interfaces: ["api"] });
  const registry = await new OmniSeed({ store: new MemoryStateStore(), providers: providers() }).inspect(changed);
  assert.equal(registry.operations.find(item => item.id === "custom_support").currentAvailability, "unimplemented");
});

test("all-provider scenario reaches realised after reviewed plan", async () => {
  const engine = new OmniSeed({ store: new MemoryStateStore(), providers: providers() });
  const before = await engine.inspect(declaration); assert.equal(before.capabilities[0].state, "missing");
  const plan = await engine.plan(declaration, owner), approval = await engine.approve(plan, plan.actions.map(item => item.id), owner);
  const result = await engine.apply(declaration, plan, approval, owner);
  assert.equal(result.registry.capabilities[0].state, "realised");
  assert.equal(result.state.evidence.length, 4);
});
