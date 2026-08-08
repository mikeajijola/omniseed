#!/usr/bin/env node
import { resolve } from "node:path";
import { loadOmniform } from "@omniseed/omniform";
import { JsonStateStore, OmniSeed, registryForDeclaration } from "./index.js";

const args = process.argv.slice(2);
const command = args.shift();
const declarationPath = resolve(args.find(arg => !arg.startsWith("--")) ?? "omniform.yaml");
if (!command || !["inspect", "plan", "apply", "reconcile"].includes(command)) {
  console.error("Usage: omniseed <inspect|plan|apply|reconcile> [omniform.yaml] [--approve] [--state path]");
  process.exit(2);
}
const stateFlag = args.indexOf("--state");
const statePath = resolve(stateFlag >= 0 ? args[stateFlag + 1] : ".omniseed/state.json");
try {
  const declaration = await loadOmniform(declarationPath);
  const engine = new OmniSeed({ store: new JsonStateStore(statePath), providers: registryForDeclaration(declaration) });
  if (command === "inspect") console.log(JSON.stringify(await engine.inspect(declaration), null, 2));
  if (command === "plan") console.log(JSON.stringify(await engine.plan(declaration), null, 2));
  if (command === "reconcile") console.log(JSON.stringify(await engine.reconcile(declaration), null, 2));
  if (command === "apply") {
    const plan = await engine.plan(declaration);
    console.log(JSON.stringify(await engine.apply(declaration, plan, { approved: args.includes("--approve") }), null, 2));
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
