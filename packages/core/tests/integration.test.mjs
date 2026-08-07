import test from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs';
import {evaluateCapabilities,createPlan,applyPlan,validateDefinition} from '../src/index.mjs';
const read=name=>JSON.parse(fs.readFileSync(new URL(`../../../examples/minimal/${name}`,import.meta.url)));
test('shared example moves Support from missing to realised through approved apply',()=>{
 const definition=read('company.json'),deployment=read('deployment-state.json'),proposals=read('proposals.json');
 assert.equal(validateDefinition(definition).valid,true);
 let capabilities=evaluateCapabilities(definition,deployment);
 assert.equal(capabilities.customer_research.state,'realised'); assert.equal(capabilities.customer_support.state,'missing');
 const plan=createPlan(definition,deployment,proposals); assert.equal(plan.changes[0].resource.id,'support_agent');
 const result=applyPlan(plan,deployment,[plan.changes[0].id]);
 definition.company.resources.push(proposals.customer_support);
 capabilities=evaluateCapabilities(definition,result.state); assert.equal(capabilities.customer_support.state,'realised');
});
test('unapproved changes remain pending',()=>{const plan=createPlan(read('company.json'),read('deployment-state.json'),read('proposals.json'));assert.equal(applyPlan(plan,read('deployment-state.json'),[]).summary.pending,1)});
