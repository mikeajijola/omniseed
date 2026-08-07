import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {MemoryStateStore,FileStateStore,FileDefinitionStore,FileRuntimeMetadataStore} from '../src/stores.mjs';

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
