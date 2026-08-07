import {assertProvider} from '../../packages/provider-sdk/src/index.mjs';
export default assertProvider({
  async validate(){return {valid:true,errors:[]}},
  async plan(change){return {change,cost:0,risk:'low'}},
  async apply(change){return {providerId:`local:${change.resource.id}`,status:'active'}},
  async observe(resource){return {resource:resource.id,status:'active',evidence:[]}}
});
