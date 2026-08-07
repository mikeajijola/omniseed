import test from 'node:test'; import assert from 'node:assert/strict'; import {assertProvider} from '../src/index.mjs';
test('provider contract requires deterministic lifecycle operations',()=>assert.throws(()=>assertProvider({validate(){}}),/plan/));
