import { LocalCompanySearchProvider, LocalProvider, ProviderRegistry } from "./provider.js";
import { VercelProvider } from "../providers/vercel/index.js";

export function createRuntimeProviderRegistry({ declaration, vercel = {}, includeReference = true } = {}) {
  const registry = new ProviderRegistry();
  const desired = declaration.spec.providers;
  if ([desired.systems?.provider, desired.schedules?.provider, desired.observations?.provider].includes("vercel")) registry.register(new VercelProvider(vercel));
  if (includeReference && desired.agents?.provider === "local_agents") registry.register(new LocalProvider({ id: "local_agents", families: ["agents"], offerings: [
    offering("agents", "inspect_company_state", "company_steward", "Lily", ["inspect_company_state", "explain_company_state"]),
    offering("agents", "explain_company_state", "company_steward", "Lily", ["inspect_company_state", "explain_company_state"])
  ] }));
  if (includeReference && desired.connectors?.provider === "local_connectors") registry.register(new LocalProvider({ id: "local_connectors", families: ["connectors"], offerings: [offering("connectors", "inspect_repository", "github_repository_access", "GitHub Repository Access", ["inspect_repository"])] }));
  if (includeReference && desired.workflows?.provider === "local_workflows") registry.register(new LocalProvider({ id: "local_workflows", families: ["workflows"], offerings: [offering("workflows", "coordinate_development", "development_workflow", "Development Workflow", ["coordinate_development"])] }));
  if (includeReference && desired.company_search?.provider === "local_company_search") registry.register(new LocalCompanySearchProvider());
  return registry;
}

function offering(family, id, resourceId, name, offers) { return { family, id, resource: { family, id: resourceId, name, offers } }; }
