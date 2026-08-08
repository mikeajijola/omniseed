import {assertProvider,evidenceReference} from '../../packages/provider-sdk/src/index.mjs';

const TYPES=['vercel_project','vercel_deployment','vercel_domain'];
const PRIMITIVES=['system','connector','observation'];
const OFFERINGS=[
 {id:'create_web_project',primitive:'system',resourceTypes:['vercel_project']},
 {id:'deploy_web_application',primitive:'system',resourceTypes:['vercel_deployment']},
 {id:'observe_web_deployment',primitive:'observation',resourceTypes:['vercel_deployment']},
 {id:'attach_domain',primitive:'system',resourceTypes:['vercel_domain']},
 {id:'inspect_project',primitive:'observation',resourceTypes:['vercel_project']},
 {id:'inspect_deployment',primitive:'observation',resourceTypes:['vercel_deployment']},
 {id:'inspect_domain',primitive:'observation',resourceTypes:['vercel_domain']}
];

function config(resource){if(!TYPES.includes(resource?.type))throw new Error(`Vercel provider supports ${TYPES.join(', ')}`);const value=resource.provider?.vercel;if(!value?.name)throw new Error('provider.vercel.name is required');return value}
function cleanProject(item){return {id:item.id,name:item.name,framework:item.framework,createdAt:item.createdAt,updatedAt:item.updatedAt}}
function cleanDeployment(item){return {id:item.id,name:item.name,url:item.url,readyState:item.readyState,target:item.target,createdAt:item.createdAt}}
function cleanDomain(item){return {id:item.id||item.name,name:item.name,projectId:item.projectId,verified:item.verified,gitBranch:item.gitBranch}}

export function createVercelProvider({token,teamId,connectionReference='vercel:default',fetch:request=globalThis.fetch,apiUrl='https://api.vercel.com',clock=()=>new Date().toISOString()}={}){
 if(typeof request!=='function')throw new Error('Vercel provider requires fetch');
 async function call(path,options={}){const separator=path.includes('?')?'&':'?';const target=`${apiUrl}${path}${teamId?`${separator}teamId=${encodeURIComponent(teamId)}`:''}`;const response=await request(target,{...options,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{}) ,...options.headers}});if(!response.ok)throw Object.assign(new Error(`Vercel API ${options.method||'GET'} ${path} failed (${response.status})`),{statusCode:response.status});return response.status===204?null:response.json()}
 const provider={
  id:'vercel',displayName:'Vercel',primitiveImplementations:PRIMITIVES.map(id=>({id,resourceTypes:TYPES.filter(type=>id!=='observation'||type!=='vercel_project')})),capabilityOfferings:OFFERINGS,connection:{reference:connectionReference,configured:Boolean(token),teamScoped:Boolean(teamId)},
  async validate(resource){try{config(resource);return {valid:true,errors:[]}}catch(error){return {valid:false,errors:[{message:error.message}]}}},
  async discover({type='vercel_project',name}={}){if(type!=='vercel_project')throw new Error('Initial Vercel discovery supports projects');const result=await call(`/v9/projects${name?`?search=${encodeURIComponent(name)}`:''}`);return (result.projects||[]).map(item=>({provider:'vercel',connectionReference,externalType:'vercel_project',externalId:item.id,managed:false,metadata:cleanProject(item)}))},
  async import(resource,externalResource){const value=config(resource);const id=externalResource?.externalId||externalResource?.id;if(!id)throw new Error('Vercel import requires an external project ID');const item=await call(`/v9/projects/${encodeURIComponent(id)}`);if(value.name!==item.name)throw new Error(`Discovered Vercel project ${item.name} does not match ${value.name}`);return {providerId:`vercel:project:${item.id}`,status:'active',adopted:true,connectionReference,external:cleanProject(item)}},
  async plan(change){const value=config(change.resource);return {provider:'vercel',connectionReference,action:change.action,resource:change.resource.id,externalType:change.resource.type,summary:`${change.action} ${change.resource.type} ${value.name}`,risk:change.resource.type==='vercel_domain'||change.resource.type==='vercel_deployment'?'medium':'low',reversible:change.resource.type!=='vercel_project',requiresAuthorization:true}},
  async apply(change){if(change.action!=='create')throw new Error(`Vercel provider does not apply ${change.action}; adopt existing resources through import`);const value=config(change.resource);if(change.resource.type==='vercel_project'){const item=await call('/v10/projects',{method:'POST',body:JSON.stringify({name:value.name,framework:value.framework})});return {providerId:`vercel:project:${item.id}`,status:'active',connectionReference,external:cleanProject(item)}}if(change.resource.type==='vercel_deployment'){const item=await call('/v13/deployments',{method:'POST',body:JSON.stringify({name:value.name,project:value.project,gitSource:value.gitSource,target:value.target})});return {providerId:`vercel:deployment:${item.id}`,status:item.readyState==='READY'?'active':'pending',connectionReference,external:cleanDeployment(item)}}const item=await call(`/v10/projects/${encodeURIComponent(value.project)}/domains`,{method:'POST',body:JSON.stringify({name:value.name})});return {providerId:`vercel:domain:${item.name}`,status:item.verified?'active':'pending',connectionReference,external:cleanDomain(item)}},
  async observe(resource,state={}){const value=config(resource);let item,path,external;if(resource.type==='vercel_project'){path=`/v9/projects/${encodeURIComponent(value.projectId||state.external?.id||value.name)}`;item=await call(path);external=cleanProject(item)}else if(resource.type==='vercel_deployment'){path=`/v13/deployments/${encodeURIComponent(value.deploymentId||state.external?.id||state.providerId?.split(':').at(-1)||value.name)}`;item=await call(path);external=cleanDeployment(item)}else{path=`/v9/projects/${encodeURIComponent(value.project)}/domains/${encodeURIComponent(value.name)}`;item=await call(path);external=cleanDomain(item)}const id=String(item.id||item.name);const status=item.readyState?(item.readyState==='READY'?'active':'degraded'):(item.verified===false?'degraded':'active');return {resource:resource.id,status,connectionReference,external,evidence:[evidenceReference({provider:'vercel',type:resource.type,id,observedAt:clock(),attributes:{status,url:item.url,verified:item.verified,readyState:item.readyState}})]}}
 };
 return assertProvider(provider);
}
export default createVercelProvider;
