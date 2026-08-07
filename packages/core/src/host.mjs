import {DurableOmniSeedRuntime} from './durable-runtime.mjs';import {FoundingService,proposalToOmniform} from './founding.mjs';
export const FOUNDING_OPERATIONS=['startFoundingSession','submitFounderIntent','getFoundingDraft','refineFoundingDraft','acceptDraftItem','rejectDraftItem','updateDraftItem','addDraftItem','explainFoundingItem','validateFoundingDraft','commitFoundingDraft','loadCompany'];
export class OmniSeedHost {
  static async open(options){const host=new OmniSeedHost(options);await host.load(options.companyId,options.bootstrapDefinition,options.bootstrapState);return host}
  constructor({definitionStore,stateStore,metadataStore,foundingService=new FoundingService(),clock}={}){Object.assign(this,{definitionStore,stateStore,metadataStore,foundingService,clock})}
  async load(companyId,bootstrapDefinition,bootstrapState){this.runtime=await DurableOmniSeedRuntime.open({companyId,definitionStore:this.definitionStore,stateStore:this.stateStore,metadataStore:this.metadataStore,bootstrapDefinition,bootstrapState,clock:this.clock});this.companyId=companyId;return this.runtime.getCompany()}
  async invoke(operation,input={}){
    if(!FOUNDING_OPERATIONS.includes(operation))return this.runtime.invoke(operation,input);
    if(operation==='loadCompany')return this.load(input.companyId);
    if(operation==='startFoundingSession')return this.foundingService.startFoundingSession(input);
    if(operation==='submitFounderIntent')return this.foundingService.submitFounderIntent(input);
    if(operation==='getFoundingDraft')return this.foundingService.getFoundingDraft(input);
    if(operation==='refineFoundingDraft')return this.foundingService.refineFoundingDraft(input);
    if(operation==='acceptDraftItem')return this.foundingService.updateDraftItem({...input,status:'accepted'});
    if(operation==='rejectDraftItem')return this.foundingService.updateDraftItem({...input,status:'rejected'});
    if(operation==='updateDraftItem')return this.foundingService.updateDraftItem({...input,status:'edited'});
    if(operation==='addDraftItem')return this.foundingService.addDraftItem(input);
    if(operation==='explainFoundingItem')return this.foundingService.explainFoundingItem(input);
    if(operation==='validateFoundingDraft')return this.foundingService.validateFoundingDraft(input);
    if(operation==='commitFoundingDraft')return this.commitFoundingDraft(input);
  }
  async commitFoundingDraft({sessionId,authorization}={}){
    if(!authorization?.actorId||!authorization.permissions?.includes('commit_company'))throw Object.assign(new Error('commit_company authorization required'),{statusCode:403});
    const session=this.foundingService.require(sessionId),validation=this.foundingService.validateFoundingDraft({sessionId});if(!validation.valid)throw Object.assign(new Error('Founding draft is invalid'),{statusCode:400,details:validation.errors});
    const definition=proposalToOmniform(session.proposal),companyId=definition.company.id;if(await this.definitionStore.load(companyId))throw Object.assign(new Error('Company already exists'),{statusCode:409});await this.definitionStore.save(companyId,definition);const initial={version:0,resources:{},lastAppliedPlan:null};await this.stateStore.save(companyId,initial);await this.metadataStore?.append(companyId,'founding',{version:session.proposal.version,sessionId,committedBy:authorization.actorId,timestamp:this.clock?.()||new Date().toISOString(),assumptions:session.proposal.assumptions,openQuestions:session.proposal.openQuestions});
    session.status='committed';this.foundingService.event(session,'founding.committed',{sessionId,companyId,actorId:authorization.actorId});await this.load(companyId);this.runtime.record('founding.committed',{sessionId,companyId,actor:authorization.actorId});this.runtime.record('company.created',{companyId});this.runtime.record('state.initialized',{companyId,version:0});const plan=await this.runtime.generatePlan();return {company:this.runtime.getCompany(),definition,capabilities:this.runtime.listCapabilities(),gaps:this.runtime.listGaps(),plan,session:{id:session.id,status:session.status}};
  }
}
