import {CORE_OPERATION_CATALOG} from './compiler.mjs';
export const STEWARD_ACTOR_ID='company_steward';

export const OPERATION_REGISTRY=Object.freeze([
  operation('get_company','Understand the declared company.','getCompany',{permissions:['read_company'],interfaces:['ui','lily','api','cli','controller']}),
  operation('list_capabilities','Inspect calculated capability state.','listCapabilities',{permissions:['read_company'],interfaces:['ui','lily','api','cli','controller']}),
  operation('list_gaps','Find required capabilities without healthy realisation.','listGaps',{permissions:['read_company'],interfaces:['ui','lily','api','cli','controller']}),
  operation('inspect_plan','Review the current plan and its governance requirements.','getCurrentPlan',{permissions:['read_company'],interfaces:['ui','lily','api','cli','controller']}),
  operation('list_findings','Inspect structured findings.','listFindings',{permissions:['read_company'],interfaces:['ui','lily','api','cli','controller']}),
  operation('list_activity','Inspect audited organisational history.','listActivity',{permissions:['read_company'],interfaces:['ui','lily','api','cli','controller']}),
  operation('list_infrastructure','Discover resources and provider relationships subordinate to capabilities.','getInfrastructure',{permissions:['read_company'],interfaces:['ui','lily','api','cli','controller']}),
  operation('present_home','Project current company context.','presentHome',{permissions:['read_company'],interfaces:['ui','lily']}),
  operation('present_company','Project declared company context.','presentCompany',{permissions:['read_company'],interfaces:['ui','lily']}),
  operation('present_capability','Project capability context without changing state.','presentCapability',{permissions:['read_company'],inputs:{id:'capability_id'},interfaces:['ui','lily']}),
  operation('present_plan','Project the current plan.','presentPlan',{permissions:['read_company'],interfaces:['ui','lily']}),
  operation('present_observation','Project observation context.','presentObservation',{permissions:['read_company'],inputs:{id:'observation_id'},interfaces:['ui','lily']}),
  operation('present_finding','Project a structured finding.','presentFinding',{permissions:['read_company'],inputs:{id:'finding_id'},interfaces:['ui','lily']}),
  operation('present_evidence','Project evidence and provenance.','presentEvidence',{permissions:['read_company'],inputs:{id:'evidence_id'},interfaces:['ui','lily']}),
  operation('present_activity','Project company activity.','presentActivity',{permissions:['read_company'],interfaces:['ui','lily']}),
  operation('present_infrastructure','Project provider realisations subordinate to capabilities.','presentInfrastructure',{permissions:['read_company'],interfaces:['ui','lily']}),
  ...CORE_OPERATION_CATALOG.operations.map(item=>({...item,runtimeOperation:{get_capability:'getCapability',get_resource:'getResource',generate_plan:'generatePlan',apply_plan:'applyPlan',resolve_capability:'resolveCapability',get_capability_realisation:'getCapabilityRealisation',list_attention:'listAttention',accept_capability_gap:'acceptCapabilityGap'}[item.id],inputSchema:item.input,outputSchema:item.output,approvalRequired:item.approval.mode==='required',applicableTypes:item.applicableResourceTypes,interfaces:item.interfaces.map(surface=>({human:'ui',agent:'lily',machine:'controller'}[surface]||surface))}))
]);

function operation(id,description,runtimeOperation,options={}) {return {id,name:id.split('_').map(title).join(' '),description,runtimeOperation,permissions:[],inputs:{},outputs:{type:'structured'},risk:'none',mutation:false,approvalRequired:false,applicableTypes:['company'],interfaces:['api'],...options}}
function title(value){return value.charAt(0).toUpperCase()+value.slice(1)}

export function discoverOperations({interface:surface}={}) {return structuredClone(surface?OPERATION_REGISTRY.filter(item=>item.interfaces.includes(surface)):OPERATION_REGISTRY)}

export class DeterministicIntentResolver {
  async resolve(utterance,companyContext={},availableCapabilities=OPERATION_REGISTRY,interactionContext={}) {
    const text=String(utterance||'').trim();const normalized=text.toLowerCase();const available=new Set(availableCapabilities.map(item=>item.id));
    if(!text)return result('clarification_required',{clarification:'What would you like to build, understand, or change?'});
    const entity=resolveEntity(normalized,companyContext,interactionContext);if(entity.ambiguous)return result('clarification_required',{intent:'entity_reference',candidateOperations:[],entities:entity.matches,clarification:`I found more than one ${entity.label}. Which one do you mean?`});
    if(/what can (you|omniseed) do|available operations/.test(normalized))return result('resolved',{intent:'discover_operations',candidateOperations:[...available]});
    if(entity.match&&/remove|disconnect|delete/.test(normalized))return result('resolved',{intent:'change_resource',target:entity.match.id,targetType:entity.match.entityType,candidateOperations:allowed(['get_resource','generate_plan'],available),requiresApproval:true,impactCapabilities:entity.match.realises||entity.match.capabilityIds||[]});
    if(/delete|destroy|remove/.test(normalized)&&!specificTarget(normalized,companyContext.resources))return result('clarification_required',{intent:'remove_resource',candidateOperations:['generate_plan'],clarification:'Which specific resource do you mean? No destructive plan has been generated.'});
    const target=findCapability(normalized,companyContext.capabilities||[]);
    if(/go ahead|apply|do it|fix it|can you fix/.test(normalized))return result('resolved',{intent:'request_execution',target:target?.id,candidateOperations:allowed(['inspect_plan','apply_plan'],available),requiresApproval:true});
    if(/i need|want .*able to|how would|plan|what should we do|sort out|improve|fix/.test(normalized))return result('resolved',{intent:'realise_capability',target:target?.id,candidateOperations:allowed(['get_capability','resolve_capability','generate_plan','present_plan'],available)});
    if(/infrastructure|supporting|running on|depend on/.test(normalized))return result('resolved',{intent:'inspect_infrastructure',target:target?.id,candidateOperations:allowed(['list_infrastructure','present_capability'],available)});
    if(/changed|happened/.test(normalized))return result('resolved',{intent:'inspect_activity',candidateOperations:allowed(['list_activity','present_activity'],available)});
    if(/wrong|attention|missing|degraded/.test(normalized))return result('resolved',{intent:'inspect_gaps',target:target?.id,candidateOperations:allowed(['list_attention','list_gaps','list_findings','present_capability'],available)});
    if(/show me|why|capabilit/.test(normalized))return result('resolved',{intent:'inspect_capability',target:target?.id,candidateOperations:allowed(['get_capability','list_capabilities','present_capability'],available)});
    if(entity.match)return result('resolved',{intent:'inspect_entity',target:entity.match.id,targetType:entity.match.entityType,candidateOperations:allowed([entity.match.entityType==='capability'?'get_capability':'get_resource'],available),entity:entity.match});
    return result('unsupported',{intent:'unknown',candidateOperations:[],clarification:'I cannot map that request to an available governed capability yet.'});
  }
}

function result(status,fields={}){return {status,requiresClarification:status==='clarification_required',...fields}}
function allowed(ids,available){return ids.filter(id=>available.has(id))}
function findCapability(text,capabilities){return capabilities.find(item=>text.includes(item.id.replaceAll('_',' '))||text.includes(String(item.name||'').toLowerCase()))}
function specificTarget(text,resources=[]){return resources.filter(item=>text.includes(item.id.replaceAll('_',' '))||text.includes(String(item.name||'').toLowerCase())).length===1}
function resolveEntity(text,context,interaction){const selected=interaction.selectedResource||interaction.selectedCapability||interaction.currentFinding;if(/\b(this|it|that)\b/.test(text)&&selected)return {match:typeof selected==='string'?entityById(selected,context):selected};const raw=[...(context.capabilities||[]).map(item=>({...item,entityType:'capability'})),...(context.resources||[]).map(item=>({...item,entityType:item.category||item.type||'resource'})),...(context.skills||[]).map(item=>({...item,entityType:'skill'})),...(context.connectors||[]).map(item=>({...item,entityType:'connector'})),...(context.workflows||[]).map(item=>({...item,entityType:'workflow'})),...(context.schedules||[]).map(item=>({...item,entityType:'schedule'})),...(context.providers||[]).map(item=>({...item,entityType:'provider'})),...(context.findings||[]).map(item=>({...item,entityType:'finding'})),...(context.observations||[]).map(item=>({...item,entityType:'observation'})),...(interaction.visibleEntities||[])],entities=[...new Map(raw.map(item=>[item.id,item])).values()];const matches=entities.filter(item=>{const names=[item.id,item.name,item.label].filter(Boolean).map(value=>String(value).toLowerCase().replaceAll('_',' '));return names.some(name=>text===name||text.includes(name)||name.startsWith(text))});if(matches.length===1)return {match:matches[0]};if(matches.length>1)return {ambiguous:true,matches:matches.map(item=>({id:item.id,name:item.name,entityType:item.entityType})),label:matches[0].entityType};return {match:null}}
function entityById(id,context){for(const group of ['capabilities','resources','skills','connectors','workflows','schedules','providers','findings','observations']){const match=(context[group]||[]).find(item=>item.id===id);if(match)return {...match,entityType:group==='capabilities'?'capability':match.category||match.type||group.slice(0,-1)}}return null}

export function stewardIdentity({displayName='Lily',voice='system',presentation={}}={}) {return {actorId:STEWARD_ACTOR_ID,displayName,voice,presentation}}

export function organisationalLearning(input) {
  if(!input?.id||!input.statement||!input.source||!input.learnedAt)throw new Error('Learning requires id, statement, source, and learnedAt');
  return {id:input.id,statement:input.statement,capabilityIds:input.capabilityIds||[],evidenceReferences:input.evidenceReferences||[],confidence:input.confidence??0,source:input.source,validationStatus:input.validationStatus||'candidate',learnedAt:input.learnedAt};
}
