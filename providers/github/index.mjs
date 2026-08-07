import {assertProvider,evidenceReference} from '../../packages/provider-sdk/src/index.mjs';

const API_VERSION='2022-11-28';

function repositoryConfig(resource) {
  if (resource?.type!=='github_repository') throw new Error('GitHub provider supports github_repository resources');
  const config=resource.provider?.github;
  if (!config?.name) throw new Error('provider.github.name is required');
  return config;
}

function safeRepository(repository) {
  return {
    id:String(repository.id),name:repository.name,fullName:repository.full_name,
    owner:repository.owner?.login,private:Boolean(repository.private),
    description:repository.description||'',defaultBranch:repository.default_branch,
    archived:Boolean(repository.archived),htmlUrl:repository.html_url
  };
}

export function createGitHubProvider({token,fetch:request=globalThis.fetch,apiUrl='https://api.github.com',clock=()=>new Date().toISOString()}={}) {
  if(typeof request!=='function') throw new Error('GitHub provider requires fetch');
  async function call(path,options={}) {
    const response=await request(`${apiUrl}${path}`,{...options,headers:{Accept:'application/vnd.github+json','X-GitHub-Api-Version':API_VERSION,'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{}) ,...options.headers}});
    if(!response.ok) throw Object.assign(new Error(`GitHub API ${options.method||'GET'} ${path} failed (${response.status})`),{statusCode:response.status});
    return response.status===204?null:response.json();
  }
  return assertProvider({
    async validate(resource){try{repositoryConfig(resource);return {valid:true,errors:[]}}catch(error){return {valid:false,errors:[{message:error.message}]}}},
    async plan(change){
      const config=repositoryConfig(change.resource);
      return {provider:'github',action:change.action,resource:change.resource.id,externalType:'github_repository',summary:`${change.action} repository ${config.owner?`${config.owner}/`:''}${config.name}`,risk:config.private===false?'medium':'low',requiresAuthorization:true};
    },
    async apply(change){
      if(change.action!=='create') throw new Error(`GitHub provider does not yet apply ${change.action}`);
      const config=repositoryConfig(change.resource);
      const path=config.owner?`/orgs/${encodeURIComponent(config.owner)}/repos`:'/user/repos';
      const repository=await call(path,{method:'POST',body:JSON.stringify({name:config.name,description:config.description||'',private:config.private!==false,auto_init:config.autoInit===true})});
      const observed=safeRepository(repository);
      return {providerId:`github:${observed.fullName}`,status:'active',external:observed};
    },
    async observe(resource,state={}){
      const config=repositoryConfig(resource);const fullName=state.providerId?.replace(/^github:/,'')||(config.owner?`${config.owner}/${config.name}`:null);
      if(!fullName) throw new Error('A GitHub owner or providerId is required to observe a repository');
      const repository=safeRepository(await call(`/repos/${fullName.split('/').map(encodeURIComponent).join('/')}`));
      return {resource:resource.id,status:repository.archived?'retired':'active',external:repository,evidence:[evidenceReference({provider:'github',type:'repository',id:repository.fullName,observedAt:clock(),attributes:repository})]};
    }
  });
}

export default createGitHubProvider;
