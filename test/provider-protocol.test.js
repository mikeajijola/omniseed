import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseOmniform } from "@omniseed/omniform";
import { assembleRuntime, connectStdioProvider, MemoryStateStore, OmniSeed, ProviderRegistry, StdioJsonRpcTransport } from "../src/index.js";

const python = process.env.PYTHON ?? "python3";
const script = fileURLToPath(new URL("../examples/providers/python_reference_provider.py", import.meta.url));
const owner = { actorId: "owner", permissions: ["plan.create", "plan.approve", "plan.apply", "state.reconcile"] };
const pythonAvailable = spawnSync(python, ["--version"], { encoding: "utf8" }).status === 0;
if (!pythonAvailable) throw new Error(`Python 3 is required to prove the language-independent Provider Protocol (command: ${python})`);

const declaration = parseOmniform(`apiVersion: omniform.org/v1alpha1
kind: Company
metadata: { id: protocol_test, name: Protocol Test Company }
spec:
  providers: { connectors: { provider: python_reference } }
  capabilities:
    - id: public_service
      name: Public Service
      requires: [{ id: access_service, primitiveFamily: connectors }]
  operations:
    - { id: get_capability, capability: public_service, description: Get capability, input: {}, output: {}, mutation: false, permissions: [], approval: none, interfaces: [api] }
`);

async function connect(mode = "normal", options = {}) {
  return connectStdioProvider({
    command: python,
    args: [script],
    expectedProviderId: "python_reference",
    startupTimeoutMs: 500,
    requestTimeoutMs: 500,
    ...options,
    context: { companyId: "protocol_test" },
    configuration: { mode },
    // The reference provider uses an environment mode, injected through a tiny Python launcher.
    ...(mode === "normal" ? {} : { command: python, args: ["-c", launcher(mode), script] })
  });
}

test("Python Provider completes the real plan, approve, apply, observe, persist, recompile and reconcile lifecycle", { skip: !pythonAvailable }, async t => {
  const provider = await connect(); t.after(() => provider.shutdown());
  const store = new MemoryStateStore(), providers = new ProviderRegistry().register(provider), engine = new OmniSeed({ store, providers });
  assert.equal((await engine.inspect(declaration)).capabilities[0].state, "missing");
  const plan = await engine.plan(declaration, owner);
  assert.equal(plan.actions.length, 1); assert.equal(plan.actions[0].provider, "python_reference");
  const approval = await engine.approve(plan, [plan.actions[0].id], owner);
  const applied = await engine.apply(declaration, plan, approval, owner);
  assert.equal(applied.results[0].deployment.providerResourceId, "python_reference/systems/python_service");
  assert.equal(applied.results[0].observation.status, "healthy");
  assert.equal(applied.state.evidence[0].source, "python_reference");
  assert.equal(applied.registry.capabilities[0].state, "realised");
  const reconciled = await engine.reconcile(declaration, owner);
  assert.equal(reconciled.resources[0].observed.status, "healthy");
  const persisted = await store.load("protocol_test");
  assert.equal(persisted.deployed.length, 1); assert.equal(persisted.observed.length, 1); assert.equal(persisted.evidence.length, 1);
  assert.deepEqual(await provider.invoke("echo", { value: 42 }, owner), { echo: { value: 42 }, actor: owner });
});

test("existing in-process JavaScript Providers still use the normalized handle", async () => {
  const calls = [];
  const js = {
    metadata: { id: "js", families: ["connectors"], offerings: [] },
    status: { implementation_available: true, configured: true, connected: true, healthy: true },
    async validate(action) { calls.push(["validate", action.id]); return { valid: true, issues: [] }; },
    async plan(action) { calls.push(["plan", action.id]); return {}; },
    async apply(action) { calls.push(["apply", action.id]); return {}; },
    async observe(resource) { calls.push(["observe", resource.id]); return { status: "healthy", checkedAt: new Date().toISOString(), evidence: [] }; }
  };
  const handle = new ProviderRegistry().register(js).require("js");
  assert.equal(handle.kind, "in_process"); await handle.validate({ id: "a" }); assert.deepEqual(calls, [["validate", "a"]]);
});

test("generic discovery assembles a protocol-backed implementation through the normalized handle", async () => {
  const claim = {
    manifest: {
      manifestVersion: "1.0", id: "python_reference", organisation: "Python Reference", version: "1.0.0", engineCompatibility: ">=1.0.0 <2.0.0",
      primitiveFamilies: ["connectors"], implementations: [{ family: "connectors", products: ["protocol test double"] }],
      operations: ["echo"], configurationSchema: "./configuration.schema.json", observationTypes: ["provider_status"], evidenceTypes: ["provider_status"], permissions: []
    },
    load: ({ configuration, context }) => connectStdioProvider({ command: "python3", args: [script], expectedProviderId: "python_reference", configuration, context })
  };
  const runtime = await assembleRuntime({ declaration, store: new MemoryStateStore(), providerImplementations: [claim] });
  assert.equal(runtime.providers.get("python_reference").kind, "protocol");
  assert.equal(runtime.assemblyDiagnostics[0].state, "healthy");
  assert.equal(runtime.assemblyDiagnostics[0].implementation.kind, "protocol");
  await runtime.close();
});

test("missing executable fails before registration", async () => {
  await assert.rejects(connectStdioProvider({ command: "/definitely/not/an/omniseed-provider", expectedProviderId: "python_reference", startupTimeoutMs: 100 }), error => error.code === "provider_executable_missing");
});
test("startup failure is isolated", { skip: !pythonAvailable }, async () => {
  await assert.rejects(connect("startup_failure"), error => ["provider_process_crashed", "provider_process_unavailable"].includes(error.code));
});
test("protocol version mismatch is rejected", { skip: !pythonAvailable }, async () => {
  await assert.rejects(connect("version_mismatch"), error => error.code === "protocol_version_mismatch");
});
test("Provider ID mismatch is rejected", { skip: !pythonAvailable }, async () => {
  await assert.rejects(connect("id_mismatch"), error => error.code === "provider_id_mismatch");
});
test("malformed JSON response fails safely", { skip: !pythonAvailable }, async () => {
  await assert.rejects(connect("malformed"), error => error.code === "malformed_provider_response");
});
test("stderr remains diagnostic and does not corrupt responses", { skip: !pythonAvailable }, async t => {
  let diagnostic = ""; const provider = await connect("diagnostic", { onDiagnostic: chunk => { diagnostic += chunk; } }); t.after(() => provider.shutdown());
  assert.match(diagnostic, /python provider diagnostic/); assert.equal(provider.metadata.id, "python_reference");
});
test("provider crash rejects apply and leaves canonical state unchanged", { skip: !pythonAvailable }, async () => {
  const provider = await connect("crash"), store = new MemoryStateStore(), engine = new OmniSeed({ store, providers: new ProviderRegistry().register(provider) });
  const plan = await engine.plan(declaration, owner), approval = await engine.approve(plan, plan.actions.map(item => item.id), owner);
  await assert.rejects(engine.apply(declaration, plan, approval, owner), error => error.code === "provider_process_crashed");
  const state = await store.load("protocol_test");
  assert.equal(state.deployed.length, 0); assert.equal(state.observed.length, 0); assert.equal(state.evidence.length, 0); assert.equal(state.plans[0].status, "approved"); assert.equal(state.plans[0].approval.planHash, plan.hash);
});
test("request timeout closes startup without registering a Provider", { skip: !pythonAvailable }, async () => {
  await assert.rejects(connect("timeout", { requestTimeoutMs: 50 }), error => error.code === "provider_request_timeout");
});
test("unsupported protocol method returns a correlated remote error", { skip: !pythonAvailable }, async t => {
  const transport = new StdioJsonRpcTransport({ command: python, args: [script], requestTimeoutMs: 500 }); await transport.start(); t.after(() => transport.close());
  await assert.rejects(transport.request("provider.unknown", {}), error => error.code === "provider_remote_error" && error.details.remote.code === -32601);
});
test("invalid response shape is rejected", { skip: !pythonAvailable }, async () => {
  await assert.rejects(connect("invalid_response"), error => error.code === "invalid_provider_response");
});
test("invalid apply response cannot enter canonical state", { skip: !pythonAvailable }, async t => {
  const provider = await connect("invalid_apply"); t.after(() => provider.shutdown());
  const store = new MemoryStateStore(), engine = new OmniSeed({ store, providers: new ProviderRegistry().register(provider) });
  const plan = await engine.plan(declaration, owner), approval = await engine.approve(plan, plan.actions.map(item => item.id), owner);
  await assert.rejects(engine.apply(declaration, plan, approval, owner), error => error.code === "invalid_provider_response");
  const state = await store.load("protocol_test");
  assert.equal(state.deployed.length, 0); assert.equal(state.evidence.length, 0); assert.equal(state.plans[0].status, "approved"); assert.equal(state.plans[0].approval.planHash, plan.hash);
});
test("unhealthy external Provider remains a truthful distinct state", { skip: !pythonAvailable }, async t => {
  const provider = await connect("unhealthy"); t.after(() => provider.shutdown());
  const registry = new ProviderRegistry().register(provider), status = registry.statusForDesired("connectors", "python_reference");
  assert.deepEqual({ implementation_available: status.implementation_available, configured: status.configured, connected: status.connected, healthy: status.healthy, state: status.state }, { implementation_available: true, configured: true, connected: true, healthy: false, state: "unhealthy" });
  const inspected = await new OmniSeed({ store: new MemoryStateStore(), providers: registry }).inspect(declaration);
  assert.equal(inspected.providerGaps[0].state, "unhealthy"); assert.equal(inspected.capabilities[0].state, "missing");
});

function launcher(mode) {
  return `import os,runpy,sys;os.environ["OMNISEED_PYTHON_PROVIDER_MODE"]=${JSON.stringify(mode)};sys.argv=[${JSON.stringify(script)}];runpy.run_path(${JSON.stringify(script)},run_name="__main__")`;
}
