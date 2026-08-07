import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createSQLiteStores} from '../../core/src/sqlite-stores.mjs';

test('successful apply survives a runtime process restart',async()=>{
  const data=await fs.mkdtemp(path.join(os.tmpdir(),'omniseed-restart-')),port=18877,url=`http://127.0.0.1:${port}`;
  let child;
  try {
    child=await start(data,port);
    assert.equal((await invoke(url,'getCapability',{id:'customer_support'})).state,'missing');
    const definition=JSON.parse(await fs.readFile('examples/minimal/company-with-support.json'));
    const plan=await invoke(url,'generatePlan',{definition});
    await invoke(url,'applyPlan',{planId:plan.id,approvedChangeIds:plan.changes.map(change=>change.id),authorization:{actorId:'restart-test',permissions:['apply_plan']}});
    assert.equal((await invoke(url,'getCapability',{id:'customer_support'})).state,'realised');
    await stop(child);child=undefined;
    child=await start(data,port);
    assert.equal((await invoke(url,'getCapability',{id:'customer_support'})).state,'realised');
    const stores=await createSQLiteStores({file:path.join(data,'omniseed.db')});
    assert.equal((await stores.stateStore.loadVersion('acme',2)).resources.support_agent.status,'active');
    assert.ok((await stores.metadataStore.list('acme','events')).some(event=>event.type==='capability.changed'));
    await stores.repository.close();
  } finally {
    if(child)await stop(child);
    await fs.rm(data,{recursive:true,force:true});
  }
});

async function start(data,port){
  const child=spawn(process.execPath,['packages/runtime/src/server.mjs'],{env:{...process.env,PORT:String(port),OMNISEED_DATA_DIR:data},stdio:['ignore','pipe','pipe']});
  for(let i=0;i<50;i++){try{if((await fetch(`http://127.0.0.1:${port}/health`)).ok)return child}catch{}await new Promise(resolve=>setTimeout(resolve,100))}
  throw new Error('runtime did not start');
}
async function stop(child){if(child.exitCode!==null)return;child.kill('SIGTERM');await new Promise(resolve=>child.once('exit',resolve))}
async function invoke(url,operation,input={}){const response=await fetch(`${url}/operations/${operation}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)});const body=await response.json();if(!response.ok)throw new Error(body.error.message);return body.result}
