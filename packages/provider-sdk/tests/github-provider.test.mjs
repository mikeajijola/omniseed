import test from 'node:test';
import assert from 'node:assert/strict';
import {createGitHubProvider} from '../../../providers/github/index.mjs';

const resource={id:'company_repository',type:'github_repository',provider:{github:{owner:'acme',name:'company',description:'Company source',private:true,defaultBranch:'main'}}};

function fakeGitHub() {
  const calls=[];let repository={id:42,name:'company',full_name:'acme/company',owner:{login:'acme'},private:true,description:'Company source',default_branch:'main',archived:false,html_url:'https://github.com/acme/company'};
  return {calls,setDescription(value){repository={...repository,description:value}},fetch:async(url,options={})=>{
    calls.push({url,options});
    if(options.method==='POST') return new Response(JSON.stringify(repository),{status:201,headers:{'content-type':'application/json'}});
    return new Response(JSON.stringify(repository),{status:200,headers:{'content-type':'application/json'}});
  }};
}

test('GitHub provider creates and observes a repository through the provider contract',async()=>{
  const github=fakeGitHub();const provider=createGitHubProvider({token:'test-token',fetch:github.fetch,clock:()=> '2026-08-07T12:00:00.000Z'});
  assert.deepEqual(await provider.validate(resource),{valid:true,errors:[]});
  const plan=await provider.plan({id:'create_company_repository',action:'create',resource});assert.equal(plan.externalType,'github_repository');assert.equal(plan.requiresAuthorization,true);
  const applied=await provider.apply({id:'create_company_repository',action:'create',resource});assert.equal(applied.providerId,'github:acme/company');
  const observed=await provider.observe(resource,applied);assert.equal(observed.external.defaultBranch,'main');assert.equal(observed.evidence[0].id,'provider:github:repository:acme/company');
  assert.equal(github.calls[0].url,'https://api.github.com/orgs/acme/repos');assert.equal(github.calls[1].url,'https://api.github.com/repos/acme/company');
  assert.equal(github.calls[0].options.headers.Authorization,'Bearer test-token');assert.equal(JSON.stringify(applied).includes('test-token'),false);assert.equal(JSON.stringify(observed).includes('test-token'),false);
});

test('GitHub provider rejects unsupported resources before HTTP I/O',async()=>{
  const github=fakeGitHub();const provider=createGitHubProvider({fetch:github.fetch});
  const validation=await provider.validate({id:'x',type:'agent'});assert.equal(validation.valid,false);assert.equal(github.calls.length,0);
});
