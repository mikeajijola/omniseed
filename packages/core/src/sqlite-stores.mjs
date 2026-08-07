import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {connect} from '@tursodatabase/serverless';
import {assertPortableState} from './stores.mjs';

const clone=value=>value==null?value:structuredClone(value);
const json=value=>JSON.stringify(value);
const parse=value=>value==null?null:JSON.parse(value);
const safeId=id=>{if(!/^[a-z][a-z0-9_-]*$/.test(id))throw new Error(`Unsafe company id: ${id}`);return id};

const schema=[
  `CREATE TABLE IF NOT EXISTS companies (company_id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS definitions (company_id TEXT NOT NULL, version INTEGER NOT NULL, definition_json TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(company_id,version))`,
  `CREATE TABLE IF NOT EXISTS capabilities (company_id TEXT NOT NULL, capability_id TEXT NOT NULL, definition_json TEXT NOT NULL, PRIMARY KEY(company_id,capability_id))`,
  `CREATE TABLE IF NOT EXISTS resources (company_id TEXT NOT NULL, resource_id TEXT NOT NULL, definition_json TEXT NOT NULL, PRIMARY KEY(company_id,resource_id))`,
  `CREATE TABLE IF NOT EXISTS state_versions (company_id TEXT NOT NULL, version INTEGER NOT NULL, state_json TEXT NOT NULL, plan_id TEXT, approved_by TEXT, created_at TEXT NOT NULL, PRIMARY KEY(company_id,version))`,
  `CREATE TABLE IF NOT EXISTS plans (company_id TEXT NOT NULL, plan_id TEXT NOT NULL, status TEXT, plan_json TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(company_id,plan_id))`,
  `CREATE TABLE IF NOT EXISTS plan_changes (company_id TEXT NOT NULL, plan_id TEXT NOT NULL, change_id TEXT NOT NULL, change_json TEXT NOT NULL, PRIMARY KEY(company_id,plan_id,change_id))`,
  `CREATE TABLE IF NOT EXISTS applies (company_id TEXT NOT NULL, sequence INTEGER NOT NULL, plan_id TEXT, approved_by TEXT, apply_json TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(company_id,sequence))`,
  `CREATE TABLE IF NOT EXISTS events (company_id TEXT NOT NULL, sequence INTEGER NOT NULL, event_type TEXT NOT NULL, event_json TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(company_id,sequence))`,
  `CREATE TABLE IF NOT EXISTS observations (company_id TEXT NOT NULL, observation_id TEXT NOT NULL, observation_json TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(company_id,observation_id))`,
  `CREATE TABLE IF NOT EXISTS findings (company_id TEXT NOT NULL, finding_id TEXT NOT NULL, finding_json TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(company_id,finding_id))`,
  `CREATE TABLE IF NOT EXISTS evidence (company_id TEXT NOT NULL, evidence_id TEXT NOT NULL, evidence_json TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(company_id,evidence_id))`,
  `CREATE TABLE IF NOT EXISTS founding_sessions (company_id TEXT NOT NULL, session_id TEXT NOT NULL, session_json TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(company_id,session_id))`,
  `CREATE TABLE IF NOT EXISTS schedules (company_id TEXT NOT NULL, schedule_id TEXT NOT NULL, schedule_json TEXT NOT NULL, next_run_at TEXT, last_run_at TEXT, status TEXT NOT NULL DEFAULT 'active', PRIMARY KEY(company_id,schedule_id))`,
  `CREATE TABLE IF NOT EXISTS realisation_attempts (company_id TEXT NOT NULL, attempt_id TEXT NOT NULL, attempt_json TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(company_id,attempt_id))`,
  `CREATE TABLE IF NOT EXISTS organisational_learning (company_id TEXT NOT NULL, learning_id TEXT NOT NULL, statement TEXT NOT NULL, capability_id TEXT, evidence_refs TEXT NOT NULL, confidence REAL, validation_status TEXT, learned_at TEXT NOT NULL, learning_json TEXT NOT NULL, PRIMARY KEY(company_id,learning_id))`,
  `CREATE TABLE IF NOT EXISTS runtime_metadata (company_id TEXT NOT NULL, kind TEXT NOT NULL, sequence INTEGER NOT NULL, value_json TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(company_id,kind,sequence))`,
  `CREATE INDEX IF NOT EXISTS idx_events_company_time ON events(company_id,created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_schedules_due ON schedules(status,next_run_at)`,
  `CREATE INDEX IF NOT EXISTS idx_learning_capability ON organisational_learning(company_id,capability_id)`
];

export class SQLiteRepository {
  static async local({file=path.resolve('.omniseed/omniseed.db')}={}){fs.mkdirSync(path.dirname(file),{recursive:true});return SQLiteRepository.open(new LocalSQLiteDriver(file),{kind:'sqlite',location:file})}
  static async remote({url=process.env.OMNISEED_DATABASE_URL||process.env.TURSO_DATABASE_URL,authToken=process.env.OMNISEED_DATABASE_AUTH_TOKEN||process.env.TURSO_AUTH_TOKEN}={}){if(!url)throw new Error('Hosted SQLite requires OMNISEED_DATABASE_URL (or TURSO_DATABASE_URL)');return SQLiteRepository.open(new RemoteSQLiteDriver({url,authToken}),{kind:'hosted-sqlite',location:'remote'})}
  static async open(driver,metadata={}){const repository=new SQLiteRepository(driver,metadata);await repository.initialize();return repository}
  constructor(driver,metadata={}){this.driver=driver;this.metadata=metadata}
  async initialize(){for(const sql of schema)await this.driver.run(sql)}
  run(sql,args=[]){return this.driver.run(sql,args)}
  all(sql,args=[]){return this.driver.all(sql,args)}
  get(sql,args=[]){return this.driver.get(sql,args)}
  batch(statements){return this.driver.batch(statements)}
  async close(){await this.driver.close?.()}
}

class LocalSQLiteDriver {
  constructor(file){this.database=new DatabaseSync(file);this.database.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000')}
  async run(sql,args=[]){return this.database.prepare(sql).run(...args)}
  async all(sql,args=[]){return this.database.prepare(sql).all(...args)}
  async get(sql,args=[]){return this.database.prepare(sql).get(...args)||null}
  async batch(statements){this.database.exec('BEGIN IMMEDIATE');try{const results=[];for(const item of statements)results.push(await this.run(item.sql,item.args));this.database.exec('COMMIT');return results}catch(error){this.database.exec('ROLLBACK');throw error}}
  async close(){this.database.close()}
}

class RemoteSQLiteDriver {
  constructor(config){this.connection=connect(config)}
  async run(sql,args=[]){return this.connection.run(sql,args)}
  async all(sql,args=[]){return this.connection.all(sql,args)}
  async get(sql,args=[]){return this.connection.get(sql,args)}
  async batch(statements){return this.connection.batch(statements,'immediate')}
  async close(){await this.connection.close?.()}
}

export class SQLiteDefinitionStore {
  constructor(repository){this.repository=repository}
  async load(id){const row=await this.repository.get('SELECT definition_json FROM definitions WHERE company_id=? ORDER BY version DESC LIMIT 1',[safeId(id)]);return parse(row?.definition_json)}
  async save(id,value){id=safeId(id);const now=new Date().toISOString(),current=await this.repository.get('SELECT COALESCE(MAX(version),0) version FROM definitions WHERE company_id=?',[id]),version=Number(current?.version||0)+1;const statements=[
    {sql:`INSERT INTO companies(company_id,name,created_at,updated_at) VALUES(?,?,?,?) ON CONFLICT(company_id) DO UPDATE SET name=excluded.name,updated_at=excluded.updated_at`,args:[id,value.company?.name||id,now,now]},
    {sql:'INSERT INTO definitions(company_id,version,definition_json,created_at) VALUES(?,?,?,?)',args:[id,version,json(value),now]},
    {sql:'DELETE FROM capabilities WHERE company_id=?',args:[id]},
    {sql:'DELETE FROM resources WHERE company_id=?',args:[id]},
    {sql:'DELETE FROM schedules WHERE company_id=?',args:[id]}
  ];
    for(const item of value.company?.capabilities||value.capabilities||[])statements.push({sql:'INSERT INTO capabilities(company_id,capability_id,definition_json) VALUES(?,?,?)',args:[id,item.id,json(item)]});
    for(const item of value.company?.resources||value.resources||[])statements.push({sql:'INSERT INTO resources(company_id,resource_id,definition_json) VALUES(?,?,?)',args:[id,item.id,json(item)]});
    for(const item of value.company?.schedules||value.schedules||[])statements.push({sql:'INSERT INTO schedules(company_id,schedule_id,schedule_json,next_run_at,status) VALUES(?,?,?,?,?)',args:[id,item.id,json(item),initialNextRun(item),item.enabled===false?'disabled':'active']});
    await this.repository.batch(statements);return clone(value)}
}

export class SQLiteStateStore {
  constructor(repository){this.repository=repository}
  async load(id){const row=await this.repository.get('SELECT state_json FROM state_versions WHERE company_id=? ORDER BY version DESC LIMIT 1',[safeId(id)]);return parse(row?.state_json)}
  async save(id,state){assertPortableState(state);await this.repository.run(`INSERT INTO state_versions(company_id,version,state_json,plan_id,approved_by,created_at) VALUES(?,?,?,?,?,?) ON CONFLICT(company_id,version) DO UPDATE SET state_json=excluded.state_json,plan_id=excluded.plan_id,approved_by=COALESCE(excluded.approved_by,state_versions.approved_by)`,[safeId(id),state.version,json(state),state.lastAppliedPlan||null,state.approvedBy||null,new Date().toISOString()]);return clone(state)}
  async listVersions(id){return (await this.repository.all('SELECT version FROM state_versions WHERE company_id=? ORDER BY version',[safeId(id)])).map(row=>Number(row.version))}
  async loadVersion(id,version){const row=await this.repository.get('SELECT state_json FROM state_versions WHERE company_id=? AND version=?',[safeId(id),Number(version)]);return parse(row?.state_json)}
}

export class SQLiteRuntimeMetadataStore {
  constructor(repository){this.repository=repository}
  async append(id,kind,value){id=safeId(id);const sequence=await nextSequence(this.repository,id,kind),now=value.timestamp||new Date().toISOString();await this.repository.run('INSERT INTO runtime_metadata(company_id,kind,sequence,value_json,created_at) VALUES(?,?,?,?,?)',[id,kind,sequence,json(value),now]);await projectMetadata(this.repository,id,kind,value,sequence,now)}
  async list(id,kind='applies'){return (await this.repository.all('SELECT value_json FROM runtime_metadata WHERE company_id=? AND kind=? ORDER BY sequence',[safeId(id),kind])).map(row=>parse(row.value_json))}
  async replace(id,kind,items){id=safeId(id);const statements=[{sql:'DELETE FROM runtime_metadata WHERE company_id=? AND kind=?',args:[id,kind]}];items.forEach((value,index)=>statements.push({sql:'INSERT INTO runtime_metadata(company_id,kind,sequence,value_json,created_at) VALUES(?,?,?,?,?)',args:[id,kind,index+1,json(value),value.timestamp||new Date().toISOString()]}));if(kind==='current-plan')statements.push({sql:'DELETE FROM plans WHERE company_id=?',args:[id]},{sql:'DELETE FROM plan_changes WHERE company_id=?',args:[id]});if(kind==='founding-sessions')statements.push({sql:'DELETE FROM founding_sessions WHERE company_id=?',args:[id]});await this.repository.batch(statements);for(let index=0;index<items.length;index++)await projectMetadata(this.repository,id,kind,items[index],index+1,items[index].timestamp||new Date().toISOString())}
}

export async function createSQLiteStores(options={}){const repository=options.repository||(options.remote?await SQLiteRepository.remote(options):await SQLiteRepository.local(options));return {repository,definitionStore:new SQLiteDefinitionStore(repository),stateStore:new SQLiteStateStore(repository),metadataStore:new SQLiteRuntimeMetadataStore(repository)}}

export class SQLiteScheduleStore {
  constructor(repository){this.repository=repository}
  async list(companyId){return (await this.repository.all('SELECT schedule_json,next_run_at,last_run_at,status FROM schedules WHERE company_id=? ORDER BY schedule_id',[safeId(companyId)])).map(row=>({...parse(row.schedule_json),runtime:{nextRunAt:row.next_run_at,lastRunAt:row.last_run_at,status:row.status}}))}
  async due(companyId,now=new Date()){return (await this.repository.all(`SELECT schedule_json FROM schedules WHERE company_id=? AND status='active' AND next_run_at IS NOT NULL AND next_run_at<=? ORDER BY next_run_at`,[safeId(companyId),now.toISOString()])).map(row=>parse(row.schedule_json))}
  async recordRun(companyId,schedule,at=new Date()){await this.repository.run('UPDATE schedules SET last_run_at=?,next_run_at=? WHERE company_id=? AND schedule_id=?',[at.toISOString(),schedule.cadence?.type==='one-shot'?null:nextRun(schedule,at),safeId(companyId),schedule.id])}
}

async function nextSequence(repository,id,kind){const row=await repository.get('SELECT COALESCE(MAX(sequence),0)+1 sequence FROM runtime_metadata WHERE company_id=? AND kind=?',[id,kind]);return Number(row.sequence)}
async function projectMetadata(repository,id,kind,value,sequence,now){
  if(kind==='events')await repository.run('INSERT OR REPLACE INTO events(company_id,sequence,event_type,event_json,created_at) VALUES(?,?,?,?,?)',[id,sequence,value.type||'unknown',json(value),now]);
  if(kind==='applies')await repository.run('INSERT OR REPLACE INTO applies(company_id,sequence,plan_id,approved_by,apply_json,created_at) VALUES(?,?,?,?,?,?)',[id,sequence,value.planId||null,value.approvedBy||null,json(value),now]);
  if(kind==='current-plan'&&value){const planId=value.id||`plan-${sequence}`;await repository.run('INSERT OR REPLACE INTO plans(company_id,plan_id,status,plan_json,updated_at) VALUES(?,?,?,?,?)',[id,planId,value.status||'proposed',json(value),now]);for(const [index,change] of (value.changes||[]).entries())await repository.run('INSERT OR REPLACE INTO plan_changes(company_id,plan_id,change_id,change_json) VALUES(?,?,?,?)',[id,planId,change.id||String(index+1),json(change)])}
  if(kind==='founding-sessions')for(const session of value.sessions||[])await repository.run('INSERT OR REPLACE INTO founding_sessions(company_id,session_id,session_json,updated_at) VALUES(?,?,?,?)',[id,session.id,json(session),now]);
  const maps={observations:['observations','observation_id','observation_json','observationId'],findings:['findings','finding_id','finding_json','id'],evidence:['evidence','evidence_id','evidence_json','id'],'realisation-attempts':['realisation_attempts','attempt_id','attempt_json','id']};const map=maps[kind];if(map&&value){const [table,idColumn,jsonColumn,key]=map;await repository.run(`INSERT OR REPLACE INTO ${table}(company_id,${idColumn},${jsonColumn},${table==='evidence'||table==='realisation_attempts'?'created_at':'updated_at'}) VALUES(?,?,?,?)`,[id,value[key]||`${kind}-${sequence}`,json(value),now])}
  if(kind==='organisational-learning'&&value)await repository.run('INSERT OR REPLACE INTO organisational_learning(company_id,learning_id,statement,capability_id,evidence_refs,confidence,validation_status,learned_at,learning_json) VALUES(?,?,?,?,?,?,?,?,?)',[id,value.id||`learning-${sequence}`,value.statement,value.capabilityId||null,json(value.evidenceReferences||[]),value.confidence||null,value.validationStatus||'candidate',value.learnedAt||now,json(value)]);
}
function initialNextRun(schedule){return nextRun(schedule,new Date())}
function nextRun(schedule,from){const cadence=schedule.cadence||{};if(cadence.type==='one-shot')return cadence.at||null;if(cadence.type==='interval'){const milliseconds=parseDuration(cadence.duration||cadence.every||cadence.interval);return milliseconds?new Date(from.getTime()+milliseconds).toISOString():null}return schedule.nextRunAt||null}
function parseDuration(value=''){const match=String(value).match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);return match?(Number(match[1]||0)*3600+Number(match[2]||0)*60+Number(match[3]||0))*1000:0}
