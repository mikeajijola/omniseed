import {validateDefinition,evaluateCapabilities,createPlan,applyPlan,event} from './index.mjs';
import {executeObservations} from './observations.mjs';
import {discoverOperations,DeterministicIntentResolver} from './control-plane.mjs';
import {compileOmniform,CORE_OPERATION_CATALOG,operationIndex,operationToolDefinitions} from './compiler.mjs';

export const RUNTIME_OPERATIONS=['getRuntimeStatus','getCapabilityRegistry','listOperations','describeOperation','getAgentTools','executeOperation','discoverOperations','resolveIntent','getCompany','listCapabilities','getCapability','listGaps','getCurrentPlan','generatePlan','cancelPlan','getState','getInfrastructure','listActivity','listObservations','listFindings','applyPlan'];

export class OmniSeedRuntime {
  constructor({definition,deployment={version:0,resources:{}},clock=()=>new Date().toISOString(),semanticEvaluator}={}) {
    const validation=validateDefinition(definition); if(!validation.valid) throw new Error(`Invalid Omniform definition: ${JSON.stringify(validation.errors)}`);
    this.definition=structuredClone(definition);this.deployment=structuredClone(deployment);this.clock=clock;this.semanticEvaluator=semanticEvaluator;this.intentResolver=new DeterministicIntentResolver();
    this.plan=null;this.activity=[];this.findings=[];this.observationExecutions=[];this.operationRegistry=compileOmniform(CORE_OPERATION_CATALOG,{handlers:{get_capability:implemented(input=>this.getCapability(input),'omniseed-core','getCapability'),generate_plan:implemented(input=>this.generatePlan(input),'omniseed-core','generatePlan'),apply_plan:implemented(input=>this.applyPlan(input),'omniseed-core','applyPlan')}});
    this.record('definition.loaded',{company:this.definition.company.id});this.record('definition.validated',{valid:true});this.refresh();
  }
  record(type,data){const item=event(type,data,this.clock());this.activity.push(item);return item}
  refresh(){this.capabilities=evaluateCapabilities(this.definition,this.deployment);this.observationExecutions=executeObservations(this.definition,this.deployment,this.semanticEvaluator)}
  async invoke(operation,input={}) {
    if(!RUNTIME_OPERATIONS.includes(operation)) throw Object.assign(new Error(`Unknown runtime operation: ${operation}`),{statusCode:404});
    return this[operation](input);
  }
  getRuntimeStatus(){return {mode:'live',reachable:true,persistence:'memory',version:'0.1.0'}}
  getCapabilityRegistry(){return operationIndex(this.operationRegistry)}
  listOperations({interface:surface}={}){return this.operationRegistry.list({interface:surface})}
  describeOperation({id}){return this.operationRegistry.get(id)}
  getAgentTools(){return operationToolDefinitions(this.operationRegistry)}
  executeOperation({id,input={},authorization}={}){return this.operationRegistry.execute(id,input,{authorization:{...authorization,approved:id==='apply_plan'&&Boolean(input.approvedChangeIds?.length)}})}
  discoverOperations({interface:surface}={}){const canonical={lily:'agent',ui:'human',controller:'machine'}[surface]||surface;const generated=this.operationRegistry.list({interface:canonical});const legacy=discoverOperations({interface:surface}).filter(item=>!this.operationRegistry.get(item.id));return [...generated,...legacy]}
  resolveIntent({utterance}){return this.intentResolver.resolve(utterance,{capabilities:this.listCapabilities(),resources:this.definition.company.resources||[]},this.discoverOperations({interface:'lily'}))}
  getCompany(){return {id:this.definition.company.id,name:this.definition.company.name,purpose:this.definition.company.purpose}}
  listCapabilities(){return Object.values(this.capabilities)}
  getCapability({id}){return this.capabilities[id]||null}
  listGaps(){return Object.values(this.capabilities).filter(item=>item.required&&item.state!=='realised')}
  getCurrentPlan(){return this.plan}
  generatePlan({definition}={}) {
    if(definition){const validation=validateDefinition(definition);if(!validation.valid)throw Object.assign(new Error('Invalid proposed definition'),{statusCode:400,details:validation.errors});this.definition=structuredClone(definition);this.record('definition.loaded',{company:this.definition.company.id,proposed:true});}
    const proposals=Object.fromEntries((this.definition.company.resources||[]).filter(resource=>!this.deployment.resources?.[resource.id]).flatMap(resource=>(resource.realises||[]).map(capability=>[capability,resource])));
    this.plan=createPlan(this.definition,this.deployment,proposals);this.plan.changes=this.plan.changes.map(change=>({...change,reason:`${change.capability} is required and has no active realisation`}));
    this.record('plan.created',{plan:this.plan.id,changes:this.plan.changes.map(change=>change.id)});return this.plan;
  }
  cancelPlan({planId,authorization}={}) {
    if(!this.plan||this.plan.id!==planId)throw Object.assign(new Error('Current plan not found'),{statusCode:409});
    if(authorization?.actorId===undefined||!authorization.permissions?.includes('approve_plan'))throw Object.assign(new Error('approve_plan authorization required'),{statusCode:403});
    const cancelled=this.plan;this.record('plan.rejected',{plan:cancelled.id,actor:authorization.actorId});this.plan=null;return {cancelled:true,planId:cancelled.id};
  }
  getState(){return {deployment:structuredClone(this.deployment),capabilities:this.listCapabilities(),observations:this.listObservations()}}
  getInfrastructure(){return (this.definition.company.resources||[]).map(resource=>({id:resource.id,name:resource.name||resource.id,type:resource.type,capabilityIds:resource.realises||[],provider:Object.keys(resource.provider||{})[0]||'local',providerId:this.deployment.resources?.[resource.id]?.providerId||null,status:this.deployment.resources?.[resource.id]?.status||'absent'}))}
  listActivity(){return structuredClone(this.activity)}
  listObservations(){return (this.definition.company.observations||[]).map(definition=>({definition,execution:this.observationExecutions.find(item=>item.observationId===definition.id)||null}))}
  listFindings(){return structuredClone(this.findings)}
  applyPlan({planId,approvedChangeIds=[],authorization}={}) {
    if(!this.plan||this.plan.id!==planId)throw Object.assign(new Error('Current plan not found'),{statusCode:409});
    if(authorization?.actorId===undefined||!authorization.permissions?.includes('apply_plan'))throw Object.assign(new Error('apply_plan authorization required'),{statusCode:403});
    const approved=this.plan.changes.filter(change=>approvedChangeIds.includes(change.id));
    this.record('plan.approved',{plan:this.plan.id,actor:authorization.actorId,changes:approved.map(change=>change.id)});this.record('apply.started',{plan:this.plan.id});
    const before=structuredClone(this.capabilities);const result=applyPlan(this.plan,this.deployment,approvedChangeIds);this.deployment=result.state;
    for(const change of approved)if(change.action==='create')this.record('resource.created',{resource:change.resource.id,capability:change.capability,providerId:this.deployment.resources[change.resource.id].providerId});
    this.record('state.updated',{version:this.deployment.version,plan:this.plan.id});this.refresh();
    for(const capability of Object.values(this.capabilities))if(before[capability.id]?.state!==capability.state)this.record('capability.changed',{capability:capability.id,from:before[capability.id]?.state,to:capability.state});
    return {...result,capabilities:this.listCapabilities(),activity:this.listActivity()};
  }
}
function implemented(fn,implementedBy,runtimeOperation){return Object.assign(fn,{implementedBy,runtimeOperation})}
