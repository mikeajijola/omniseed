import { compileCompany } from "./compiler.js";
import { createPlan } from "./planner.js";

export class OmniSeed {
  constructor({ store, providers }) { this.store = store; this.providers = providers; }
  async inspect(declaration) { const state = await this.store.load(declaration.metadata.id); return compileCompany(declaration, state); }
  async plan(declaration) { const state = await this.store.load(declaration.metadata.id); return createPlan(declaration, state); }
  async apply(declaration, plan, { approved = false } = {}) {
    if (plan.companyId !== declaration.metadata.id) throw new Error("Plan belongs to another company");
    if (plan.approvalRequired && !approved) throw new Error("Plan requires explicit approval");
    const state = await this.store.load(declaration.metadata.id);
    if (state.version !== plan.baseVersion) throw new Error(`Stale plan: state is version ${state.version}, plan uses ${plan.baseVersion}`);
    const deployed = [...state.deployed];
    const observed = [...state.observed];
    const evidence = [...state.evidence];
    const results = [];
    for (const action of plan.actions) {
      const provider = this.providers.validateSelection(action.family, action.provider);
      const validation = await provider.validate(action);
      if (!validation.valid) throw new Error(`Provider rejected ${action.resourceId}`);
      await provider.plan(action);
      const resource = await provider.apply(action);
      const deployment = { family: action.family, id: action.resourceId, provider: action.provider, ...resource };
      deployed.push(deployment);
      const observation = { family: action.family, id: action.resourceId, ...(await provider.observe(deployment)) };
      observed.push(observation);
      evidence.push(...observation.evidence.map(item => ({ ...item, family: action.family, resourceId: action.resourceId, observedAt: observation.checkedAt })));
      results.push({ action, deployment, observation });
    }
    const next = await this.store.save({ ...state, deployed, observed, evidence, history: [...state.history, { type: "plan_applied", planId: plan.id, at: new Date().toISOString(), actions: plan.actions.length }] }, state.version);
    return { plan: { ...plan, status: plan.gaps.length ? "partially_applied" : "applied" }, state: next, registry: compileCompany(declaration, next), results };
  }
  async reconcile(declaration) {
    const state = await this.store.load(declaration.metadata.id);
    const observed = [];
    for (const resource of state.deployed) {
      const provider = this.providers.validateSelection(resource.family, resource.provider);
      observed.push({ family: resource.family, id: resource.id, ...(await provider.observe(resource)) });
    }
    const next = await this.store.save({ ...state, observed, history: [...state.history, { type: "reconciled", at: new Date().toISOString() }] }, state.version);
    return compileCompany(declaration, next);
  }
}
