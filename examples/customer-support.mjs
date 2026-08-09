import { loadOmniform } from "@omniseed/omniform";
import { MemoryStateStore, OmniSeed, ProviderRegistry, ReferenceProvider } from "../src/index.js";

const declaration = await loadOmniform(new URL("./customer-support.yaml", import.meta.url));
const authorization = { actorId: "owner", permissions: ["plan.create", "plan.approve", "plan.apply"] };
const resource = (family, id, name, offers) => ({ family, id, name, offers });
const createProviders = includeConnectors => {
  const registry = new ProviderRegistry()
    .register(new ReferenceProvider({ id: "reference_agents", families: ["agents"], offerings: [{ family: "agents", id: "understand_request", resource: resource("agents", "support_agent", "Support Agent", ["understand_request"]) }] }))
    .register(new ReferenceProvider({ id: "reference_workflows", families: ["workflows"], offerings: [{ family: "workflows", id: "customer_support", resource: resource("workflows", "support_workflow", "Support Workflow", []) }] }));
  if (includeConnectors) registry.register(new ReferenceProvider({ id: "reference_connectors", families: ["connectors"], offerings: [
    { family: "connectors", id: "receive_request", resource: resource("connectors", "email_connector", "Email Connector", ["receive_request", "communicate_response"]) },
    { family: "connectors", id: "communicate_response", resource: resource("connectors", "email_connector", "Email Connector", ["receive_request", "communicate_response"]) },
    { family: "connectors", id: "access_context", resource: resource("connectors", "crm_connector", "CRM Connector", ["access_context"]) }
  ] }));
  return registry;
};

const available = new OmniSeed({ store: new MemoryStateStore(), providers: createProviders(true) });
const before = await available.inspect(declaration);
const plan = await available.plan(declaration, authorization);
const approval = await available.approve(plan, plan.actions.map(action => action.id), authorization);
const applied = await available.apply(declaration, plan, approval, authorization);
const unavailable = await new OmniSeed({ store: new MemoryStateStore(), providers: createProviders(false) }).inspect(declaration);

console.log(JSON.stringify({
  allProvidersAvailable: {
    before: before.capabilities[0].state,
    proposedResources: plan.actions.map(action => action.desired.name),
    planId: plan.id,
    approvedActionIds: approval.approvedActionIds,
    after: applied.registry.capabilities[0].state,
    evidenceRecorded: applied.state.evidence.length
  },
  connectorProviderUnavailable: {
    capability: unavailable.capabilities[0].state,
    providerGap: unavailable.providerGaps.find(gap => gap.primitiveFamily === "connectors"),
    missingRequirements: unavailable.capabilities[0].resolution.unresolvedRequirements.filter(gap => gap.primitiveFamily === "connectors").map(gap => gap.requirementId)
  }
}, null, 2));
