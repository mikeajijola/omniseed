import fs from 'node:fs';
fs.rmSync('dist',{recursive:true,force:true});fs.mkdirSync('dist',{recursive:true});
fs.cpSync('packages/core/src','dist/core',{recursive:true});fs.cpSync('packages/cli/src','dist/cli',{recursive:true});fs.cpSync('packages/provider-sdk/src','dist/provider-sdk',{recursive:true});
fs.cpSync('packages/runtime/src','dist/runtime',{recursive:true});
console.log('Built core, CLI, runtime transport, and provider SDK into dist/.');
