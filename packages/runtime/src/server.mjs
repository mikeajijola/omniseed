import fs from 'node:fs';import {OmniSeedRuntime} from '../../core/src/runtime.mjs';import {createRuntimeServer} from './http.mjs';
const directory=process.env.OMNISEED_EXAMPLE||'examples/minimal';const read=name=>JSON.parse(fs.readFileSync(`${directory}/${name}`));const port=Number(process.env.PORT||8787);
const runtime=new OmniSeedRuntime({definition:read('company.json'),deployment:read('deployment-state.json')});
createRuntimeServer(runtime,{corsOrigin:process.env.CORS_ORIGIN||'http://localhost:3000'}).listen(port,()=>console.log(`OmniSeed runtime listening on http://localhost:${port}`));
