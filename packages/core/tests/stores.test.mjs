import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {MemoryStateStore,FileStateStore,FileDefinitionStore,FileRuntimeMetadataStore,HostedKeyValueClient,HostedDefinitionStore,HostedStateStore,HostedRuntimeMetadataStore} from '../src/stores.mjs';

for (const [name,create] of [['memory',async()=>new MemoryStateStore()],['file',async root=>new FileStateStore(root)]]) {
  test(`${name} state store versions portable snapshots`,async()=>{
    const root=await fs.mkdtemp(path.join(os.tmpdir(),'omniseed-store-'));
    try {
      const store=await create(root);
      await store.save('acme',{version:0,resources:{}});
      await store.save('acme',{version:1,resources:{support_agent:{status:'active'}}});
      assert.deepEqual(await store.listVersions('acme'),[0,1]);
      assert.equal((await store.loadVersion('acme',0)).resources.support_agent,undefined);
      assert.equal((await store.load('acme')).resources.support_agent.status,'active');
      await assert.rejects(store.save('acme',{version:2,apiToken:'secret'}),/secrets/);
    } finally { await fs.rm(root,{recursive:true,force:true}); }
  });
}

test('file layout separates definition, state history, and operational metadata',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'omniseed-layout-'));
  try {
    await new FileDefinitionStore(root).save('acme',{omniform:'0.1'});
    await new FileStateStore(root).save('acme',{version:0,resources:{}});
    await new FileRuntimeMetadataStore(root).append('acme','applies',{version:1,approvedBy:'founder'});
    for(const file of ['acme/company.json','acme/state/current.json','acme/state/history/0.json','acme/runtime/applies/00000001.json']) assert.ok((await fs.stat(path.join(root,file))).isFile());
  } finally { await fs.rm(root,{recursive:true,force:true}); }
});

test('hosted stores preserve definition, state history, and metadata separation',async()=>{const values=new Map(),commands=[];const fetchImpl=async(_url,{body})=>{const [operation,key,value]=JSON.parse(body);commands.push([operation,key]);if(operation==='GET')return {ok:true,json:async()=>({result:values.get(key)??null})};if(operation==='SET'){values.set(key,value);return {ok:true,json:async()=>({result:'OK'})}}throw new Error(operation)};const client=new HostedKeyValueClient({url:'https://store.invalid',token:'test-only',fetchImpl,prefix:'test'}),definitions=new HostedDefinitionStore(client),states=new HostedStateStore(client),metadata=new HostedRuntimeMetadataStore(client);await definitions.save('acme',{omniform:'0.1'});await states.save('acme',{version:0,resources:{}});await states.save('acme',{version:1,resources:{gmail:{status:'active'}}});await metadata.append('acme','events',{type:'state.updated'});assert.equal((await definitions.load('acme')).omniform,'0.1');assert.deepEqual(await states.listVersions('acme'),[0,1]);assert.equal((await states.loadVersion('acme',1)).resources.gmail.status,'active');assert.equal((await metadata.list('acme','events'))[0].type,'state.updated');assert.ok([...values.keys()].some(key=>key.includes(':definition')));assert.ok([...values.keys()].some(key=>key.includes(':state:history:1')));assert.ok([...values.keys()].some(key=>key.includes(':runtime:events')));assert.ok(commands.length>0)});
