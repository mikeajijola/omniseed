import crypto from 'node:crypto';

export const WELL_KNOWN_OBSERVATION_TYPES=['metric','event','semantic','assertion','external-state'];

export function evaluateAssertion(observation,deployment) {
  const resource=deployment.resources?.[observation.condition?.resource];
  const satisfied=resource?.status===observation.condition?.state;
  return {
    id:`execution_${observation.id}_${deployment.version||0}`,
    observationId:observation.id,
    capabilityId:observation.capability,
    type:'assertion',
    status:satisfied?'satisfied':'unsatisfied',
    evidenceReferences:resource?[`resource:${observation.condition.resource}`]:[],
    evaluator:{name:'omniseed.assertion',version:'0.1.0'}
  };
}

export function executeObservations(definition,deployment,semanticEvaluator) {
  return (definition.company.observations||[]).map(observation=>{
    if(observation.type==='assertion') return evaluateAssertion(observation,deployment);
    if(observation.type==='semantic') return {observationId:observation.id,capabilityId:observation.capability,type:'semantic',status:semanticEvaluator?'ready':'unsupported',evidenceReferences:[],evaluator:{name:'semantic-boundary',version:'0.1.0'}};
    return {observationId:observation.id,capabilityId:observation.capability,type:observation.type,status:'unsupported',evidenceReferences:[],evaluator:{name:'none',version:'0'}};
  });
}

export class MockSemanticEvaluator {
  constructor(findings=[]){this.findings=findings}
  async evaluate(observation,evidence) {
    return this.findings.map((finding,index)=>({
      id:finding.id||`finding_${crypto.createHash('sha256').update(`${observation.id}:${index}`).digest('hex').slice(0,12)}`,
      observationId:observation.id,capabilityId:observation.capability,summary:finding.summary,
      confidence:finding.confidence??1,evidenceReferences:evidence.map(item=>item.id),impact:finding.impact||'none',
      urgency:finding.urgency||'routine',recommendedResponse:finding.recommendedResponse||'none',
      timestamp:finding.timestamp||'1970-01-01T00:00:00.000Z',evaluator:{name:'mock-semantic-evaluator',version:'0.1.0'}
    }));
  }
}
