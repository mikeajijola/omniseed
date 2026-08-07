import fs from 'node:fs/promises';import path from 'node:path';
const safeId=id=>{if(!/^[a-z][a-z0-9_-]*$/.test(id))throw new Error(`Unsafe company id: ${id}`);return id};
const clone=value=>value==null?value:structuredClone(value);

export class MemoryStateStore {
  constructor(){this.current=new Map();this.history=new Map()}
  async load(companyId){return clone(this.current.get(companyId)||null)}
  async save(companyId,state){assertPortableState(state);this.current.set(companyId,clone(state));const versions=this.history.get(companyId)||new Map();versions.set(state.version,clone(state));this.history.set(companyId,versions)}
  async listVersions(companyId){return [...(this.history.get(companyId)?.keys()||[])].sort((a,b)=>a-b)}
  async loadVersion(companyId,version){return clone(this.history.get(companyId)?.get(version)||null)}
}

export class FileStateStore {
  constructor(root){this.root=root}
  directory(companyId){return path.join(this.root,safeId(companyId),'state')}
  async load(companyId){return readJson(path.join(this.directory(companyId),'current.json'))}
  async save(companyId,state){assertPortableState(state);const directory=this.directory(companyId);await fs.mkdir(path.join(directory,'history'),{recursive:true});await atomicJson(path.join(directory,'history',`${state.version}.json`),state);await atomicJson(path.join(directory,'current.json'),state)}
  async listVersions(companyId){try{return (await fs.readdir(path.join(this.directory(companyId),'history'))).filter(file=>/^\d+\.json$/.test(file)).map(file=>Number(file.slice(0,-5))).sort((a,b)=>a-b)}catch(error){if(error.code==='ENOENT')return [];throw error}}
  async loadVersion(companyId,version){return readJson(path.join(this.directory(companyId),'history',`${Number(version)}.json`))}
}

export class MemoryDefinitionStore {constructor(){this.items=new Map()}async load(id){return clone(this.items.get(id)||null)}async save(id,value){this.items.set(id,clone(value))}}
export class FileDefinitionStore {constructor(root){this.root=root}async load(id){return readJson(path.join(this.root,safeId(id),'company.json'))}async save(id,value){await atomicJson(path.join(this.root,safeId(id),'company.json'),value)}}
export class MemoryRuntimeMetadataStore {constructor(){this.items=new Map()}key(id,kind){return `${id}:${kind}`}async append(id,kind,value){const key=this.key(id,kind),items=this.items.get(key)||[];items.push(clone(value));this.items.set(key,items)}async list(id,kind='applies'){return clone(this.items.get(this.key(id,kind))||[])}async replace(id,kind,items){this.items.set(this.key(id,kind),clone(items))}}
export class FileRuntimeMetadataStore {constructor(root){this.root=root}async append(id,kind,value){const directory=path.join(this.root,safeId(id),'runtime',kind);await fs.mkdir(directory,{recursive:true});await atomicJson(path.join(directory,`${String(value.version??Date.now()).padStart(8,'0')}.json`),value)}async list(id,kind='applies'){try{return Promise.all((await fs.readdir(path.join(this.root,safeId(id),'runtime',kind))).sort().map(file=>readJson(path.join(this.root,safeId(id),'runtime',kind,file))))}catch(error){if(error.code==='ENOENT')return [];throw error}}}

export class HostedKeyValueClient {
  constructor({url=process.env.KV_REST_API_URL,token=process.env.KV_REST_API_TOKEN,fetchImpl=globalThis.fetch,prefix='omniseed'}={}){if(!url||!token)throw new Error('Hosted persistence requires KV_REST_API_URL and KV_REST_API_TOKEN');this.url=url.replace(/\/$/,'');this.token=token;this.fetch=fetchImpl;this.prefix=prefix}
  key(...parts){return [this.prefix,...parts].map(part=>encodeURIComponent(String(part))).join(':')}
  async command(...command){const response=await this.fetch(this.url,{method:'POST',headers:{authorization:`Bearer ${this.token}`,'content-type':'application/json'},body:JSON.stringify(command)});const payload=await response.json();if(!response.ok||payload.error)throw new Error(`Hosted persistence command failed: ${payload.error||response.status}`);return payload.result}
  async get(key){const value=await this.command('GET',key);return value==null?null:JSON.parse(value)}
  async set(key,value){await this.command('SET',key,JSON.stringify(value));return clone(value)}
}

export class HostedDefinitionStore {constructor(client){this.client=client}async load(id){return this.client.get(this.client.key('companies',safeId(id),'definition'))}async save(id,value){return this.client.set(this.client.key('companies',safeId(id),'definition'),value)}}
export class HostedStateStore {
  constructor(client){this.client=client}
  current(id){return this.client.key('companies',safeId(id),'state','current')}
  history(id,version){return this.client.key('companies',safeId(id),'state','history',Number(version))}
  versions(id){return this.client.key('companies',safeId(id),'state','versions')}
  async load(id){return this.client.get(this.current(id))}
  async save(id,state){assertPortableState(state);const versions=await this.listVersions(id);if(!versions.includes(state.version)){versions.push(state.version);versions.sort((a,b)=>a-b)}await this.client.set(this.history(id,state.version),state);await this.client.set(this.versions(id),versions);return this.client.set(this.current(id),state)}
  async listVersions(id){return await this.client.get(this.versions(id))||[]}
  async loadVersion(id,version){return this.client.get(this.history(id,version))}
}
export class HostedRuntimeMetadataStore {
  constructor(client){this.client=client}
  key(id,kind){return this.client.key('companies',safeId(id),'runtime',safeId(kind))}
  async append(id,kind,value){const items=await this.list(id,kind);items.push(clone(value));await this.client.set(this.key(id,kind),items)}
  async list(id,kind='applies'){return await this.client.get(this.key(id,kind))||[]}
  async replace(id,kind,items){return this.client.set(this.key(id,kind),items)}
}

export function assertPortableState(state){const forbidden=/secret|password|token|api[_-]?key|credential/i;const visit=(value,pathName='state')=>{if(!value||typeof value!=='object')return;for(const [key,item] of Object.entries(value)){if(forbidden.test(key))throw new Error(`Portable state cannot contain secrets: ${pathName}.${key}`);visit(item,`${pathName}.${key}`)}};visit(state)}
async function readJson(file){try{return JSON.parse(await fs.readFile(file,'utf8'))}catch(error){if(error.code==='ENOENT')return null;throw error}}
async function atomicJson(file,value){await fs.mkdir(path.dirname(file),{recursive:true});const temporary=`${file}.${process.pid}.tmp`;await fs.writeFile(temporary,`${JSON.stringify(value,null,2)}\n`,{mode:0o600});await fs.rename(temporary,file)}
