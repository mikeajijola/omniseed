import fs from 'node:fs';
for(const file of ['README.md','docs/index.md','packages/core/src/index.mjs','packages/core/src/runtime.mjs','packages/runtime/src/http.mjs','packages/provider-sdk/src/index.mjs','examples/minimal/company.json'])if(!fs.existsSync(file))throw new Error(`Missing ${file}`);
console.log('Repository structure and documentation entry points verified.');
