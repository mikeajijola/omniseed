import crypto from 'node:crypto';
import {assertProvider} from '../../provider-sdk/src/index.mjs';

const idFor=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0,12);

export async function applyExternalChange({provider,change,authorizedBy}) {
  assertProvider(provider);
  if(!authorizedBy?.actorId||!authorizedBy.permissions?.includes('apply_plan')) throw Object.assign(new Error('apply_plan authorization required'),{statusCode:403});
  const validation=await provider.validate(change.resource);
  if(!validation.valid) throw Object.assign(new Error('Provider resource validation failed'),{statusCode:400,details:validation.errors});
  const providerPlan=await provider.plan(change);
  const result=await provider.apply(change);
  return {providerPlan,result,audit:{actorId:authorizedBy.actorId,changeId:change.id}};
}

export async function observeExternalResource({provider,resource,deployedState}) {
  assertProvider(provider);
  return provider.observe(resource,deployedState);
}

export function detectProviderDrift({resource,deployedState,observation}) {
  const desired=resource.provider?.github||{};const actual=observation.external||{};const differences=[];
  for(const [desiredField,actualField] of [['name','name'],['description','description'],['private','private'],['defaultBranch','defaultBranch'],['archived','archived']]) {
    if(desired[desiredField]!==undefined&&desired[desiredField]!==actual[actualField]) differences.push({field:desiredField,desired:desired[desiredField],observed:actual[actualField]});
  }
  const status=deployedState?.status&&observation.status!==deployedState.status?{field:'status',desired:deployedState.status,observed:observation.status}:null;
  if(status) differences.push(status);
  return {id:`drift_${idFor({resource:resource.id,differences})}`,resourceId:resource.id,status:differences.length?'drifted':'in-sync',differences,evidenceReferences:(observation.evidence||[]).map(item=>item.id)};
}

export async function evaluateSemanticObservation({observation,evidence,evaluator,clock=()=>new Date().toISOString()}) {
  if(observation.type!=='semantic') throw new Error('Semantic evaluation requires a semantic observation');
  const findings=await evaluator.evaluate(observation,evidence);
  return findings.map(finding=>({...finding,timestamp:finding.timestamp||clock()}));
}

export function proposeFindingResponses(findings) {
  return findings.filter(finding=>finding.recommendedResponse&&finding.recommendedResponse!=='none').map(finding=>({
    id:`response_${idFor({finding:finding.id,response:finding.recommendedResponse})}`,
    findingId:finding.id,capabilityId:finding.capabilityId,type:'proposed',action:finding.recommendedResponse,
    authorization:'required',reason:finding.summary,evidenceReferences:finding.evidenceReferences
  }));
}

export async function runProviderControlLoop({provider,resource,deployedState,semanticObservation,semanticEvaluator,clock}) {
  const observation=await observeExternalResource({provider,resource,deployedState});
  const drift=detectProviderDrift({resource,deployedState,observation});
  const findings=semanticObservation&&semanticEvaluator?await evaluateSemanticObservation({observation:semanticObservation,evidence:observation.evidence||[],evaluator:semanticEvaluator,clock}):[];
  const proposedResponses=proposeFindingResponses(findings);
  return {observation,drift,findings,proposedResponses,events:[
    {type:'provider.observed',data:{resource:resource.id,evidence:observation.evidence?.map(item=>item.id)||[]}},
    ...(drift.status==='drifted'?[{type:'drift.detected',data:{resource:resource.id,drift:drift.id,differences:drift.differences}}]:[]),
    ...findings.map(finding=>({type:'semantic.finding.created',data:{finding:finding.id,observation:finding.observationId,capability:finding.capabilityId}})),
    ...proposedResponses.map(response=>({type:'response.proposed',data:{response:response.id,finding:response.findingId,authorization:response.authorization}}))
  ]};
}
