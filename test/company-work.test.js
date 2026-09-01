import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseOmniform } from "@omniseed/omniform";
import { JsonCompanyWorkStore, JsonStateStore, MemoryCompanyWorkStore, MemoryStateStore, OmniSeed, ProviderRegistry } from "../src/index.js";

const declaration = parseOmniform(`apiVersion: omniform.org/v1alpha1
kind: Company
metadata: { id: acme, name: Acme }
spec:
  stewardship: { capability: company_stewardship, realisation: primary_steward }
  providers: { agents: { provider: missing_agent_runtime } }
  capabilities:
    - { id: company_stewardship, name: Company Stewardship, requires: [{ id: steward_company, primitiveFamily: agents }], realisations: [primary_steward] }
  realisations:
    - { id: primary_steward, name: Primary steward, capability: company_stewardship, participants: [{ resource: lily, supplies: [steward_company] }] }
  resources:
    agents:
      - { id: lily, name: Lily, offers: [steward_company], spec: { authority: [company_work.create, company_work.read, company_work.record, company_work.cancel] } }
  operations:
    - { id: start_company_work, capability: company_stewardship, description: Start company work, input: {}, output: {}, mutation: true, permissions: [company_work.create], approval: none, interfaces: [lily, ui, api] }
    - { id: list_company_work, capability: company_stewardship, description: List company work, input: {}, output: {}, mutation: false, permissions: [company_work.read], approval: none, interfaces: [lily, ui, api] }
    - { id: get_company_work, capability: company_stewardship, description: Inspect company work, input: {}, output: {}, mutation: false, permissions: [company_work.read], approval: none, interfaces: [lily, ui, api] }
    - { id: continue_company_work, capability: company_stewardship, description: Continue company work, input: {}, output: {}, mutation: true, permissions: [company_work.create], approval: none, interfaces: [lily, ui, api] }
    - { id: cancel_company_work, capability: company_stewardship, description: Cancel company work, input: {}, output: {}, mutation: true, permissions: [company_work.cancel], approval: none, interfaces: [lily, ui, api] }
`);

const lily = { actorId: "lily", permissions: ["company_work.create", "company_work.read", "company_work.record", "company_work.cancel"] };

test("company work is durable, idempotent, and keeps Eve continuation data out of projections", async () => {
  const path = join(await mkdtemp(join(tmpdir(), "omniseed-work-")), "state.json");
  const workPath = `${path}.work`;
  const first = new OmniSeed({ store: new JsonStateStore(path), workStore: new JsonCompanyWorkStore(workPath), providers: new ProviderRegistry(), binding: { desiredRevision: "desired-a" } });
  const run = await first.invokeOperation(declaration, "start_company_work", { intent: "Inspect the company", idempotencyKey: "request-1" }, lily);
  const repeated = await first.invokeOperation(declaration, "start_company_work", { intent: "Inspect the company", idempotencyKey: "request-1" }, lily);
  assert.equal(repeated.id, run.id);
  await first.attachCompanyWorkSession(declaration, run.id, { id: "ses_1", continuationToken: "eve:secret", streamIndex: 0 }, lily);
  await first.recordCompanyWorkEvent(declaration, run.id, { status: "running", event: { id: "evt_1", type: "turn_started", streamIndex: 1, turnId: "turn_1" } }, lily);
  await first.recordCompanyWorkEvent(declaration, run.id, { status: "waiting_for_input", event: { id: "evt_2", type: "assistant_message", summary: "What should I inspect next?", streamIndex: 2 } }, lily);

  const restarted = new OmniSeed({ store: new JsonStateStore(path), workStore: new JsonCompanyWorkStore(workPath), providers: new ProviderRegistry() });
  const projected = await restarted.invokeOperation(declaration, "get_company_work", { workRunId: run.id }, lily);
  assert.equal(projected.status, "waiting_for_input");
  assert.equal(projected.session.id, "ses_1");
  assert.equal(projected.session.streamIndex, 2);
  assert.equal("continuationToken" in projected.session, false);
  assert.doesNotMatch(JSON.stringify((await restarted.inspect(declaration)).workRuns), /eve:secret/);
  assert.doesNotMatch(await readFile(path, "utf8").catch(() => ""), /eve:secret/);
  assert.match(await readFile(workPath, "utf8"), /eve:secret/);
});

test("a company work run resumes the same session and deduplicates durable Eve events", async () => {
  const engine = new OmniSeed({ store: new MemoryStateStore(), providers: new ProviderRegistry() });
  const run = await engine.startCompanyWork(declaration, { intent: "Operate the company" }, lily);
  await engine.attachCompanyWorkSession(declaration, run.id, { id: "ses_1", continuationToken: "eve:one" }, lily);
  const event = { id: "evt_1", type: "operation_completed", operationId: "inspect_company", streamIndex: 1 };
  await engine.recordCompanyWorkEvent(declaration, run.id, { status: "running", event }, lily);
  await engine.recordCompanyWorkEvent(declaration, run.id, { event }, lily);
  await engine.recordCompanyWorkEvent(declaration, run.id, { status: "waiting_for_input", event: { id: "evt_2", type: "session_waiting", continuationToken: "eve:two", streamIndex: 2 } }, lily);
  await engine.continueCompanyWork(declaration, run.id, { message: "Continue with the approved scope" }, lily);
  const raw = await engine.getCompanyWork(declaration, run.id, lily, { includeRuntime: true });
  assert.equal(raw.session.id, "ses_1");
  assert.equal(raw.session.continuationToken, "eve:two");
  assert.equal(raw.events.filter(item => item.id === "evt_1").length, 1);
  assert.equal(raw.status, "running");
});

test("mutating company work serializes while independent inspection work remains possible", async () => {
  const engine = new OmniSeed({ store: new MemoryStateStore(), providers: new ProviderRegistry() });
  const first = await engine.startCompanyWork(declaration, { intent: "Propose a company change" }, lily);
  const second = await engine.startCompanyWork(declaration, { intent: "Inspect capability state" }, lily);
  await engine.recordCompanyWorkEvent(declaration, first.id, { mutation: true, status: "running", event: { id: "first-mutation", type: "operation_requested", operationId: "propose_company_change" } }, lily);
  await assert.rejects(
    engine.recordCompanyWorkEvent(declaration, second.id, { mutation: true, status: "running", event: { id: "second-mutation", type: "operation_requested", operationId: "apply_plan" } }, lily),
    error => error.code === "company_work_conflict" && error.details.activeWorkRunId === first.id,
  );
  assert.equal((await engine.getCompanyWork(declaration, second.id, lily)).mode, "inspection");
});

test("company work authorization and lifecycle fail closed", async () => {
  const engine = new OmniSeed({ store: new MemoryStateStore(), providers: new ProviderRegistry() });
  await assert.rejects(engine.startCompanyWork(declaration, { intent: "Operate" }, { actorId: "operator", permissions: ["company_work.create"] }), error => error.code === "authorization_denied");
  const run = await engine.startCompanyWork(declaration, { intent: "Operate" }, lily);
  await assert.rejects(engine.getCompanyWork(declaration, run.id, { actorId: "viewer", permissions: [] }), error => error.code === "authorization_denied");
  await engine.recordCompanyWorkEvent(declaration, run.id, { status: "running", event: { id: "evt", type: "turn_started" } }, lily);
  await engine.cancelCompanyWork(declaration, run.id, lily);
  await assert.rejects(engine.continueCompanyWork(declaration, run.id, { message: "resume" }, lily), error => error.code === "company_work_invalid_state");
});

test("company work timeline writes do not invalidate an exact reviewed reconciliation plan", async () => {
  const store = new MemoryStateStore(), workStore = new MemoryCompanyWorkStore(), engine = new OmniSeed({ store, workStore, providers: new ProviderRegistry() });
  const planner = { actorId: "planner", permissions: ["plan.create"] };
  const planDeclaration = structuredClone(declaration);
  planDeclaration.spec.operations.push({ id: "generate_plan", capability: "company_stewardship", description: "Plan", input: {}, output: {}, mutation: false, permissions: ["plan.create"], approval: "none", interfaces: ["api"] });
  const plan = await engine.plan(planDeclaration, planner);
  const runtimeVersion = (await store.load("acme")).version;
  const run = await engine.startCompanyWork(planDeclaration, { intent: "Inspect the plan" }, lily);
  await engine.recordCompanyWorkEvent(planDeclaration, run.id, { status: "running", event: { id: "evt", type: "operation_requested", operationId: "get_plan" } }, lily);
  assert.equal((await store.load("acme")).version, runtimeVersion);
  assert.equal((await engine.getPlan(planDeclaration, plan.id, { actorId: "lily", permissions: ["plan.read"] })).hash, plan.hash);
});

test("runtime-neutral conversations retain separate auditable work segments", async () => {
  const engine = new OmniSeed({ store: new MemoryStateStore(), providers: new ProviderRegistry() });
  const first = await engine.startCompanyWork(declaration, { intent: "Inspect the company" }, lily);
  await engine.attachCompanyWorkSession(declaration, first.id, { protocolId: "example.agent/2", runtimeSessionId: "opaque-7", cursor: 4, continuation: { credential: "server-secret" } }, lily);
  await engine.recordCompanyWorkEvent(declaration, first.id, { status: "completed", event: { id: "done-1", type: "outcome_recorded" } }, lily);
  const second = await engine.startCompanyWork(declaration, { intent: "Now improve it", conversationId: first.conversationId }, lily);
  assert.notEqual(second.id, first.id);
  assert.equal(second.conversationId, first.conversationId);
  assert.deepEqual(second.session, { protocolId: "example.agent/2", runtimeSessionId: "opaque-7", cursor: 4, lastEventId: "done-1", turnId: null });
  assert.doesNotMatch(JSON.stringify(second), /server-secret/);
  assert.equal((await engine.getCompanyWork(declaration, second.id, lily, { includeRuntime: true })).session.continuation.credential, "server-secret");
});

test("exact governance facts create one restart-safe claimable continuation", async () => {
  const workStore = new MemoryCompanyWorkStore(), first = new OmniSeed({ store: new MemoryStateStore(), workStore, providers: new ProviderRegistry() });
  const run = await first.startCompanyWork(declaration, { intent: "Wait for approval" }, lily);
  await first.attachCompanyWorkSession(declaration, run.id, { protocolId: "fake.agent/1", runtimeSessionId: "session-a", continuation: "private" }, lily);
  await first.recordCompanyWorkEvent(declaration, run.id, { status: "waiting_for_company_approval", awaited: { type: "company_approval", reference: { proposalId: "proposal-a", proposalHash: "hash-a" } }, associations: { proposalIds: ["proposal-a"] }, event: { id: "wait-1", type: "governance_wait" } }, lily);
  assert.deepEqual(await first.emitCompanyWorkFact("acme", { type: "company_approval", proposalId: "another", proposalHash: "hash-a" }), []);
  const [created] = await first.emitCompanyWorkFact("acme", { type: "company_approval", proposalId: "proposal-a", proposalHash: "hash-a" });
  assert.equal((await first.emitCompanyWorkFact("acme", { type: "company_approval", proposalId: "proposal-a", proposalHash: "hash-a" })).length, 0);
  const restarted = new OmniSeed({ store: new MemoryStateStore(), workStore, providers: new ProviderRegistry() });
  const claimed = await restarted.claimCompanyWorkContinuation(declaration, { protocolId: "fake.agent/1", claimantId: "adapter-a" }, lily);
  assert.equal(claimed.id, created.id);
  await restarted.completeCompanyWorkContinuation(declaration, claimed.id, { claimantId: "adapter-a" }, lily);
  assert.equal((await restarted.getCompanyWork(declaration, run.id, lily)).status, "running");
  assert.equal(await restarted.claimCompanyWorkContinuation(declaration, { protocolId: "fake.agent/1", claimantId: "adapter-a" }, lily), null);
});

test("cancelled work cannot claim a delayed continuation", async () => {
  const engine = new OmniSeed({ store: new MemoryStateStore(), providers: new ProviderRegistry() });
  const run = await engine.startCompanyWork(declaration, { intent: "Wait" }, lily);
  await engine.attachCompanyWorkSession(declaration, run.id, { protocolId: "fake.agent/1", runtimeSessionId: "session-b", continuation: "private" }, lily);
  await engine.recordCompanyWorkEvent(declaration, run.id, { status: "waiting_for_merge", awaited: { type: "merge", reference: { proposalId: "p" } }, event: { id: "wait", type: "governance_wait" } }, lily);
  await engine.emitCompanyWorkFact("acme", { type: "merge", proposalId: "p", mergeCommitSha: "abc" });
  await engine.cancelCompanyWork(declaration, run.id, lily);
  assert.equal(await engine.claimCompanyWorkContinuation(declaration, { protocolId: "fake.agent/1" }, lily), null);
});
