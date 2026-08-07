import http from 'node:http';

export function createRuntimeServer(runtime,{corsOrigin='http://localhost:3000'}={}) {
  return http.createServer(async(request,response)=>{
    response.setHeader('Access-Control-Allow-Origin',corsOrigin);response.setHeader('Access-Control-Allow-Headers','content-type');response.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');response.setHeader('Content-Type','application/json');
    if(request.method==='OPTIONS'){response.writeHead(204);return response.end()}
    if(request.method==='GET'&&request.url==='/health'){return response.end(JSON.stringify({status:'ok',runtime:'omniseed',operations:'structured'}))}
    const match=request.method==='POST'&&request.url?.match(/^\/operations\/([A-Za-z]+)$/);if(!match){response.writeHead(404);return response.end(JSON.stringify({error:'not_found'}))}
    try{const body=await readJson(request);const result=await runtime.invoke(match[1],body);response.end(JSON.stringify({ok:true,result}))}
    catch(error){response.writeHead(error.statusCode||500);response.end(JSON.stringify({ok:false,error:{message:error.message,details:error.details}}))}
  });
}
async function readJson(request){const chunks=[];for await(const chunk of request)chunks.push(chunk);const body=Buffer.concat(chunks).toString();return body?JSON.parse(body):{}}
