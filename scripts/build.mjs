import fs from 'node:fs';
fs.rmSync('dist',{recursive:true,force:true});fs.mkdirSync('dist',{recursive:true});
fs.cpSync('packages/core/src','dist/core',{recursive:true});fs.cpSync('packages/cli/src','dist/cli',{recursive:true});fs.cpSync('packages/provider-sdk/src','dist/provider-sdk',{recursive:true});
console.log('Built core, CLI, and provider SDK into dist/.');
