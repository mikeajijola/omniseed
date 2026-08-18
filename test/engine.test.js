import test from "node:test";
import assert from "node:assert/strict";
import { parseOmniform } from "@omniseed/omniform";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CapabilityResolver, JsonStateStore, LocalProvider, MemoryStateStore, OmniSeed, ProviderRegistry, ReferenceProvider } from "../src/index.js";

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

test("Provider families are canonical and one package may support independently selected families", () => {
  assert.throws(() => new ProviderRegistry().register(new ReferenceProvider({ id: "legacy", families: ["systems"] })), /non-canonical/);
  const multi = new ReferenceProvider({ id: "multi", families: ["connectors", "observations"] });
  const registry = new ProviderRegistry().register(multi).register(new ReferenceProvider({ id: "identity_only", families: ["identity"] }));
  assert.equal(registry.statusForDesired("connectors", "multi").state, "healthy");
  assert.equal(registry.statusForDesired("identity", "identity_only").state, "healthy");
});

test("historical resources using removed vocabulary remain auditable without becoming new desired families", async () => {
  const historical = { version: 0, companyId: "acme", deployed: [{ family: "systems", id: "legacy_repository", provider: "legacy_github", providerResourceId: "github://repo/1" }], observed: [{ family: "systems", id: "legacy_repository", status: "healthy", checkedAt: "2026-08-10T00:00:00.000Z" }], evidence: [{ id: "legacy_evidence", source: "legacy_github", family: "systems", resourceId: "legacy_repository", observedAt: "2026-08-10T00:00:00.000Z" }], history: [], plans: [], companyChanges: [] };
  const registry = await new OmniSeed({ store: new MemoryStateStore(historical), providers: providers() }).inspect(declaration);
  assert.equal(registry.resources.find(item => item.id === "legacy_repository").observed.status, "healthy");
  assert.equal(registry.evidence[0].family, "systems");
  assert.equal(declaration.spec.providers.systems, undefined);
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

test("plan approval and apply can be exercised by distinct authorised actors", async () => {
  const engine = new OmniSeed({ store: new MemoryStateStore(), providers: providers() });
  const planner = { actorId: "reconciler", permissions: ["plan.create"] };
  const approver = { actorId: "reviewer", permissions: ["plan.approve"] };
  const applier = { actorId: "runtime", permissions: ["plan.apply"] };
  const plan = await engine.plan(declaration, planner);
  const approval = await engine.approve(plan, plan.actions.map(item => item.id), approver);
  const result = await engine.apply(declaration, plan, approval, applier);
  assert.equal(result.plan.status, "applied");
  assert.equal(approval.actorId, "reviewer");
  assert.equal(result.state.history.at(-1).actorId, "runtime");
});

test("state change makes a reviewed plan stale", async () => {
  const store = new MemoryStateStore(), engine = new OmniSeed({ store, providers: providers() });
  const p1 = await engine.plan(declaration, owner), approval = await engine.approve(p1, p1.actions.map(item => item.id), owner);
  const state = await store.load("acme");
  await store.save({ ...state, history: [...state.history, { type: "external_observation_recorded" }] }, state.version);
  await assert.rejects(engine.apply(declaration, p1, approval, owner), error => error.code === "plan_stale");
  const p2 = await engine.plan(declaration, owner);
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

test("canonical instance inspection explains realisation participants through providers and evidence", async () => {
  const canonical = structuredClone(declaration);
  canonical.spec.governance = { desiredState: { repository: "https://github.com/example/acme-company.git", branch: "main", path: "omniform.yaml", changeMode: "pull_request" } };
  canonical.spec.capabilities[0].realisations = ["support_reference"];
  canonical.spec.realisations = [{ id: "support_reference", name: "Reference support", capability: "customer_support", participants: [
    { resource: "support_agent", supplies: ["understand_request"] },
    { resource: "email_connector", supplies: ["receive_request", "communicate_response"] },
    { resource: "crm_connector", supplies: ["access_context"] }
  ] }];
  canonical.spec.resources = {
    agents: [{ id: "support_agent", name: "Support Agent", offers: ["understand_request"] }],
    connectors: [{ id: "email_connector", name: "Email Connector", offers: ["receive_request", "communicate_response"] }, { id: "crm_connector", name: "CRM Connector", offers: ["access_context"] }]
  };
  const subject = new OmniSeed({ store: new MemoryStateStore(), providers: providers(), binding: { desiredRevision: "abc123", environment: "production", deployment: { id: "os-production", provider: "vercel" } } });
  const before = await subject.inspect(canonical);
  assert.equal(before.instance.desiredState.repository, "https://github.com/example/acme-company.git");
  assert.equal(before.instance.desiredRevision, "abc123");
  assert.equal(before.realisations[0].participants[0].provider, "reference_agents");
  const plan = await subject.plan(canonical, owner), approval = await subject.approve(plan, plan.actions.map(item => item.id), owner);
  const after = (await subject.apply(canonical, plan, approval, owner)).registry;
  assert.equal(after.realisations[0].status, "realised");
  assert.ok(after.realisations[0].participants.every(item => item.evidence.length > 0));
});

test("planning and inspection honour Provider selection on each primitive instance", async () => {
  const canonical = structuredClone(declaration);
  canonical.spec.resources = {
    connectors: [
      { id: "inbox", name: "Inbox", provider: "reference_connectors", offers: ["receive_request", "communicate_response"] },
      { id: "customer_context", name: "Customer context", provider: "alternate_connectors", offers: ["access_context"] }
    ],
    agents: [{ id: "support_agent", name: "Support Agent", offers: ["understand_request"] }]
  };
  canonical.spec.capabilities[0].realisations = ["support_composition"];
  canonical.spec.realisations = [{ id: "support_composition", name: "Support composition", capability: "customer_support", participants: [
    { resource: "inbox", supplies: ["receive_request", "communicate_response"] },
    { resource: "customer_context", supplies: ["access_context"] },
    { resource: "support_agent", supplies: ["understand_request"] }
  ] }];
  const registry = providers().register(new ReferenceProvider({ id: "alternate_connectors", families: ["connectors"] }));
  const engine = new OmniSeed({ store: new MemoryStateStore(), providers: registry });
  const inspection = await engine.inspect(canonical);
  assert.equal(inspection.resources.find(item => item.id === "inbox").provider, "reference_connectors");
  assert.equal(inspection.resources.find(item => item.id === "customer_context").provider, "alternate_connectors");
  assert.equal(inspection.realisations[0].participants.find(item => item.resource === "customer_context").provider, "alternate_connectors");
  const plan = await engine.plan(canonical, owner);
  assert.equal(plan.actions.find(item => item.resourceId === "inbox").provider, "reference_connectors");
  assert.equal(plan.actions.find(item => item.resourceId === "customer_context").provider, "alternate_connectors");
  const approval = await engine.approve(plan, plan.actions.map(item => item.id), owner);
  const applied = await engine.apply(canonical, plan, approval, owner);
  assert.equal(applied.state.deployed.find(item => item.id === "customer_context").provider, "alternate_connectors");
  assert.equal(applied.state.evidence.find(item => item.resourceId === "customer_context").source, "alternate_connectors");
});

test("durable state preserves binding, proposals and activity across engine restart", async () => {
  const path = join(await mkdtemp(join(tmpdir(), "omniseed-state-")), "state.json");
  const permissions = { actorId: "operator", permissions: ["company.bind", "company_change.propose", "company_change.read", "activity.read"] };
  const first = new OmniSeed({ store: new JsonStateStore(path), providers: providers() });
  await first.recordCompanyBinding(declaration, { desiredRevision: "desired-a", observedRevision: "observed-a" }, permissions);
  const proposal = await first.proposeCompanyChange(declaration, { reason: "Clarify company name", risk: "low", patch: [{ op: "replace", path: "/metadata/name", value: "Acme Company" }] }, permissions);
  const second = new OmniSeed({ store: new JsonStateStore(path), providers: providers() });
  const registry = await second.inspect(declaration);
  assert.equal(registry.instance.desiredRevision, "desired-a");
  assert.equal(registry.instance.observedStateRevision, 2);
  assert.equal((await second.getCompanyChangeProposal(declaration, proposal.id, permissions)).hash, proposal.hash);
  assert.deepEqual((await second.listActivity(declaration, permissions)).map(item => item.type), ["company_binding_recorded", "company_change_proposed"]);
  assert.match(await readFile(path, "utf8"), /desired-a/);
});

test("desired and observed revisions remain separate and reconciliation advances observation deterministically", async () => {
  const path = join(await mkdtemp(join(tmpdir(), "omniseed-state-")), "state.json");
  const auth = { actorId: "operator", permissions: ["company.bind", "state.reconcile", "activity.read"] };
  const engine = new OmniSeed({ store: new JsonStateStore(path), providers: providers() });
  await engine.recordCompanyBinding(declaration, { desiredRevision: "desired-b", observedRevision: "observed-a" }, auth);
  assert.equal((await engine.inspect(declaration)).instance.observedStateRevision, 1);
  await engine.reconcile(declaration, auth);
  const restarted = new OmniSeed({ store: new JsonStateStore(path), providers: providers() });
  const state = await restarted.store.load("acme");
  assert.equal(state.binding.desiredRevision, "desired-b");
  assert.equal(state.binding.observedRevision, "desired-b");
  assert.equal(state.history.at(-1).type, "reconciled");
});

test("durable store rejects cross-company state and optimistic write conflicts", async () => {
  const path = join(await mkdtemp(join(tmpdir(), "omniseed-state-")), "state.json"), store = new JsonStateStore(path);
  const initial = await store.load("acme"), saved = await store.save(initial, 0);
  await assert.rejects(store.load("other"), /company mismatch/);
  await assert.rejects(store.save(saved, 0), /State conflict/);
});
