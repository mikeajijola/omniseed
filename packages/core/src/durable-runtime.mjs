import {OmniSeedRuntime} from './runtime.mjs';
export class DurableOmniSeedRuntime extends OmniSeedRuntime {
  static async open({companyId,definitionStore,stateStore,metadataStore,bootstrapDefinition,bootstrapState,clock,semanticEvaluator}){
    let definition=await definitionStore.load(companyId);if(!definition&&bootstrapDefinition){definition=bootstrapDefinition;await definitionStore.save(companyId,definition)}if(!definition)throw new Error(`Company definition not found: ${companyId}`);
    let deployment=await stateStore.load(companyId);if(!deployment){deployment=bootstrapState||{version:0,resources:{}};await stateStore.save(companyId,deployment)}
    return new DurableOmniSeedRuntime({definition,deployment,companyId,definitionStore,stateStore,metadataStore,clock,semanticEvaluator});
  }
  constructor(options){super(options);Object.assign(this,{companyId:options.companyId,definitionStore:options.definitionStore,stateStore:options.stateStore,metadataStore:options.metadataStore})}
  async generatePlan(input={}){const result=super.generatePlan(input);if(input.definition)await this.definitionStore.save(this.companyId,this.definition);return result}
  async applyPlan(input={}){const result=super.applyPlan(input);await this.stateStore.save(this.companyId,this.deployment);await this.metadataStore?.append(this.companyId,'applies',{version:this.deployment.version,planId:this.deployment.lastAppliedPlan,approvedBy:input.authorization.actorId,approvedChangeIds:input.approvedChangeIds,timestamp:this.clock()});return result}
}
