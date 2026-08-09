import { compileCompany } from "./compiler.js";
import { createPlan, definitionHash, verifyPlanHash } from "./planner.js";
import { authorize, EngineError, OperationRegistry } from "./operations.js";
import { providerGap } from "./provider.js";
import { CapabilityResolver } from "./resolver.js";

export class OmniSeed {
  constructor({ store, providers, resolver = new CapabilityResolver(), operations = defaultOperations() }) { this.store = store; this.providers = providers; this.resolver = resolver; this.operations = operations; }
  async inspect(declaration) {
    const state = await this.store.load(declaration.metadata.id);
    const resolutions = this.resolver.resolveCompany({ declaration, currentState: state, providerRegistry: this.providers });
    return compileCompany(declaration, state, { providerRegistry: this.providers, resolutions, operationRegistry: this.operations });
  }
  async plan(declaration, authorization) {
    authorize(authorization, ["plan.create"]);
    const state = await this.store.load(declaration.metadata.id);
    const resolutions = this.resolver.resolveCompany({ declaration, currentState: state, providerRegistry: this.providers });
    const plan = createPlan(declaration, state, resolutions);
    const next = await this.store.save({ ...state, plans: [...state.plans, plan], history: [...state.history, { type: "plan_generated", planId: plan.id, actorId: authorization.actorId, at: plan.createdAt }] }, state.version);
    if (next.version !== plan.stateVersion) throw new Error("Plan persistence version invariant failed");
    return plan;
  }
  async approve(plan, approvedActionIds, authorization) {
    authorize(authorization, ["plan.approve"]);
    const state = await this.store.load(plan.companyId);
    const stored = state.plans.find(item => item.id === plan.id);
    verifyStoredPlan(stored, plan);
    const actionIds = new Set(plan.actions.map(item => item.id));
    if (approvedActionIds.some(id => !actionIds.has(id))) throw new EngineError("approval_invalid", "Approval references an action outside the reviewed plan");
    return { actorId: authorization.actorId, planId: plan.id, planHash: plan.hash, approvedActionIds: [...new Set(approvedActionIds)], permissions: [...authorization.permissions], approvedAt: new Date().toISOString() };
  }
  async apply(declaration, plan, approval, authorization) {
    authorize(authorization, ["plan.apply"]);
    const state = await this.store.load(declaration.metadata.id);
    if (state.version !== plan.stateVersion || definitionHash(declaration) !== plan.definitionHash) throw stale();
    const stored = state.plans.find(item => item.id === plan.id);
    verifyStoredPlan(stored, plan);
    if (!approval || approval.planId !== plan.id || approval.planHash !== plan.hash || approval.actorId !== authorization.actorId) throw new EngineError("approval_invalid", "Approval does not bind this actor to the reviewed plan");
    if (!(approval.permissions ?? []).includes("plan.approve")) throw new EngineError("approval_invalid", "Approval lacks plan.approve authorization context");
    const allowed = new Set(approval.approvedActionIds);
    if ([...allowed].some(id => !plan.actions.some(action => action.id === id))) throw new EngineError("approval_invalid", "Approval contains an unknown action");
    const deployed = [...state.deployed], observed = [...state.observed], evidence = [...state.evidence], results = [];
    for (const action of plan.actions.filter(item => allowed.has(item.id))) {
      const status = this.providers.statusForDesired(action.family, action.provider);
      if (status.state !== "healthy") throw new EngineError("provider_unavailable", `Provider ${action.provider} is ${status.state}`, status);
      const provider = this.providers.require(action.provider);
      const validation = await provider.validate(action);
      if (!validation.valid) throw new EngineError("provider_rejected", `Provider rejected ${action.resourceId}`);
      await provider.plan(action);
      const resource = await provider.apply(action);
      const deployment = { family: action.family, id: action.resourceId, provider: action.provider, desired: action.desired, ...resource };
      deployed.push(deployment);
      const observation = { family: action.family, id: action.resourceId, ...(await provider.observe(deployment)) };
      observed.push(observation);
      evidence.push(...observation.evidence.map(item => ({ ...item, family: action.family, resourceId: action.resourceId, observedAt: observation.checkedAt })));
      results.push({ action, deployment, observation });
    }
    const next = await this.store.save({ ...state, deployed, observed, evidence, plans: state.plans.map(item => item.id === plan.id ? { ...item, status: "applied", appliedActionIds: [...allowed] } : item), history: [...state.history, { type: "plan_applied", planId: plan.id, actorId: authorization.actorId, at: new Date().toISOString(), actionIds: [...allowed] }] }, state.version);
    return { plan: { ...plan, status: "applied", appliedActionIds: [...allowed] }, state: next, registry: await this.inspect(declaration), results };
  }
  async reconcile(declaration, authorization) {
    authorize(authorization, ["state.reconcile"]);
    const state = await this.store.load(declaration.metadata.id), observed = [];
    for (const resource of state.deployed) {
      const provider = this.providers.require(resource.provider);
      observed.push({ family: resource.family, id: resource.id, ...(await provider.observe(resource)) });
    }
    await this.store.save({ ...state, observed, history: [...state.history, { type: "reconciled", actorId: authorization.actorId, at: new Date().toISOString() }] }, state.version);
    return this.inspect(declaration);
  }
  async invokeOperation(declaration, operationId, input, authorization) {
    const operation = declaration.spec.operations.find(item => item.id === operationId);
    if (!operation) throw new EngineError("operation_undeclared", `Operation is not declared: ${operationId}`);
    const registry = await this.inspect(declaration);
    const executable = registry.operations.find(item => item.id === operationId);
    if (executable.currentAvailability !== "available") throw new EngineError(executable.currentAvailability, `Operation is ${executable.currentAvailability}`, { operation: executable, providerGaps: registry.providerGaps });
    return this.operations.invoke(operation, input, { authorization, engine: this, declaration, registry });
  }
}

function verifyStoredPlan(stored, supplied) {
  if (!stored) throw stale("Plan does not exist in company state");
  if (!verifyPlanHash(supplied) || stored.hash !== supplied.hash || JSON.stringify(stored) !== JSON.stringify(supplied)) throw stale("Plan differs from the persisted reviewed plan");
}
const stale = (message = "Definition or runtime state changed after plan review") => new EngineError("plan_stale", message);
function defaultOperations() {
  return new OperationRegistry()
    .register("get_capability", async (input, context) => context.registry.capabilities.find(item => item.id === input.capabilityId) ?? null)
    .register("generate_plan", async (_input, context) => context.engine.plan(context.declaration, context.authorization))
    .register("apply_plan", async (input, context) => context.engine.apply(context.declaration, input.plan, input.approval, context.authorization))
    .register("search_company", async (input, context) => {
      const selected = context.declaration.spec.providers.company_search?.provider;
      const status = context.engine.providers.statusForDesired("company_search", selected);
      if (status.state !== "healthy") throw new EngineError("provider_unavailable", "Company Search provider is unavailable", providerGap("company_search", selected, status.state));
      const provider = context.engine.providers.require(selected);
      if (typeof provider.search !== "function") throw new EngineError("provider_unavailable", "Registered provider does not implement Company Search");
      return provider.search({ ...input, companyId: context.declaration.metadata.id });
    });
}
