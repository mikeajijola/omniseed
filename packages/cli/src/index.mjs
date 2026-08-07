#!/usr/bin/env node
import fs from 'node:fs'; import path from 'node:path';
import {validateDefinition,evaluateCapabilities,createPlan,applyPlan} from '../../core/src/index.mjs';
const args=process.argv.slice(2), command=args[0]||'help', target=args.find(a=>!a.startsWith('-')&&a!==command)||'.', json=args.includes('--json');
const read=(name,fallback={})=>{const file=path.join(target,name);return fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):fallback};
const definition=()=>read('company.json'); const deployment=()=>read('deployment-state.json',{version:0,resources:{}});
let output;
if(command==='init') output={created:false,message:'Create company.json, deployment-state.json, and proposals.json in an empty directory'};
else if(command==='validate') output=validateDefinition(definition());
else if(command==='plan') output=createPlan(definition(),deployment(),read('proposals.json'));
else if(command==='apply'){const plan=createPlan(definition(),deployment(),read('proposals.json'));output=applyPlan(plan,deployment(),args.includes('--approve-all')?plan.changes.map(c=>c.id):[])}
else if(command==='state'||command==='inspect') output={deployment:deployment(),capabilities:evaluateCapabilities(definition(),deployment())};
else if(command==='drift') output={drift:[],capabilities:evaluateCapabilities(definition(),deployment())};
else output={commands:['init','validate','plan','apply','state','inspect','drift'],note:'Use --json for stable machine output; apply requires --approve-all in this development CLI.'};
process.stdout.write(json?`${JSON.stringify(output,null,2)}\n`:`${format(output)}\n`);
function format(value){return Object.entries(value).map(([key,item])=>`${key}: ${typeof item==='object'?JSON.stringify(item):item}`).join('\n')}
if(output?.valid===false) process.exitCode=1;
