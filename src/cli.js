#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { loadOmniform } from "@omniseed/omniform";
import { createRuntimeProviderRegistry, JsonStateStore, OmniSeed } from "./index.js";

const parsed = parseArgs(process.argv.slice(2)), command = parsed.command;
if (!command || !["validate", "inspect", "plan", "bootstrap", "approve", "apply", "reconcile", "redeploy", "export-os"].includes(command)) usage();
const declarationPath = resolve(parsed.positionals[0] ?? "company.omniform.yaml");
const statePath = resolve(parsed.flags.state ?? ".omniseed/state.json");
const authorization = {
  actorId: parsed.flags.actor ?? process.env.OMNISEED_ACTOR ?? "owner",
  permissions: ["company.read", "capability.read", "plan.create", "plan.approve", "plan.apply", "state.reconcile", "company_search.read"]
};

await main();

async function main() {
try {
  const declaration = await loadOmniform(declarationPath);
  if (command === "validate") return output({ valid: true, company: declaration.metadata }, parsed.flags.out);
  const providers = createRuntimeProviderRegistry({ declaration, vercel: {
    projectName: parsed.flags.project ?? process.env.VERCEL_PROJECT ?? "omniseed-os",
    productionUrl: parsed.flags.production ?? process.env.VERCEL_PRODUCTION_URL ?? "https://omniseed-os.vercel.app",
    sourcePath: parsed.flags.source ?? process.env.OMNISEED_OS_SOURCE ?? resolve("../omniseedos"),
    scope: parsed.flags.scope ?? process.env.VERCEL_SCOPE
  } });
  const engine = new OmniSeed({ store: new JsonStateStore(statePath), providers });
  if (command === "inspect") return output(await engine.inspect(declaration), parsed.flags.out);
  if (command === "export-os") return output(await engine.snapshot(declaration), required(parsed.flags.out, "--out is required"));
  if (command === "plan" || command === "bootstrap") {
    const plan = await engine.plan(declaration, authorization);
    return output(plan, parsed.flags.out ?? ".omniseed/plan.json");
  }
  if (command === "approve") {
    const plan = await readJson(required(parsed.flags.plan, "--plan is required"));
    const ids = parsed.flags.actions === "all" || !parsed.flags.actions ? plan.actions.map(item => item.id) : parsed.flags.actions.split(",");
    return output(await engine.approve(plan, ids, authorization), parsed.flags.out ?? ".omniseed/approval.json");
  }
  if (command === "apply") {
    const plan = await readJson(required(parsed.flags.plan, "--plan is required"));
    const approval = await readJson(required(parsed.flags.approval, "--approval is required"));
    return output(await engine.apply(declaration, plan, approval, authorization), parsed.flags.out);
  }
  if (command === "reconcile") return output(await engine.reconcile(declaration, authorization), parsed.flags.out);
  if (command === "redeploy") {
    const provider = providers.require("vercel"), desired = provider.createPreviewDeploymentResource();
    const action = { action: "create", family: "systems", resourceId: desired.id, provider: "vercel", providerOperation: "deploy_web_application", capabilityId: "company_operating_environment", desired, expectedExternalResult: { projectName: provider.projectName, target: "preview" }, risk: "medium", reversible: true, approvalRequirement: "required" };
    return output(await engine.planActions(declaration, [action], authorization), parsed.flags.out ?? ".omniseed/redeploy-plan.json");
  }
} catch (error) {
  console.error(JSON.stringify({ code: error.code ?? "error", message: error.message, details: error.details })); process.exitCode = 1;
}
}

function parseArgs(args) {
  const command = args.shift(), positionals = [], flags = {};
  for (let index = 0; index < args.length; index++) {
    const value = args[index];
    if (!value.startsWith("--")) { positionals.push(value); continue; }
    const key = value.slice(2), next = args[index + 1];
    flags[key] = next && !next.startsWith("--") ? (index++, next) : true;
  }
  return { command, positionals, flags };
}
function usage() {
  console.error("Usage: omniseed <validate|inspect|plan|bootstrap|approve|apply|reconcile|redeploy|export-os> company.omniform.yaml [options]");
  console.error("Plan: --state PATH --out PLAN.json. Approve: --plan PLAN.json --actions all --out APPROVAL.json. Apply: --plan PLAN.json --approval APPROVAL.json.");
  process.exit(2);
}
async function readJson(path) { return JSON.parse(await readFile(resolve(path), "utf8")); }
async function output(value, path) {
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  if (path) { const target = resolve(path); await mkdir(dirname(target), { recursive: true }); await writeFile(target, serialized, "utf8"); console.log(JSON.stringify({ written: target, id: value.id ?? value.plan?.id ?? null })); }
  else console.log(serialized);
}
function required(value, message) { if (!value) throw new Error(message); return value; }
