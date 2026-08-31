import test from "node:test";
import assert from "node:assert/strict";
import { ProviderImplementationCatalog, validateProviderManifest } from "../src/index.js";

const load = async () => ({});

test("multiple compatible Provider claims fail closed as ambiguous", () => {
  const catalog = new ProviderImplementationCatalog([
    claim({ version: "1.0.0" }),
    claim({ version: "1.1.0" })
  ]);

  assert.throws(
    () => catalog.resolve("example", ["connectors"], "1.0.0"),
    error => {
      assert.equal(error.code, "provider_implementation_ambiguous");
      assert.equal(error.details.providerId, "example");
      assert.deepEqual(error.details.versions, ["1.0.0", "1.1.0"]);
      return true;
    }
  );
});

test("validateProviderManifest rejects malformed required fields", () => {
  for (const field of ["id", "organisation", "version", "engineCompatibility"]) {
    assertManifestInvalid({ [field]: "" }, `empty ${field}`);
  }
  assertManifestInvalid(null, "missing manifest");
  assertManifestInvalid([], "array manifest");
});

test("validateProviderManifest rejects unsupported and malformed versions", () => {
  assertManifestError({ manifestVersion: "2.0" }, "provider_manifest_incompatible", "unsupported manifest version");
  assertManifestInvalid({ version: "latest" }, "non-semantic implementation version");
});

test("validateProviderManifest rejects malformed primitive families", () => {
  assertManifestInvalid({ primitiveFamilies: "connectors" }, "non-array families");
  assertManifestInvalid({ primitiveFamilies: [] }, "empty families");
  assertManifestInvalid({ primitiveFamilies: ["systems"] }, "non-canonical family");
});

test("validateProviderManifest rejects malformed product metadata", () => {
  assertManifestInvalid({ implementations: "connectors" }, "non-array implementations");
  assertManifestInvalid({ implementations: [] }, "missing advertised family metadata");
  assertManifestInvalid({ implementations: [{ family: "connectors", products: [] }] }, "empty products");
  assertManifestInvalid({ implementations: [{ family: "connectors", products: [null] }] }, "non-string product");
  assertManifestInvalid({ implementations: [{ family: "workflows", products: ["Example"] }] }, "unadvertised implementation family");
});

test("validateProviderManifest rejects malformed metadata arrays", () => {
  for (const field of ["operations", "observationTypes", "evidenceTypes", "permissions"]) {
    assertManifestInvalid({ [field]: "invalid" }, `non-array ${field}`);
    assertManifestInvalid({ [field]: [""] }, `non-string-or-empty ${field} item`);
  }
});

test("validateProviderManifest rejects a malformed configuration contract", () => {
  assertManifestInvalid({ configurationSchema: "" }, "empty configuration schema");
  assertManifestInvalid({ configurationSchema: {} }, "non-string configuration schema");
});

test("ProviderImplementationCatalog rejects a malformed load contract", () => {
  assert.throws(
    () => new ProviderImplementationCatalog([{ manifest: manifest(), load: "./provider.js" }]),
    error => error.code === "provider_loader_invalid"
  );
});

function claim(overrides = {}) {
  return { manifest: manifest(overrides), load };
}

function manifest(overrides = {}) {
  return {
    manifestVersion: "1.0",
    id: "example",
    organisation: "Example Organisation",
    version: "1.0.0",
    engineCompatibility: ">=1.0.0 <2.0.0",
    primitiveFamilies: ["connectors"],
    implementations: [{ family: "connectors", products: ["Example Product"] }],
    operations: [],
    observationTypes: [],
    evidenceTypes: ["provider_status"],
    permissions: [],
    configurationSchema: "./configuration.schema.json",
    ...structuredClone(overrides)
  };
}

function assertManifestInvalid(overrides, description) {
  assertManifestError(overrides, "provider_manifest_invalid", description);
}

function assertManifestError(overrides, code, description) {
  assert.throws(() => validateProviderManifest(overrides === null || Array.isArray(overrides) ? overrides : manifest(overrides)), error => error.code === code, description);
}
