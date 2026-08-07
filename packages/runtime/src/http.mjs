import http from 'node:http';

export function createRuntimeServer(runtime,{corsOrigin='http://localhost:3000'}={}) {
  return http.createServer(async(request,response)=>{
    response.setHeader('Access-Control-Allow-Origin',corsOrigin);response.setHeader('Access-Control-Allow-Headers','content-type');response.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');response.setHeader('Content-Type','application/json');
    if(request.method==='OPTIONS'){response.writeHead(204);return response.end()}
    if(request.method==='GET'&&request.url==='/health'){return response.end(JSON.stringify({status:'ok',runtime:'omniseed',operations:'structured'}))}
    if(request.method==='GET'&&request.url==='/operations'){const result=await runtime.invoke('getCapabilityRegistry');return response.end(JSON.stringify({ok:true,result}))}
    const description=request.method==='GET'&&request.url?.match(/^\/operations\/([a-z][a-z0-9_]*)$/);if(description){const result=await runtime.invoke('describeOperation',{id:description[1]});if(!result)response.writeHead(404);return response.end(JSON.stringify({ok:Boolean(result),result}))}
    const match=request.method==='POST'&&request.url?.match(/^\/operations\/([A-Za-z][A-Za-z0-9_]+)$/);if(!match){response.writeHead(404);return response.end(JSON.stringify({error:'not_found'}))}
    try{const body=await readJson(request);const canonical=match[1].includes('_');const result=canonical?await runtime.invoke('executeOperation',{id:match[1],input:body.input||body,authorization:body.authorization||body.input?.authorization}):await runtime.invoke(match[1],body);response.end(JSON.stringify({ok:true,result}))}
    catch(error){response.writeHead(error.statusCode||500);response.end(JSON.stringify({ok:false,error:{message:error.message,details:error.details}}))}
  });
}
async function readJson(request){const chunks=[];for await(const chunk of request)chunks.push(chunk);const body=Buffer.concat(chunks).toString();return body?JSON.parse(body):{}}
