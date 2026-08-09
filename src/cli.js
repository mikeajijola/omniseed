#!/usr/bin/env node
import { resolve } from "node:path";
import { loadOmniform } from "@omniseed/omniform";
import { JsonStateStore, OmniSeed, ProviderRegistry } from "./index.js";

const args = process.argv.slice(2), command = args.shift();
const declarationPath = resolve(args.find(arg => !arg.startsWith("--")) ?? "omniform.yaml");
if (!command || !["validate", "inspect", "plan", "reconcile"].includes(command)) {
  console.error("Usage: omniseed <validate|inspect|plan|reconcile> [company.omniform.yaml|company.omniform.json] [--state path]");
  console.error("Apply requires an exact persisted plan and approval; use the runtime API/SDK.");
  process.exit(2);
}
const stateFlag = args.indexOf("--state"), statePath = resolve(stateFlag >= 0 ? args[stateFlag + 1] : ".omniseed/state.json");
const actor = { actorId: process.env.OMNISEED_ACTOR ?? "owner", permissions: ["plan.create", "state.reconcile"] };
try {
  const declaration = await loadOmniform(declarationPath);
  if (command === "validate") console.log(JSON.stringify({ valid: true, company: declaration.metadata }));
  const engine = new OmniSeed({ store: new JsonStateStore(statePath), providers: new ProviderRegistry() });
  if (command === "inspect") console.log(JSON.stringify(await engine.inspect(declaration), null, 2));
  if (command === "plan") console.log(JSON.stringify(await engine.plan(declaration, actor), null, 2));
  if (command === "reconcile") console.log(JSON.stringify(await engine.reconcile(declaration, actor), null, 2));
} catch (error) { console.error(JSON.stringify({ code: error.code ?? "error", message: error.message, details: error.details })); process.exitCode = 1; }
