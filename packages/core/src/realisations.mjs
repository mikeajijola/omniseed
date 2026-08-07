const TERMINAL=['realised','blocked','deferred','gap_accepted'];

export function evaluateCapabilityCoverage(capability,resources=[],deployment={resources:{}},observations={}) {
  const requirements=capability.requirements||[];
  const active=resources.filter(resource=>deployment.resources?.[resource.id]?.status==='active');
  const offered=new Map();
  for(const resource of active)for(const offering of resource.offers||[])if(!offered.has(offering))offered.set(offering,[]);else void 0;
  for(const resource of active)for(const offering of resource.offers||[])offered.get(offering).push(resource.id);
  const coverage=requirements.map(requirement=>({id:requirement.capability,required:requirement.required!==false,covered:offered.has(requirement.capability),resources:offered.get(requirement.capability)||[],humanAuthority:requirement.humanAuthority||null,evidence:observations.requirements?.[requirement.capability]?.evidence||[]}));
  const required=coverage.filter(item=>item.required);const missing=required.filter(item=>!item.covered);
  const accepted=Boolean(deployment.acceptedGaps?.[capability.id]);const deferred=Boolean(deployment.deferredCapabilities?.[capability.id]);
  const state=accepted?'gap_accepted':deferred?'deferred':!required.length?null:missing.length===0?'realised':missing.length===required.length?'missing':'partial';
  const humanDependencies=missing.filter(item=>item.humanAuthority).map(item=>({requirement:item.id,...item.humanAuthority}));
  const autonomous=required.filter(item=>item.covered&&!item.humanAuthority).length;
  return {requirements:coverage,coverage:{required:required.length,covered:required.length-missing.length,missing:missing.map(item=>item.id)},missingRequirements:missing,humanDependencies,autonomy:humanDependencies.length?'human_dependent':missing.length?'partially_autonomous':'fully_autonomous',state};
}

export class CapabilityResolver {
  resolve({capability,resources=[],providerOfferings=[],deployment={resources:{}},observations={},strategy={}}) {
    const coverage=evaluateCapabilityCoverage(capability,resources,deployment,observations);
    const candidates=providerOfferings.filter(candidate=>coverage.missingRequirements.some(requirement=>(candidate.offers||[]).includes(requirement.id))).map(candidate=>({...candidate,covers:coverage.missingRequirements.filter(requirement=>(candidate.offers||[]).includes(requirement.id)).map(item=>item.id)}));
    const preference=strategy.realisationPreference||[];
    candidates.sort((a,b)=>rank(a.category,preference)-rank(b.category,preference)||String(a.id).localeCompare(String(b.id)));
    return {capabilityId:capability.id,existingCoverage:coverage.coverage,missingRequirements:coverage.missingRequirements,candidateRealisations:candidates,recommendedRealisation:candidates[0]||null,unresolvedRequirements:coverage.missingRequirements.filter(requirement=>!candidates.some(candidate=>candidate.covers.includes(requirement.id))),clarification:null};
  }
}

export function realisationAttempt({capabilityId,number,design,result,reason,planId,evidenceReferences=[]}) {if(!capabilityId||!number||!result)throw new Error('Realisation attempt requires capability, number, and result');return {capabilityId,number,design,result,reason,planId,evidenceReferences,terminal:TERMINAL.includes(result)};}

export function attentionItems({capabilities=[],plan=null,findings=[],drift=[]}={}) {return [...capabilities.filter(item=>['missing','partial','degraded','blocked','retryable'].includes(item.state)).map(item=>({id:`capability:${item.id}`,type:'capability_gap',severity:item.state==='blocked'?'high':'medium',capabilityId:item.id,title:`${item.name} is ${item.state}`,reason:item.missingRequirements?.map(entry=>entry.id).join(', ')||'Required capability is not fully realised'})),...(plan?.changes?.length?[{id:`plan:${plan.id}`,type:'pending_approval',severity:'medium',title:'Plan awaiting review',planId:plan.id}]:[]),...findings.map(item=>({id:`finding:${item.id}`,type:'finding',severity:item.urgency||'medium',title:item.summary,findingId:item.id})),...drift.map(item=>({id:`drift:${item.id}`,type:'drift',severity:'high',title:item.summary||'External state drift detected'}))];}
function rank(category,preference){const index=preference.indexOf(category);return index<0?preference.length+1:index}
