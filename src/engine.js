import { compileCompany } from "./compiler.js";
import { createPlan, definitionHash, verifyPlanHash } from "./planner.js";
import { authorize, EngineError, OperationRegistry } from "./operations.js";
import { CapabilityResolver } from "./resolver.js";
import { applyDefinitionPatch, createCompanyChangeProposal, previewCompanyChange, verifyCompanyChangeProposal } from "./company-change.js";

export class OmniSeed {
  constructor({ store, providers, resolver = new CapabilityResolver(), operations = defaultOperations(), companyRepository = null, binding = {} }) { this.store = store; this.providers = providers; this.resolver = resolver; this.operations = operations; this.companyRepository = companyRepository; this.binding = binding; }
  async inspect(declaration) {
    const state = await this.store.load(declaration.metadata.id);
    const active = activeDeclaration(declaration, state);
    const resolutions = this.resolver.resolveCompany({ declaration: active, currentState: state, providerRegistry: this.providers });
    const persistedBinding = Object.fromEntries(Object.entries(state.binding ?? {}).filter(([, value]) => value != null));
    return { ...compileCompany(active, state, { providerRegistry: this.providers, resolutions, operationRegistry: this.operations, binding: { ...this.binding, ...persistedBinding } }), definitionHash: definitionHash(active) };
  }
  async recordCompanyBinding(declaration, binding, authorization) {
    authorize(authorization, ["company.bind"]);
    const state = await this.store.load(declaration.metadata.id), at = new Date().toISOString();
    const nextBinding = { ...(state.binding ?? {}), ...normalizeBinding(binding) };
    if (JSON.stringify(nextBinding) === JSON.stringify(state.binding ?? {})) return structuredClone(state);
    return this.store.save({ ...state, binding: nextBinding, history: [...state.history, { type: "company_binding_recorded", actorId: authorization.actorId, desiredRevision: nextBinding.desiredRevision ?? null, observedRevision: nextBinding.observedRevision ?? null, at }] }, state.version);
  }
  async listActivity(declaration, authorization) {
    authorize(authorization, ["activity.read"]);
    return structuredClone((await this.store.load(declaration.metadata.id)).history ?? []);
  }
  async plan(declaration, authorization) {
    authorize(authorization, ["plan.create"]);
    const state = await this.store.load(declaration.metadata.id);
    const active = activeDeclaration(declaration, state);
    const resolutions = this.resolver.resolveCompany({ declaration: active, currentState: state, providerRegistry: this.providers });
    const plan = createPlan(active, state, resolutions);
    const existing = [...state.plans].reverse().find(item =>
      ["pending", "empty"].includes(item.status) &&
      item.stateVersion === state.version &&
      item.definitionHash === plan.definitionHash &&
      JSON.stringify(item.actions) === JSON.stringify(plan.actions) &&
      JSON.stringify(item.gaps) === JSON.stringify(plan.gaps) &&
      JSON.stringify(item.providerGaps) === JSON.stringify(plan.providerGaps)
    );
    if (existing) return structuredClone(existing);
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
    const approvedAt = new Date().toISOString();
    const approval = { actorId: authorization.actorId, planId: plan.id, planHash: plan.hash, approvedActionIds: [...new Set(approvedActionIds)], permissions: [...authorization.permissions], approvedAt, stateVersion: state.version + 1 };
    const approved = { ...stored, status: "approved", approval, approvedActionIds: approval.approvedActionIds, approvedStateVersion: approval.stateVersion };
    const next = await this.store.save({ ...state, plans: state.plans.map(item => item.id === plan.id ? approved : item), history: [...state.history, { type: "plan_approved", planId: plan.id, planHash: plan.hash, actorId: authorization.actorId, actionIds: approval.approvedActionIds, at: approvedAt }] }, state.version);
    if (next.version !== approval.stateVersion) throw new Error("Approval persistence version invariant failed");
    return approval;
  }
  async apply(declaration, plan, approval, authorization) {
    authorize(authorization, ["plan.apply"]);
    const state = await this.store.load(declaration.metadata.id);
    const active = activeDeclaration(declaration, state);
    if (state.version !== approval?.stateVersion || definitionHash(active) !== plan.definitionHash) throw stale();
    const stored = state.plans.find(item => item.id === plan.id);
    verifyStoredApprovedPlan(stored, plan, approval);
    if (!approval || approval.planId !== plan.id || approval.planHash !== plan.hash) throw new EngineError("approval_invalid", "Approval does not bind the exact reviewed plan");
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
    return { plan: { ...plan, status: "applied", appliedActionIds: [...allowed] }, state: next, registry: await this.inspect(active), results };
  }
  async reconcile(declaration, authorization) {
    authorize(authorization, ["state.reconcile"]);
    const state = await this.store.load(declaration.metadata.id), observed = [];
    for (const resource of state.deployed) {
      const provider = this.providers.require(resource.provider);
      observed.push({ family: resource.family, id: resource.id, ...(await provider.observe(resource)) });
    }
    const at = new Date().toISOString(), observedRevision = state.binding?.desiredRevision ?? state.binding?.observedRevision ?? null;
    await this.store.save({ ...state, binding: { ...(state.binding ?? {}), observedRevision }, observed, history: [...state.history, { type: "reconciled", actorId: authorization.actorId, observedRevision, at }] }, state.version);
    return this.inspect(declaration);
  }
  async proposeCompanyChange(declaration, request, authorization) {
    authorize(authorization, ["company_change.propose"]);
    const state = await this.store.load(declaration.metadata.id), active = activeDeclaration(declaration, state);
    const proposal = createCompanyChangeProposal({ declaration: active, request, actor: authorization, evidence: state.evidence });
    if ((state.companyChanges ?? []).some(item => item.id === proposal.id)) throw new EngineError("company_change_conflict", `Proposal already exists: ${proposal.id}`);
    await this.store.save({ ...state, companyChanges: [...(state.companyChanges ?? []), proposal], history: [...state.history, { type: "company_change_proposed", proposalId: proposal.id, proposalHash: proposal.hash, actorId: authorization.actorId, evidence: proposal.evidence, at: proposal.createdAt }] }, state.version);
    return proposal;
  }
  async listCompanyChangeProposals(declaration, authorization) {
    authorize(authorization, ["company_change.read"]);
    const state = await this.store.load(declaration.metadata.id);
    return structuredClone(state.companyChanges ?? []);
  }
  async getCompanyChangeProposal(declaration, proposalId, authorization) {
    authorize(authorization, ["company_change.read"]);
    return structuredClone(requireProposal(await this.store.load(declaration.metadata.id), proposalId));
  }
  async previewCompanyChange(declaration, proposalId, authorization) {
    authorize(authorization, ["company_change.read"]);
    const state = await this.store.load(declaration.metadata.id), active = activeDeclaration(declaration, state), proposal = requireProposal(state, proposalId);
    return previewCompanyChange({ declaration: active, proposal, compile: candidate => {
      const resolutions = this.resolver.resolveCompany({ declaration: candidate, currentState: state, providerRegistry: this.providers });
      return compileCompany(candidate, state, { providerRegistry: this.providers, resolutions, operationRegistry: this.operations });
    } });
  }
  async approveCompanyChange(declaration, proposalId, proposalHash, authorization) {
    const state = await this.store.load(declaration.metadata.id), active = activeDeclaration(declaration, state), proposal = requireProposal(state, proposalId);
    authorize(authorization, proposal.requiredAuthority.approve);
    if (proposal.status !== "proposed") throw new EngineError("company_change_invalid_state", `Only proposed changes can be approved; found ${proposal.status}`);
    if (!verifyCompanyChangeProposal(proposal) || proposal.hash !== proposalHash) throw new EngineError("approval_invalid", "Approval does not bind the exact persisted proposal");
    if (definitionHash(active) !== proposal.baseDefinitionHash) return this.#markCompanyChangeStale(state, proposal, authorization, definitionHash(active));
    const approval = { proposalId, proposalHash, actorId: authorization.actorId, permissions: [...authorization.permissions], approvedAt: new Date().toISOString() };
    const approved = { ...proposal, status: "approved", approval };
    await this.store.save({ ...state, companyChanges: replaceProposal(state, approved), history: [...state.history, { type: "company_change_approved", proposalId, proposalHash, actorId: authorization.actorId, at: approval.approvedAt }] }, state.version);
    return approval;
  }
  async rejectCompanyChange(declaration, proposalId, reason, authorization) {
    authorize(authorization, ["company_change.reject"]);
    const state = await this.store.load(declaration.metadata.id), proposal = requireProposal(state, proposalId);
    if (!["proposed", "approved"].includes(proposal.status)) throw new EngineError("company_change_invalid_state", `Cannot reject a ${proposal.status} proposal`);
    const rejectedAt = new Date().toISOString(), rejected = { ...proposal, status: "rejected", rejection: { actorId: authorization.actorId, reason: String(reason ?? "").trim(), rejectedAt } };
    await this.store.save({ ...state, companyChanges: replaceProposal(state, rejected), history: [...state.history, { type: "company_change_rejected", proposalId, actorId: authorization.actorId, reason: rejected.rejection.reason, at: rejectedAt }] }, state.version);
    return rejected;
  }
  async applyCompanyChange(declaration, proposalId, authorization) {
    const state = await this.store.load(declaration.metadata.id), active = activeDeclaration(declaration, state), proposal = requireProposal(state, proposalId);
    authorize(authorization, proposal.requiredAuthority.apply);
    if (proposal.status !== "approved") throw new EngineError("company_change_invalid_state", `Only approved changes can be applied; found ${proposal.status}`);
    if (!verifyCompanyChangeProposal(proposal) || proposal.approval?.proposalHash !== proposal.hash || proposal.requiredAuthority.approve.some(permission => !(proposal.approval?.permissions ?? []).includes(permission))) throw new EngineError("approval_invalid", "Stored approval does not bind the exact persisted proposal and its required approval authority");
    if (definitionHash(active) !== proposal.baseDefinitionHash) return this.#markCompanyChangeStale(state, proposal, authorization, definitionHash(active));
    const candidate = applyDefinitionPatch(active, proposal.patch), resultingDefinitionHash = definitionHash(candidate);
    if (resultingDefinitionHash !== proposal.proposedDefinitionHash) throw new EngineError("company_change_tampered", "Applied result differs from the reviewed candidate definition");
    if (active.spec.governance?.desiredState) {
      if (!this.companyRepository) throw new EngineError("company_repository_unavailable", "Canonical Git company repository is not connected; approved desired state cannot be changed outside Git");
      const submission = await this.companyRepository.submit({ authority: active.spec.governance.desiredState, declaration: active, candidate, proposal, authorization });
      const submittedAt = new Date().toISOString(), submittedProposal = { ...proposal, status: "submitted", resultingDefinitionHash, submittedAt, submittedBy: { actorId: authorization.actorId }, submission };
      const next = await this.store.save({ ...state, companyChanges: replaceProposal(state, submittedProposal), evidence: [...state.evidence, ...(submission.evidence ?? [])], history: [...state.history, { type: "company_change_submitted", proposalId, proposalHash: proposal.hash, actorId: authorization.actorId, branch: submission.branch, pullRequest: submission.pullRequest, at: submittedAt }] }, state.version);
      return { proposal: submittedProposal, declaration: active, candidateDeclaration: candidate, state: next, registry: await this.inspect(active), submission };
    }
    const appliedAt = new Date().toISOString(), appliedProposal = { ...proposal, status: "applied", resultingDefinitionHash, appliedAt, appliedBy: { actorId: authorization.actorId } };
    const next = await this.store.save({ ...state, canonicalDefinition: candidate, companyChanges: replaceProposal(state, appliedProposal), history: [...state.history, { type: "company_change_applied", proposalId, proposalHash: proposal.hash, actorId: authorization.actorId, baseDefinitionHash: proposal.baseDefinitionHash, resultingDefinitionHash, at: appliedAt }] }, state.version);
    return { proposal: appliedProposal, declaration: candidate, state: next, registry: await this.inspect(candidate) };
  }
  async mergeCompanyChange(declaration, proposalId, authorization) {
    authorize(authorization, ["company_change.merge"]);
    const state = await this.store.load(declaration.metadata.id), proposal = requireProposal(state, proposalId);
    if (proposal.status !== "submitted") throw new EngineError("company_change_invalid_state", `Only submitted changes can be merged; found ${proposal.status}`);
    if (!this.companyRepository) throw new EngineError("company_repository_unavailable", "Canonical Git company repository is not connected");
    const merge = await this.companyRepository.mergeSubmission({ submission: proposal.submission, proposal, authorization });
    if (!merge?.merged || !merge.mergeCommitSha) throw new EngineError("company_repository_merge_failed", "Company repository Provider did not return merge evidence");
    const mergedProposal = { ...proposal, status: "merged", merge };
    const next = await this.store.save({ ...state, companyChanges: replaceProposal(state, mergedProposal), evidence: [...state.evidence, ...(merge.evidence ?? [])], history: [...state.history, { type: "company_change_merged", proposalId, actorId: authorization.actorId, pullRequest: proposal.submission.pullRequest, mergeCommitSha: merge.mergeCommitSha, at: merge.mergedAt }] }, state.version);
    return { proposal: mergedProposal, state: next, merge };
  }
  async #markCompanyChangeStale(state, proposal, authorization, actualDefinitionHash) {
    const staleAt = new Date().toISOString(), changed = { ...proposal, status: "stale", staleAt };
    await this.store.save({ ...state, companyChanges: replaceProposal(state, changed), history: [...state.history, { type: "company_change_stale", proposalId: proposal.id, actorId: authorization.actorId, at: staleAt }] }, state.version);
    throw new EngineError("company_change_stale", "Company definition changed after the proposal was created", { expected: proposal.baseDefinitionHash, actual: actualDefinitionHash });
  }
  async invokeOperation(declaration, operationId, input, authorization) {
    const state = await this.store.load(declaration.metadata.id), active = activeDeclaration(declaration, state);
    const operation = active.spec.operations.find(item => item.id === operationId);
    if (!operation) throw new EngineError("operation_undeclared", `Operation is not declared: ${operationId}`);
    const registry = await this.inspect(active);
    const executable = registry.operations.find(item => item.id === operationId);
    if (executable.currentAvailability !== "available") throw new EngineError(executable.currentAvailability, `Operation is ${executable.currentAvailability}`, { operation: executable, providerGaps: registry.providerGaps });
    return this.operations.invoke(operation, input, { authorization, engine: this, declaration: active, registry });
  }
}

function verifyStoredPlan(stored, supplied) {
  if (!stored) throw stale("Plan does not exist in company state");
  if (!verifyPlanHash(supplied) || stored.hash !== supplied.hash || JSON.stringify(stored) !== JSON.stringify(supplied)) throw stale("Plan differs from the persisted reviewed plan");
}
function normalizeBinding(binding) {
  if (!binding || typeof binding !== "object" || Array.isArray(binding)) throw new EngineError("company_binding_invalid", "Company binding must be an object");
  const allowed = new Set(["desiredRevision", "observedRevision", "environment", "deployment"]), unknown = Object.keys(binding).filter(key => !allowed.has(key));
  if (unknown.length) throw new EngineError("company_binding_invalid", `Unsupported company binding fields: ${unknown.join(", ")}`);
  return structuredClone(binding);
}
function verifyStoredApprovedPlan(stored, supplied, approval) {
  if (!stored) throw stale("Plan does not exist in company state");
  if (!verifyPlanHash(supplied) || stored.hash !== supplied.hash || stored.status !== "approved" || stored.approvedStateVersion !== approval?.stateVersion || JSON.stringify(stored.approval) !== JSON.stringify(approval)) throw stale("Plan or durable approval differs from the reviewed state");
}
const stale = (message = "Definition or runtime state changed after plan review") => new EngineError("plan_stale", message);
function defaultOperations() {
  return new OperationRegistry()
    .register("inspect_company", async (_input, context) => context.registry)
    .register("get_capability", async (input, context) => context.registry.capabilities.find(item => item.id === input.capabilityId) ?? null)
    .register("inspect_realisation", async (input, context) => context.registry.realisations.find(item => item.id === input.realisationId) ?? null)
    .register("inspect_provider_binding", async (input, context) => context.registry.providers.find(item => item.family === input.primitiveFamily) ?? null)
    .register("list_activity", async (_input, context) => context.engine.listActivity(context.declaration, context.authorization))
    .register("bind_company", async (input, context) => context.engine.recordCompanyBinding(context.declaration, input, context.authorization))
    .register("observe_company", async (_input, context) => context.engine.reconcile(context.declaration, context.authorization))
    .register("generate_plan", async (_input, context) => context.engine.plan(context.declaration, context.authorization))
    .register("apply_plan", async (input, context) => context.engine.apply(context.declaration, input.plan, input.approval, context.authorization))
    .register("propose_company_change", async (input, context) => context.engine.proposeCompanyChange(context.declaration, input, context.authorization))
    .register("inspect_company_change", async (input, context) => input?.proposalId ? context.engine.getCompanyChangeProposal(context.declaration, input.proposalId, context.authorization) : context.engine.listCompanyChangeProposals(context.declaration, context.authorization))
    .register("approve_company_change", async (input, context) => context.engine.approveCompanyChange(context.declaration, input.proposalId, input.proposalHash, context.authorization))
    .register("reject_company_change", async (input, context) => context.engine.rejectCompanyChange(context.declaration, input.proposalId, input.reason, context.authorization))
    .register("apply_company_change", async (input, context) => context.engine.applyCompanyChange(context.declaration, input.proposalId, context.authorization))
    .register("merge_company_change", async (input, context) => context.engine.mergeCompanyChange(context.declaration, input.proposalId, context.authorization))
    .register("search_company", async (input, context) => {
      const operation = context.declaration.spec.operations.find(item => item.id === "search_company");
      const realisation = context.engine.providers.operationRealisation(context.declaration, operation);
      const unavailable = realisation.participants.filter(item => item.status.state !== "healthy");
      if (unavailable.length) throw new EngineError("provider_unavailable", "Company Search capability has unavailable declared primitive realisations", { capabilityId: realisation.capabilityId, participants: unavailable.map(participantSummary) });
      if (!realisation.executor) throw new EngineError("operation_unimplemented", "No Provider participating in the Company Search capability advertises search_company", { capabilityId: realisation.capabilityId, participants: realisation.participants.map(participantSummary) });
      try { return await realisation.executor.invoke("search", { ...input, companyId: context.declaration.metadata.id, capabilityRealisation: { capabilityId: realisation.capabilityId, participants: realisation.participants.map(participantSummary) } }, context.authorization); }
      catch (error) { throw new EngineError("provider_unavailable", `Registered provider cannot search Company content: ${error.message}`); }
    });
}

function participantSummary(item) { return { family: item.family, providerId: item.providerId, state: item.status.state, executesOperation: item.executesOperation }; }

function activeDeclaration(declaration, state) { return state?.canonicalDefinition ?? declaration; }
function requireProposal(state, proposalId) {
  const proposal = (state.companyChanges ?? []).find(item => item.id === proposalId);
  if (!proposal) throw new EngineError("company_change_not_found", `Company change proposal does not exist: ${proposalId}`);
  return proposal;
}
function replaceProposal(state, proposal) { return (state.companyChanges ?? []).map(item => item.id === proposal.id ? proposal : item); }
