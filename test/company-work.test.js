import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseOmniform } from "@omniseed/omniform";
import { continuationEventFor, JsonCompanyWorkStore, JsonStateStore, MemoryCompanyWorkStore, MemoryStateStore, OmniSeed, ProviderRegistry } from "../src/index.js";

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

test("an unattached legacy company work run can attach its first session after on-disk migration", async () => {
  const path = join(await mkdtemp(join(tmpdir(), "omniseed-legacy-work-")), "state.json");
  const run = {
    id: "legacy-work", companyId: "acme", actorId: "lily", initiatedBy: "lily", intent: "Resume queued work", idempotencyKey: null,
    mode: "inspection", status: "queued", desiredRevisionAtStart: null, observedRevisionAtStart: null,
    session: { id: null, continuationToken: null, streamIndex: 0, lastEventId: null, turnId: null },
    associations: { operationIds: [], planIds: [], proposalIds: [], providerActionIds: [], evidenceIds: [], outcomeIds: [] },
    events: [{ id: "legacy-work:created", type: "company_work_started", at: "2026-01-01T00:00:00.000Z", summary: "Resume queued work" }],
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", completedAt: null,
  };
  await writeFile(path, `${JSON.stringify({ version: 1, companyId: "acme", runs: [run] })}\n`, "utf8");
  const engine = new OmniSeed({ store: new MemoryStateStore(), workStore: new JsonCompanyWorkStore(path), providers: new ProviderRegistry() });

  assert.equal((await engine.getCompanyWork(declaration, run.id, lily)).session, null);
  const attached = await engine.attachCompanyWorkSession(declaration, run.id, { protocolId: "example.agent/1", runtimeSessionId: "runtime-1", continuation: "private" }, lily);
  assert.deepEqual(attached.session, { protocolId: "example.agent/1", runtimeSessionId: "runtime-1", cursor: 0, lastEventId: null, turnId: null });
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

test("raw governance facts cannot be forged through the public Engine surface", async () => {
  const engine = new OmniSeed({ store: new MemoryStateStore(), providers: new ProviderRegistry() });
  assert.equal(engine.emitCompanyWorkFact, undefined);
  for (const fact of [
    { type: "merge", proposalId: "forged" },
    { type: "apply", planId: "forged" },
    { type: "company_approval", planId: "forged" },
    { type: "observation", observedRevision: "forged" },
  ]) await assert.rejects(Promise.resolve().then(() => engine.emitCompanyWorkFact("acme", fact)), error => error instanceof TypeError);
});

test("invalid low-level fact shapes fail before any durable work mutation", async () => {
  let saves = 0;
  const workStore = new MemoryCompanyWorkStore();
  const originalSave = workStore.save.bind(workStore);
  workStore.save = async (...args) => { saves += 1; return originalSave(...args); };
  const before = await workStore.load("acme");
  const run = { await: { type: "apply", reference: {} } };
  for (const fact of [
    null,
    { type: "company_approval", planId: "plan", proposalId: "proposal" },
    { type: "apply", planId: "plan", planHash: "not-a-digest", appliedActionIds: [] },
    { type: "observation", observedRevision: 7 },
    { type: "desired_revision", desiredRevision: {} },
    { type: "merge", proposalId: "proposal", proposalHash: "a".repeat(64), headSha: "head" },
    { type: "checks", proposalId: "proposal", proposalHash: "a".repeat(64), checks: [{}] },
    { type: "invented_governance_fact" },
  ]) assert.throws(() => continuationEventFor(run, fact), error => error.code === "company_work_fact_invalid");
  assert.deepEqual(await workStore.load("acme"), before);
  assert.equal(saves, 0);
});

test("plan governance operations emit continuation events through their real operation paths", async () => {
  const workStore = new MemoryCompanyWorkStore(), engine = new OmniSeed({ store: new MemoryStateStore(), workStore, providers: new ProviderRegistry() });
  const operator = { actorId: "owner", permissions: ["plan.create", "plan.approve", "plan.apply", "state.reconcile"] };
  const plan = await engine.plan(declaration, operator);
  const waits = [
    { status: "waiting_for_company_approval", awaited: { type: "company_approval", reference: { planId: plan.id, planHash: plan.hash } } },
    { status: "waiting_for_apply", awaited: { type: "apply", reference: { planId: plan.id, planHash: plan.hash } } },
    { status: "waiting_for_observation", awaited: { type: "observation", reference: {} } },
  ];
  for (const [index, wait] of waits.entries()) {
    const run = await engine.startCompanyWork(declaration, { intent: `Wait for ${wait.awaited.type}` }, lily);
    await engine.attachCompanyWorkSession(declaration, run.id, { protocolId: "fake.agent/1", runtimeSessionId: `session-${index}`, continuation: "private" }, lily);
    await engine.recordCompanyWorkEvent(declaration, run.id, { ...wait, event: { id: `wait-${index}`, type: "governance_wait" } }, lily);
  }

  const approval = await engine.approve(plan, [], operator);
  await engine.apply(declaration, plan, approval, operator);
  await engine.reconcile(declaration, operator);

  const workState = await workStore.load("acme");
  assert.deepEqual(workState.continuationEvents.map(event => event.fact.type).sort(), ["apply", "company_approval", "observation"]);
  for (const event of workState.continuationEvents) {
    const run = workState.runs.find(item => item.id === event.workSegmentId);
    assert.equal(event.id, continuationEventFor(run, event.fact, event.createdAt).id);
    if (event.fact.type !== "observation") assert.equal(event.fact.planHash, plan.hash);
  }
});

test("auxiliary continuation write failures do not report committed governance work as failed", async () => {
  const primary = new MemoryStateStore();
  const failingWorkStore = {
    state: new MemoryCompanyWorkStore(),
    async load(companyId) { return this.state.load(companyId); },
    async save() { throw new Error("company work storage unavailable"); },
  };
  const engine = new OmniSeed({ store: primary, workStore: failingWorkStore, providers: new ProviderRegistry() });
  const operator = { actorId: "owner", permissions: ["plan.create", "plan.approve", "plan.apply", "state.reconcile"] };
  const plan = await engine.plan(declaration, operator);
  const approval = await engine.approve(plan, [], operator);
  assert.equal((await primary.load("acme")).plans.find(item => item.id === plan.id).status, "approved");

  const applied = await engine.apply(declaration, plan, approval, operator);
  assert.equal(applied.plan.status, "applied");
  assert.equal((await primary.load("acme")).plans.find(item => item.id === plan.id).status, "applied");
  await engine.reconcile(declaration, operator);
  assert.equal((await primary.load("acme")).history.at(-1).type, "reconciled");
});

test("cancelled work cannot claim a delayed continuation", async () => {
  const engine = new OmniSeed({ store: new MemoryStateStore(), providers: new ProviderRegistry() });
  const operator = { actorId: "owner", permissions: ["plan.create", "plan.approve"] };
  const plan = await engine.plan(declaration, operator);
  const run = await engine.startCompanyWork(declaration, { intent: "Wait" }, lily);
  await engine.attachCompanyWorkSession(declaration, run.id, { protocolId: "fake.agent/1", runtimeSessionId: "session-b", continuation: "private" }, lily);
  await engine.recordCompanyWorkEvent(declaration, run.id, { status: "waiting_for_company_approval", awaited: { type: "company_approval", reference: { planId: plan.id, planHash: plan.hash } }, event: { id: "wait", type: "governance_wait" } }, lily);
  await engine.approve(plan, [], operator);
  await engine.cancelCompanyWork(declaration, run.id, lily);
  assert.equal(await engine.claimCompanyWorkContinuation(declaration, { protocolId: "fake.agent/1" }, lily), null);
});
