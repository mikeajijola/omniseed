import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {createSQLiteStores,SQLiteScheduleStore} from '../src/sqlite-stores.mjs';import {OmniSeedHost} from '../src/host.mjs';

const definition={omniform:'0.1',company:{id:'acme',name:'Acme',purpose:'Support customers',capabilities:[{id:'customer_support',name:'Customer Support',required:true}],resources:[{id:'gmail_connector',name:'Gmail Connector',category:'connector',realises:['customer_support'],offers:['receive_customer_request'],provider:{id:'mock-google'}}],schedules:[{id:'support_check',cadence:{type:'interval',duration:'PT1H'},invokes:{operation:'get_capability',input:{id:'customer_support'}}}]}};
const initial={version:0,resources:{gmail_connector:{status:'active',providerId:'mock:gmail'}}};

test('one SQLite database preserves company state, history, plans, events, founding, schedules, attempts, and learning',async()=>{const root=await fs.mkdtemp(path.join(os.tmpdir(),'omniseed-sqlite-')),file=path.join(root,'omniseed.db');try{
  let stores=await createSQLiteStores({file}),host=await OmniSeedHost.open({companyId:'acme',...stores,bootstrapDefinition:definition,bootstrapState:initial});
  await host.invoke('generatePlan');
  const session=await host.invoke('startFoundingSession');
  await stores.metadataStore.append('acme','realisation-attempts',{id:'attempt-1',capabilityId:'customer_support',status:'partial'});
  await stores.metadataStore.append('acme','organisational-learning',{id:'learning-1',statement:'Email is the current support intake.',capabilityId:'customer_support',evidenceReferences:['resource:gmail_connector'],confidence:0.9,validationStatus:'validated'});
  await stores.stateStore.save('acme',{...initial,version:1,lastAppliedPlan:'plan-1'});
  assert.equal((await new SQLiteScheduleStore(stores.repository).list('acme'))[0].id,'support_check');
  await stores.repository.close();
  stores=await createSQLiteStores({file});host=await OmniSeedHost.open({companyId:'acme',...stores});
  assert.equal((await host.invoke('resolveIntent',{utterance:'Gmail'})).target,'gmail_connector');
  assert.deepEqual(await stores.stateStore.listVersions('acme'),[0,1]);
  assert.ok((await stores.metadataStore.list('acme','events')).some(event=>event.type==='plan.created'));
  assert.ok(await host.invoke('getFoundingDraft',{sessionId:session.id}));
  assert.equal((await stores.metadataStore.list('acme','realisation-attempts'))[0].status,'partial');
  assert.equal((await stores.metadataStore.list('acme','organisational-learning'))[0].validationStatus,'validated');
  assert.equal((await new SQLiteScheduleStore(stores.repository).list('acme'))[0].runtime.status,'active');
  const tables=(await stores.repository.all("SELECT name FROM sqlite_master WHERE type='table'")).map(row=>row.name);for(const name of ['companies','definitions','capabilities','resources','state_versions','plans','plan_changes','applies','events','observations','findings','evidence','founding_sessions','schedules','realisation_attempts','organisational_learning'])assert.ok(tables.includes(name),name);
  await assert.rejects(stores.stateStore.save('acme',{version:2,apiToken:'not-portable'}),/secrets/);
  await stores.repository.close();
}finally{await fs.rm(root,{recursive:true,force:true})}});

test('SQLite schedule runtime records a due one-shot without a scheduler service',async()=>{const root=await fs.mkdtemp(path.join(os.tmpdir(),'omniseed-schedule-'));try{const scheduled={...definition,company:{...definition.company,schedules:[{id:'now',cadence:{type:'one-shot',at:'2025-01-01T00:00:00.000Z'},invokes:{operation:'get_capability',input:{id:'customer_support'}}}]}},stores=await createSQLiteStores({file:path.join(root,'db.sqlite')});await stores.definitionStore.save('acme',scheduled);const scheduleStore=new SQLiteScheduleStore(stores.repository),due=await scheduleStore.due('acme',new Date('2025-01-02T00:00:00.000Z'));assert.equal(due[0].id,'now');await scheduleStore.recordRun('acme',due[0],new Date('2025-01-02T00:00:00.000Z'));assert.equal((await scheduleStore.list('acme'))[0].runtime.nextRunAt,null);await stores.repository.close()}finally{await fs.rm(root,{recursive:true,force:true})}});
