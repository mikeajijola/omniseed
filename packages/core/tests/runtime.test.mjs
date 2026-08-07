import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {OmniSeedRuntime,RUNTIME_OPERATIONS} from '../src/runtime.mjs';
const read=name=>JSON.parse(fs.readFileSync(new URL(`../../../examples/minimal/${name}`,import.meta.url)));
test('runtime exposes the required domain operations',()=>assert.deepEqual(RUNTIME_OPERATIONS,['getRuntimeStatus','getCompany','listCapabilities','getCapability','listGaps','getCurrentPlan','generatePlan','cancelPlan','getState','listActivity','listObservations','listFindings','applyPlan']));
test('live lifecycle is missing, planned, approved, applied, realised, and event-backed',async()=>{
 let tick=0;const runtime=new OmniSeedRuntime({definition:read('company.json'),deployment:read('deployment-state.json'),clock:()=>`2026-01-01T00:00:0${tick++}.000Z`});
 assert.equal((await runtime.invoke('getCapability',{id:'customer_support'})).state,'missing');
 assert.equal((await runtime.invoke('listObservations'))[0].execution.status,'satisfied');
 const plan=await runtime.invoke('generatePlan',{definition:read('company-with-support.json')});assert.equal(plan.changes[0].resource.id,'support_agent');
 await assert.rejects(runtime.invoke('applyPlan',{planId:plan.id,approvedChangeIds:[plan.changes[0].id]}),/authorization/);
 const result=await runtime.invoke('applyPlan',{planId:plan.id,approvedChangeIds:[plan.changes[0].id],authorization:{actorId:'developer',permissions:['apply_plan']}});
 assert.equal(result.capabilities.find(item=>item.id==='customer_support').state,'realised');
 assert.deepEqual((await runtime.invoke('listActivity')).slice(-5).map(item=>item.type),['plan.approved','apply.started','resource.created','state.updated','capability.changed']);
});
