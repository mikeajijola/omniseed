import test from "node:test";
import assert from "node:assert/strict";
import { parseOmniform } from "@omniseed/omniform";
import { MemoryStateStore, OmniSeed, registryForDeclaration } from "../src/index.js";

const source = `
apiVersion: omniform.org/v1alpha1
kind: Company
metadata: { id: acme, name: Acme }
spec:
  providers:
    agents: { provider: local_agents }
  capabilities:
    - id: customer_support
      name: Customer Support
      requires: [{ id: receive_request }, { id: approve_refund }]
      realisation: { resources: [support_agent] }
  resources:
    agents:
      - id: support_agent
        name: Support Agent
        offers: [receive_request]
`;

test("plan, approval, apply, evidence, and partial capability form one deterministic loop", async () => {
  const declaration = parseOmniform(source);
  const engine = new OmniSeed({ store: new MemoryStateStore(), providers: registryForDeclaration(declaration) });
  const plan = await engine.plan(declaration);
  assert.equal(plan.actions.length, 1);
  assert.equal(plan.gaps[0].requirementId, "approve_refund");
  await assert.rejects(engine.apply(declaration, plan), /approval/);
  const result = await engine.apply(declaration, plan, { approved: true });
  assert.equal(result.registry.capabilities[0].state, "partial");
  assert.equal(result.state.evidence.length, 1);
});

test("stale plans cannot mutate state", async () => {
  const declaration = parseOmniform(source);
  const engine = new OmniSeed({ store: new MemoryStateStore(), providers: registryForDeclaration(declaration) });
  const plan = await engine.plan(declaration);
  await engine.apply(declaration, plan, { approved: true });
  await assert.rejects(engine.apply(declaration, plan, { approved: true }), /Stale plan/);
});
