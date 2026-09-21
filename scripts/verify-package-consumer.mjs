import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const workspace = mkdtempSync(join(tmpdir(), 'engine-consumer-'));
const npm = (args, cwd = workspace) => execFileSync('npm', args, { cwd, encoding: 'utf8' });
try {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json')));
  const published = process.argv[2] === '--published';
  const artifact = published ? `${pkg.name}@${pkg.version}` : join(workspace, JSON.parse(npm(['pack', '--json', '--pack-destination', workspace], root))[0].filename);
  writeFileSync(join(workspace, 'package.json'), '{"private":true,"type":"module"}');
  npm(['install', '--ignore-scripts', '--no-audit', '--no-fund', '--cache', join(workspace, 'cache'), '--registry', 'https://registry.npmjs.org', artifact]);
  writeFileSync(join(workspace, 'declaration.yaml'), readFileSync(join(root, 'test/fixtures/stewardship.omniform.yaml')));
  writeFileSync(join(workspace, 'verify.mjs'), `
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { parseOmniform, assertOmniform, canonicalize } from '@omniseed/omniform';
import { compileStewardshipProfile, evaluateStewardshipProposal, assertStewardshipPolicySafe, definitionHash, MemoryStateStore, OmniSeed, ProviderRegistry } from '@omniseed/engine';
const engine = JSON.parse(fs.readFileSync('node_modules/@omniseed/engine/package.json'));
const form = JSON.parse(fs.readFileSync('node_modules/@omniseed/omniform/package.json'));
assert.equal(engine.version, ${JSON.stringify(pkg.version)});
assert.equal(form.version, '1.0.0-alpha.7');
assert.equal(engine.dependencies['@omniseed/omniform'], form.version);
const declaration = parseOmniform(fs.readFileSync('declaration.yaml', 'utf8'));
assertOmniform(declaration);
assertStewardshipPolicySafe(declaration);
const now = new Date('2026-09-01T12:00:00Z');
const profile = compileStewardshipProfile(declaration, {stewardshipControl:{state:'enabled'}}, now);
assert.equal(profile.declaredMode, 'autonomous_safe');
assert.equal(profile.state, 'enabled');
const proposal = { id:'test', digest:'a'.repeat(64), headSha:'b'.repeat(40), proposerActorId:'steward' };
const context = {actorId:'steward',now,checks:[{status:'successful'}],approval:{actorId:'reviewer',proposalId:proposal.id,proposalDigest:proposal.digest,headSha:proposal.headSha}};
assert.equal(evaluateStewardshipProposal(profile,proposal,context).allowed,true);
assert.equal(evaluateStewardshipProposal(profile,proposal,{...context,approval:undefined}).allowed,false);
assert.equal(evaluateStewardshipProposal(profile,proposal,{...context,approval:{...context.approval,headSha:'c'.repeat(40)}}).allowed,false);

declaration.spec.stewardship.autonomy.expiresAt = '2099-01-01T00:00:00Z';
const immutable = canonicalize({companyId:declaration.metadata.id,proposedBy:{actorId:'steward'},createdAt:'2026-09-01T00:00:00.000Z',baseDefinitionHash:definitionHash(declaration),proposedDefinitionHash:'c'.repeat(64),reason:'consumer retry proof',evidence:[],targets:[],patch:[{op:'replace',path:'/metadata/name',value:'Retried Company'}],alternatives:[],assumptions:[],risks:[],requiredAuthority:{approve:['company_change.approve'],apply:['company_change.apply']}});
const hash = createHash('sha256').update(JSON.stringify(immutable)).digest('hex');
const storedProposal = {id:'ccp_'+hash.slice(0,16),status:'submitted',hash,...immutable,submission:{commit:'b'.repeat(40)}};
const observation = {id:'obs_consumer',source:'provider',verified:true,proposalId:storedProposal.id,proposalDigest:hash,headSha:'b'.repeat(40),observedAt:new Date().toISOString(),checks:[{status:'successful'}],repairRoundCount:0};
const initial = {version:0,companyId:declaration.metadata.id,canonicalDefinition:declaration,deployed:[],observed:[],evidence:[],history:[],plans:[],companyChanges:[storedProposal],stewardshipControl:{state:'enabled',expiresAt:'2098-01-01T00:00:00Z'},stewardshipUsage:{active:0,dailyChanges:0,actions:0,repairRounds:0,day:null},stewardshipObservations:[observation],stewardshipApprovals:[],stewardshipEvaluations:[]};
const reviewer = {actorId:'reviewer',permissions:['stewardship.review']};
const steward = {actorId:'steward',permissions:['stewardship.propose']};
const input = {proposalId:storedProposal.id,observationId:observation.id};
async function retryResult(mutate) {
  const store = new MemoryStateStore(structuredClone(initial));
  const runtime = new OmniSeed({store,providers:new ProviderRegistry()});
  await runtime.recordStewardshipApproval(declaration,{...input,outcome:'approved'},reviewer);
  assert.equal((await runtime.evaluateStewardship(declaration,input,steward)).allowed,true);
  const beforeRetry = await store.load(declaration.metadata.id);
  mutate(beforeRetry);
  await store.save(beforeRetry,beforeRetry.version);
  const beforeDecision = await store.load(declaration.metadata.id);
  const decision = await runtime.evaluateStewardship(declaration,input,steward);
  assert.deepEqual(await store.load(declaration.metadata.id),beforeDecision);
  return decision;
}
const retryCases = [
  ['paused',state => { state.stewardshipControl.state='paused'; },'stewardship_paused'],
  ['disabled',state => { state.stewardshipControl.state='disabled'; },'stewardship_disabled'],
  ['expiredControl',state => { state.stewardshipControl.expiresAt='2000-01-01T00:00:00Z'; },'stewardship_expired'],
  ['revokedReview',state => { state.stewardshipApprovals=[]; },'stewardship_independent_review_required'],
  ['inactiveLease',state => { state.stewardshipEvaluations[0].lease.status='cancelled'; state.stewardshipUsage.active=0; },'stewardship_lease_inactive'],
  ['expiredLease',state => { state.stewardshipEvaluations[0].lease.expiresAt='2000-01-01T00:00:00Z'; },'stewardship_lease_expired']
];
const retries = {};
for (const [name,mutate,code] of retryCases) {
  const decision = await retryResult(mutate);
  assert.equal(decision.allowed,false,name);
  assert.equal(decision.code,code,name);
  retries[name]='REJECTED';
}
const accountingStore = new MemoryStateStore(structuredClone(initial));
const accountingRuntime = new OmniSeed({store:accountingStore,providers:new ProviderRegistry()});
await accountingRuntime.recordStewardshipApproval(declaration,{...input,outcome:'approved'},reviewer);
assert.equal((await accountingRuntime.evaluateStewardship(declaration,input,steward)).allowed,true);
const reserved = await accountingStore.load(declaration.metadata.id);
assert.equal((await accountingRuntime.evaluateStewardship(declaration,input,steward)).allowed,true);
assert.deepEqual(await accountingStore.load(declaration.metadata.id),reserved);
console.log(JSON.stringify({engine:engine.version,omniform:form.version,consumer:${JSON.stringify(published ? 'published-registry' : 'packed')},allowed:'PASS',missingReview:'REJECTED',changedHead:'REJECTED',retries,singleCharge:'PASS'}));
`);
  process.stdout.write(execFileSync('node', ['verify.mjs'], { cwd: workspace, encoding: 'utf8' }));
} finally { rmSync(workspace, { recursive: true, force: true }); }
