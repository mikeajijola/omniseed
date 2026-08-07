#!/usr/bin/env node
import fs from 'node:fs';import path from 'node:path';
import {validateDefinition,evaluateCapabilities,createPlan,applyPlan,compileOmniform,CORE_OPERATION_CATALOG} from '../../core/src/index.mjs';
const aliases={plan:'generate_plan',apply:'apply_plan','get-capability':'get_capability'};
const args=process.argv.slice(2),command=args[0]||'help',json=args.includes('--json'),operationId=command==='operation'?args[1]:aliases[command],targetArg=args.find((value,index)=>!value.startsWith('-')&&index>(command==='operation'?1:0)),target=targetArg||'.';
const read=(name,fallback={})=>{const file=path.join(target,name);return fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):fallback};const definition=()=>read('company.json');const deployment=()=>read('deployment-state.json',{version:0,resources:{}});
const registry=compileOmniform(CORE_OPERATION_CATALOG,{handlers:{get_capability:implemented(({id})=>evaluateCapabilities(definition(),deployment())[id]||null,'getCapability'),generate_plan:implemented(()=>createPlan(definition(),deployment(),read('proposals.json')),'generatePlan'),apply_plan:implemented(({approvedChangeIds})=>{const plan=createPlan(definition(),deployment(),read('proposals.json'));return applyPlan(plan,deployment(),approvedChangeIds)},'applyPlan')}});
let output;
if(operationId){const input=operationId==='get_capability'?{id:valueAfter('--id')}:operationId==='apply_plan'?{planId:'generated',approvedChangeIds:args.includes('--approve-all')?createPlan(definition(),deployment(),read('proposals.json')).changes.map(item=>item.id):[],authorization:{actorId:'cli',permissions:['apply_plan']}}:{};const permissions=registry.get(operationId)?.permissions||[];output=await registry.execute(operationId,input,{authorization:{actorId:'cli',permissions,approved:operationId!=='apply_plan'||args.includes('--approve-all')}})}
else if(command==='operations')output=registry.list().map(({id,version,description,available,interfaces,mutation,approval})=>({id,version,description,available,interfaces,mutation,approval}));
else if(command==='init')output={created:false,message:'Create company.json, deployment-state.json, and proposals.json in an empty directory'};
else if(command==='validate')output=validateDefinition(definition());
else if(command==='state'||command==='inspect')output={deployment:deployment(),capabilities:evaluateCapabilities(definition(),deployment())};
else if(command==='drift')output={drift:[],capabilities:evaluateCapabilities(definition(),deployment())};
else output={commands:['init','validate','plan','apply','get-capability','operations','operation','state','inspect','drift'],note:'Ergonomic aliases resolve to the generated Omniform operation registry. Use --json for stable output.'};
process.stdout.write(json?`${JSON.stringify(output,null,2)}\n`:`${format(output)}\n`);if(output?.valid===false)process.exitCode=1;
function valueAfter(flag){const index=args.indexOf(flag);return index>=0?args[index+1]:undefined}function implemented(fn,runtimeOperation){return Object.assign(fn,{implementedBy:'omniseed-cli',runtimeOperation})}function format(value){return Object.entries(value).map(([key,item])=>`${key}: ${typeof item==='object'?JSON.stringify(item):item}`).join('\n')}
