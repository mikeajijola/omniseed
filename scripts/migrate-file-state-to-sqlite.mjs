import fs from 'node:fs/promises';
import path from 'node:path';
import {FileDefinitionStore,FileStateStore,FileRuntimeMetadataStore} from '../packages/core/src/stores.mjs';
import {createSQLiteStores} from '../packages/core/src/sqlite-stores.mjs';

const source=path.resolve(process.argv[2]||'.omniseed/companies');
const file=path.resolve(process.argv[3]||'.omniseed/omniseed.db');
const stores=await createSQLiteStores({file});
for(const entry of await fs.readdir(source,{withFileTypes:true}).catch(error=>error.code==='ENOENT'?[]:Promise.reject(error))){
  if(!entry.isDirectory())continue;
  const companyId=entry.name,definitionStore=new FileDefinitionStore(source),stateStore=new FileStateStore(source),metadataStore=new FileRuntimeMetadataStore(source),definition=await definitionStore.load(companyId),state=await stateStore.load(companyId);
  if(!definition)continue;
  await stores.definitionStore.save(companyId,definition);
  for(const version of await stateStore.listVersions(companyId))await stores.stateStore.save(companyId,await stateStore.loadVersion(companyId,version));
  if(state&&!(await stores.stateStore.listVersions(companyId)).includes(state.version))await stores.stateStore.save(companyId,state);
  for(const kind of ['events','applies','current-plan','founding-sessions','founding','observations','findings','evidence','realisation-attempts','organisational-learning'])for(const value of await metadataStore.list(companyId,kind)||[])await stores.metadataStore.append(companyId,kind,value);
  console.log(`Imported ${companyId}`);
}
await stores.repository.close();
console.log(`SQLite database: ${file}`);
