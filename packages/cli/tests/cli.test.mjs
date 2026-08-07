import test from 'node:test'; import assert from 'node:assert/strict'; import {spawnSync} from 'node:child_process';
test('plan supports JSON output',()=>{const result=spawnSync(process.execPath,['packages/cli/src/index.mjs','plan','examples/minimal','--json'],{encoding:'utf8'});assert.equal(result.status,0);assert.equal(JSON.parse(result.stdout).changes[0].resource.id,'support_agent')});
