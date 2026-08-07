import crypto from 'node:crypto';

import {evaluateCapabilityCoverage} from './realisations.mjs';
export const CAPABILITY_STATES = ['missing','planned','partial','realised','degraded','blocked','deferred','gap_accepted','retryable','retired','unknown'];
export const ACTIONS = ['create','update','remove','replace','noop'];

export function validateDefinition(document) {
  const errors = [];
  if (document?.omniform !== '0.1') errors.push({path:'/omniform',message:'must equal 0.1'});
  const company = document?.company;
  if (!company?.id || !company?.name || !company?.purpose) errors.push({path:'/company',message:'id, name, and purpose are required'});
  if (!Array.isArray(company?.capabilities)) errors.push({path:'/company/capabilities',message:'must be an array'});
  for (const capability of company?.capabilities || []) if ('status' in capability) errors.push({path:`/company/capabilities/${capability.id}/status`,message:'calculated state cannot appear in desired configuration'});
  for (const observation of company?.observations || []) {
    if (!observation.id || !observation.type || !observation.capability || !observation.condition || !Object.keys(observation.condition).length) errors.push({path:`/company/observations/${observation.id||'unknown'}`,message:'id, extensible type, capability, and condition are required'});
  }
  return {valid:errors.length === 0,errors};
}

export function configurationHash(definition) {
  return crypto.createHash('sha256').update(JSON.stringify(definition)).digest('hex');
}

export function evaluateCapabilities(definition, deployment={resources:{}}, observations={}) {
  const resources = definition.company.resources || [];
  return Object.fromEntries(definition.company.capabilities.map(capability => {
    const candidates = resources.filter(resource => resource.realises?.includes(capability.id));
    const active = candidates.filter(resource => deployment.resources?.[resource.id]?.status === 'active');
    const degraded = active.some(resource => observations.resources?.[resource.id]?.health === 'degraded');
    const pending = candidates.some(resource => ['planned','pending'].includes(deployment.resources?.[resource.id]?.status));
    const coverage=evaluateCapabilityCoverage(capability,resources,deployment,observations);
    const legacyState=degraded ? 'degraded' : active.length === candidates.length && active.length ? 'realised' : active.length ? 'partial' : pending ? 'planned' : 'missing';
    const state=degraded?'degraded':coverage.state||legacyState;
    return [capability.id,{id:capability.id,name:capability.name,purpose:capability.purpose,state,required:capability.required,resources:candidates.map(r=>r.id),evidence:observations.capabilities?.[capability.id]?.evidence || [],requirements:coverage.requirements,coverage:coverage.coverage,missingRequirements:coverage.missingRequirements,humanDependencies:coverage.humanDependencies,autonomy:coverage.autonomy}];
  }));
}

export function createPlan(definition, deployment={resources:{}}, proposals={}) {
  const capabilities = evaluateCapabilities(definition,deployment);
  const changes = [];
  const unresolvedRequirements = [];
  for (const capability of Object.values(capabilities)) {
    if (capability.required && capability.state === 'missing') {
      const proposal = proposals[capability.id];
      if (proposal) changes.push({id:`create_${proposal.id}`,action:'create',resource:proposal,capability:capability.id,approval:'required',risk:'low',reversible:true});
      else unresolvedRequirements.push({type:'unresolved',capability:capability.id,reason:'No resource proposal realises this required capability'});
    }
  }
  return {id:`plan_${configurationHash({definition,deployment,proposals}).slice(0,12)}`,status:'proposed',changes,capabilityGaps:Object.values(capabilities).filter(c=>c.required&&c.state==='missing').map(c=>c.id),dependencies:[],approvals:changes.map(c=>c.id),risks:changes.map(c=>({change:c.id,level:c.risk})),humanActions:[],externalActions:[],unresolvedRequirements,summary:{create:changes.length,unresolved:unresolvedRequirements.length}};
}

export function applyPlan(plan, deployment={version:0,resources:{}}, approved=[]) {
  const next = structuredClone(deployment); next.resources ||= {};
  const results = [];
  for (const change of plan.changes) {
    if (!approved.includes(change.id)) { results.push({change:change.id,status:'pending_approval'}); continue; }
    if (change.action === 'create') { next.resources[change.resource.id]={status:'active',providerId:`local:${change.resource.id}`}; results.push({change:change.id,status:'applied'}); }
  }
  next.version=(deployment.version||0)+1; next.lastAppliedPlan=plan.id;
  return {state:next,results,summary:{applied:results.filter(r=>r.status==='applied').length,pending:results.filter(r=>r.status!=='applied').length,failed:0}};
}

export function event(type,data,at='1970-01-01T00:00:00.000Z') { return {specversion:'1.0',type,source:'omniseed',time:at,data}; }
export const EVENT_TYPES=['definition.loaded','definition.validated','plan.created','plan.approved','plan.rejected','apply.started','resource.created','resource.updated','resource.failed','provider.observed','state.updated','drift.detected','capability.changed','semantic.finding.created','response.proposed'];
export {WELL_KNOWN_OBSERVATION_TYPES,evaluateAssertion,executeObservations,MockSemanticEvaluator} from './observations.mjs';
export {MemoryStateStore,FileStateStore,MemoryDefinitionStore,FileDefinitionStore,MemoryRuntimeMetadataStore,FileRuntimeMetadataStore,HostedKeyValueClient,HostedDefinitionStore,HostedStateStore,HostedRuntimeMetadataStore} from './stores.mjs';
export {applyExternalChange,observeExternalResource,detectProviderDrift,evaluateSemanticObservation,proposeFindingResponses,runProviderControlLoop} from './provider-control-loop.mjs';
export {OPERATION_REGISTRY,STEWARD_ACTOR_ID,discoverOperations,DeterministicIntentResolver,stewardIdentity,organisationalLearning} from './control-plane.mjs';
export {CORE_OPERATION_CATALOG,compileOmniform,operationToolDefinitions,operationIndex,validateSchema} from './compiler.mjs';
export {CapabilityResolver,evaluateCapabilityCoverage,realisationAttempt,attentionItems} from './realisations.mjs';
