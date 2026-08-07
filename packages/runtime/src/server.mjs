import fs from 'node:fs';
import path from 'node:path';
import {OmniSeedHost} from '../../core/src/host.mjs';
import {createSQLiteStores,SQLiteScheduleStore} from '../../core/src/sqlite-stores.mjs';
import {OmniSeedScheduler,InProcessScheduler} from '../../core/src/scheduler.mjs';
import {createRuntimeServer} from './http.mjs';

const directory=process.env.OMNISEED_EXAMPLE||'examples/minimal';
const read=name=>JSON.parse(fs.readFileSync(`${directory}/${name}`));
const port=Number(process.env.PORT||8787);
const file=path.resolve(process.env.OMNISEED_DATABASE_FILE||(process.env.OMNISEED_DATA_DIR?path.join(process.env.OMNISEED_DATA_DIR,'omniseed.db'):'.omniseed/omniseed.db'));
const companyId=process.env.OMNISEED_COMPANY_ID||read('company.json').company.id;
const stores=await createSQLiteStores({file});
const host=await OmniSeedHost.open({companyId,...stores,bootstrapDefinition:companyId===read('company.json').company.id?read('company.json'):undefined,bootstrapState:companyId===read('company.json').company.id?read('deployment-state.json'):undefined});
const scheduler=new InProcessScheduler({scheduler:new OmniSeedScheduler({host,scheduleStore:new SQLiteScheduleStore(stores.repository),companyId})}).start();
const server=createRuntimeServer(host,{corsOrigin:process.env.CORS_ORIGIN||'http://localhost:3000'}).listen(port,()=>console.log(`OmniSeed runtime for ${companyId} listening on http://localhost:${port}; SQLite: ${file}`));
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{scheduler.stop();server.close(()=>stores.repository.close())});
