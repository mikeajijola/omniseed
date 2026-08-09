import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadOmniform } from "@omniseed/omniform";
import { createRuntimeProviderRegistry, JsonStateStore, OmniSeed, VercelProvider } from "../src/index.js";

const authorization = { actorId: "owner", permissions: ["plan.create", "plan.approve", "plan.apply", "state.reconcile"] };
const projectOutput = `General\n\nID\t\t\tprj_test\nName\t\t\tomniseed-os\nOwner\t\t\tTest`;
const deployment = { id: "dpl_existing", name: "omniseed-os", url: "omniseed-preview.vercel.app", target: "production", readyState: "READY", createdAt: 1, aliases: ["omniseed-os.vercel.app"] };

test("Vercel provider discovers and adopts existing resources without recreation", async t => {
  const calls = [], runner = async args => { calls.push(args); return args[0] === "project" ? projectOutput : JSON.stringify(deployment); };
  const provider = new VercelProvider({ projectName: "omniseed-os", productionUrl: "https://omniseed-os.vercel.app", runner });
  assert.equal((await provider.discover())[0].providerResourceId, "prj_test");
  const action = { id: "a1", family: "systems", resourceId: "project", desired: provider.metadata.offerings.find(item => item.id === "web_application_hosting").resource };
  const patch = (await provider.plan(action)).actionPatch;
  assert.equal(patch.providerOperation, "adopt_web_project");
  assert.equal((await provider.apply({ ...action, ...patch })).providerResourceId, "prj_test");
  assert.equal(calls.some(args => args[0] === "deploy"), false);
});

test("dogfood adoption persists, survives restart, observes independently, and realises capabilities", async t => {
  const directory = await mkdtemp(join(tmpdir(), "omniseed-vercel-test-")); t.after(() => rm(directory, { recursive: true, force: true }));
  const declaration = await loadOmniform(new URL("../../omniform/examples/omniseed-company/company.omniform.yaml", import.meta.url));
  const runner = async args => args[0] === "project" ? projectOutput : JSON.stringify(deployment);
  const options = { declaration, vercel: { projectName: "omniseed-os", productionUrl: "https://omniseed-os.vercel.app", runner } };
  const store = new JsonStateStore(join(directory, "state.json"));
  const engine = new OmniSeed({ store, providers: createRuntimeProviderRegistry(options) });
  assert.equal((await engine.inspect(declaration)).capabilities.find(item => item.id === "company_operating_environment").state, "missing");
  const plan = await engine.plan(declaration, authorization);
  assert.ok(plan.actions.every(action => action.approvalRequirement === "required"));
  assert.ok(plan.actions.filter(action => action.provider === "vercel").every(action => action.providerOperation.startsWith("adopt_")));
  const approval = await engine.approve(plan, plan.actions.map(item => item.id), authorization);
  const applied = await engine.apply(declaration, plan, approval, authorization);
  assert.equal(applied.registry.capabilities.find(item => item.id === "company_operating_environment").state, "realised");
  assert.ok(applied.state.evidence.some(item => item.source === "vercel"));
  const restarted = new OmniSeed({ store: new JsonStateStore(join(directory, "state.json")), providers: createRuntimeProviderRegistry(options) });
  const reconciled = await restarted.reconcile(declaration, authorization);
  assert.equal(reconciled.capabilities.find(item => item.id === "company_operating_environment").state, "realised");
  const persisted = JSON.parse(await readFile(join(directory, "state.json"), "utf8"));
  assert.ok(persisted.deployed.some(item => item.providerResourceId === "prj_test"));
});

test("preview redeploy uses deterministic Vercel action and observes READY", async () => {
  const calls = [], preview = { ...deployment, id: "dpl_preview", target: null, url: "gen1-preview.vercel.app", aliases: [] };
  const runner = async args => { calls.push(args); if (args[0] === "deploy") return JSON.stringify({ type: "deployment", url: preview.url }); if (args[0] === "project") return projectOutput; return JSON.stringify(args[1].includes("gen1-preview") ? preview : deployment); };
  const provider = new VercelProvider({ projectName: "omniseed-os", productionUrl: "https://omniseed-os.vercel.app", sourcePath: "/safe/source", runner });
  const desired = provider.createPreviewDeploymentResource(), action = { id: "preview", family: "systems", resourceId: desired.id, providerOperation: "deploy_web_application", desired };
  const planned = { ...action, ...(await provider.plan(action)).actionPatch };
  const result = await provider.apply(planned), observed = await provider.observe({ ...result, desired });
  assert.equal(result.providerResourceId, "dpl_preview"); assert.equal(observed.status, "healthy");
  assert.ok(calls.find(args => args[0] === "deploy")); assert.equal(calls.some(args => args.includes("--prod")), false);
});

test("independent observation exposes non-ready drift without repair", async () => {
  const drifted = { ...deployment, readyState: "ERROR" }, provider = new VercelProvider({ projectName: "omniseed-os", productionUrl: "https://omniseed-os.vercel.app", runner: async args => args[0] === "project" ? projectOutput : JSON.stringify(drifted) });
  const observation = await provider.observe({ providerResourceId: "dpl_existing", attributes: deployment });
  assert.equal(observation.status, "unhealthy"); assert.equal(observation.evidence[0].value, "ERROR");
});

test("credential-gated Vercel integration discovers and observes the real project", { skip: process.env.VERCEL_INTEGRATION !== "1" }, async () => {
  const provider = new VercelProvider({ projectName: process.env.VERCEL_PROJECT ?? "omniseed-os", productionUrl: process.env.VERCEL_PRODUCTION_URL ?? "https://omniseed-os.vercel.app" });
  const [project] = await provider.discover();
  assert.equal(project.projectName, process.env.VERCEL_PROJECT ?? "omniseed-os");
  const deployment = await provider.inspectDeployment();
  assert.equal(deployment.readyState, "READY");
});
