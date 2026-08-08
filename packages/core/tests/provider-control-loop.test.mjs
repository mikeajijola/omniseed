import test from 'node:test';
import assert from 'node:assert/strict';
import {createGitHubProvider} from '../../../providers/github/index.mjs';
import {applyExternalChange,importExternalResource,runProviderControlLoop,MockSemanticEvaluator} from '../src/index.mjs';

const resource={id:'company_repository',type:'github_repository',realises:['source_control'],provider:{github:{owner:'acme',name:'company',description:'Canonical company source',private:true,defaultBranch:'main'}}};

function providerFor(description='Changed outside OmniSeed') {
  const repository={id:42,name:'company',full_name:'acme/company',owner:{login:'acme'},private:true,description,default_branch:'main',archived:false,html_url:'https://github.com/acme/company'};
  return createGitHubProvider({clock:()=> '2026-08-07T12:00:00.000Z',fetch:async()=>new Response(JSON.stringify(repository),{status:200,headers:{'content-type':'application/json'}})});
}

test('external apply requires shared authorization and returns audit evidence',async()=>{
  const provider=providerFor('Canonical company source');const change={id:'create_company_repository',action:'create',resource};
  await assert.rejects(()=>applyExternalChange({provider,change,authorizedBy:{actorId:'operator',permissions:[]}}),/apply_plan/);
  const applied=await applyExternalChange({provider,change,authorizedBy:{actorId:'operator',permissions:['apply_plan']}});
  assert.equal(applied.result.providerId,'github:acme/company');assert.deepEqual(applied.audit,{actorId:'operator',changeId:'create_company_repository'});
});

test('GitHub observe produces drift, structured semantic finding, and authorized proposed response',async()=>{
  const provider=providerFor();
  const evaluator=new MockSemanticEvaluator([{id:'finding_repository_governance',summary:'Repository description no longer represents declared purpose',confidence:0.93,impact:'medium',urgency:'soon',recommendedResponse:'generate_plan'}]);
  const result=await runProviderControlLoop({provider,resource,deployedState:{providerId:'github:acme/company',status:'active'},semanticObservation:{id:'repository_governance',type:'semantic',capability:'source_control'},semanticEvaluator:evaluator});
  assert.equal(result.observation.evidence.length,1);assert.equal(result.drift.status,'drifted');assert.deepEqual(result.drift.differences,[{field:'description',desired:'Canonical company source',observed:'Changed outside OmniSeed'}]);
  assert.equal(result.findings[0].observationId,'repository_governance');assert.equal(result.findings[0].evidenceReferences[0],'provider:github:repository:acme/company');
  assert.equal(result.proposedResponses[0].action,'generate_plan');assert.equal(result.proposedResponses[0].authorization,'required');
  assert.deepEqual(result.events.map(item=>item.type),['provider.observed','drift.detected','semantic.finding.created','response.proposed']);
});

test('provider adoption is authorized and records an auditable external ID',async()=>{
  const adoptedResource={id:'os',type:'vercel_project',provider:{vercel:{name:'omniseed-os'}}};
  const provider={validate:async()=>({valid:true,errors:[]}),plan:async()=>({}),apply:async()=>({}),observe:async()=>({}),import:async()=>({providerId:'vercel:project:prj_os',status:'active',adopted:true})};
  await assert.rejects(importExternalResource({provider,resource:adoptedResource,externalResource:{externalId:'prj_os'},authorizedBy:{actorId:'lily',permissions:[]}}),/authorization/);
  const imported=await importExternalResource({provider,resource:adoptedResource,externalResource:{externalId:'prj_os'},authorizedBy:{actorId:'owner',permissions:['apply_plan']}});
  assert.equal(imported.result.adopted,true);assert.deepEqual(imported.audit,{actorId:'owner',resourceId:'os',externalId:'prj_os',action:'import'});
});
