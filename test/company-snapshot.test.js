import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseOmniform } from "@omniseed/omniform";
import { compareCompanySnapshot, createCompanySnapshot, MemoryStateStore, OmniSeed, ProviderRegistry } from "../src/index.js";

const fixture = JSON.parse(await readFile(new URL("./fixtures/company-snapshots.json", import.meta.url), "utf8"));

test("deterministic snapshot fixture is redacted and represents missing observation", () => {
  const snapshot = createCompanySnapshot(fixture.registry);
  assert.equal(snapshot.revision, fixture.expectedRevision);
  assert.equal(snapshot.resources[0].deployed.attributes.token, "[REDACTED]");
  assert.deepEqual(snapshot.resources[0].observation, { state: "missing", status: null, checkedAt: null, evidence: [] });
});

test("snapshot synchronization covers create, update, no-op, and stale identities", () => {
  const snapshot = createCompanySnapshot(fixture.registry);
  assert.equal(compareCompanySnapshot(null, snapshot).outcome, fixture.outcomes.create);
  assert.equal(compareCompanySnapshot({ ...snapshot, stateVersion: 6, revision: `sha256:${"0".repeat(64)}` }, snapshot).outcome, fixture.outcomes.update);
  assert.equal(compareCompanySnapshot(snapshot, snapshot).outcome, fixture.outcomes.noOp);
  assert.equal(compareCompanySnapshot({ ...snapshot, revision: `sha256:${"1".repeat(64)}` }, snapshot).outcome, fixture.outcomes.stale);
  assert.equal(compareCompanySnapshot({ ...snapshot, companyId: "other" }, snapshot).outcome, fixture.outcomes.stale);
  assert.equal(compareCompanySnapshot({ ...snapshot, stateVersion: 8, revision: `sha256:${"2".repeat(64)}` }, snapshot).outcome, fixture.outcomes.stale);
});

test("an observed resource changes the revision and preserves real observation identity", () => {
  const missing = createCompanySnapshot(fixture.registry);
  const registry = structuredClone(fixture.registry);
  registry.instance.observedStateRevision = 8;
  registry.instance.observedRevision = "git-desired-7";
  registry.resources[0].observed = { status: "healthy", checkedAt: "2026-08-31T00:00:00.000Z", evidence: [], privateKey: "never-return" };
  registry.resources[0].deployed.attributes.apiKey = "also-never-return";
  const observed = createCompanySnapshot(registry);
  assert.notEqual(observed.revision, missing.revision);
  assert.equal(observed.resources[0].observation.state, "observed");
  assert.equal(observed.resources[0].observation.status, "healthy");
  assert.equal(observed.resources[0].observation.privateKey, "[REDACTED]");
  assert.equal(observed.resources[0].deployed.attributes.apiKey, "[REDACTED]");
  assert.equal(compareCompanySnapshot(missing, observed).outcome, "update");
});

test("Engine authorizes and owns the snapshot projection", async () => {
  const declaration = parseOmniform(`apiVersion: omniform.org/v1alpha1
kind: Company
metadata: { id: acme, name: Acme }
spec:
  providers:
    connectors: { provider: absent }
  capabilities:
    - id: website
      name: Website
      requires: [{ id: public_interface, primitiveFamily: connectors }]
  operations:
    - { id: inspect_company, capability: website, description: Inspect, input: {}, output: {}, mutation: false, permissions: [company.read], approval: none, interfaces: [api] }
`);
  const engine = new OmniSeed({ store: new MemoryStateStore(), providers: new ProviderRegistry() });
  await assert.rejects(engine.getCompanySnapshot(declaration, { actorId: "guest", permissions: [] }), error => error.code === "authorization_denied");
  const result = await engine.getCompanySnapshot(declaration, { actorId: "reader", permissions: ["company.read"] });
  assert.equal(result.outcome, "create");
  assert.equal(result.snapshot.companyId, "acme");
});
