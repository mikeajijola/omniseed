import { primitiveFamilies } from "@omniseed/omniform";
import { providerHandle } from "./provider.js";

export const providerPackageManifestVersion = "1.0";

/** Explicit, server-side catalog of installed Provider implementation claims. */
export class ProviderImplementationCatalog {
  #claims = [];
  constructor(claims = []) { for (const claim of claims) this.add(claim); }
  add(claim) {
    validateProviderManifest(claim?.manifest);
    if (typeof claim.load !== "function") throw discoveryError("provider_loader_invalid", `Provider ${claim?.manifest?.id ?? "unknown"} requires a load function`);
    this.#claims.push(claim);
    return this;
  }
  resolve(providerId, families, engineVersion) {
    const identified = this.#claims.filter(claim => claim.manifest.id === providerId);
    if (!identified.length) throw discoveryError("provider_implementation_unavailable", `No installed implementation claim is available for Provider ${providerId}`, { providerId, families });
    const familyCompatible = identified.filter(claim => families.every(family => claim.manifest.primitiveFamilies.includes(family)));
    if (!familyCompatible.length) throw discoveryError("provider_family_incompatible", `Installed Provider ${providerId} does not support selected primitive families: ${families.join(", ")}`, { providerId, families, advertisedFamilies: unique(identified.flatMap(claim => claim.manifest.primitiveFamilies)) });
    const compatible = familyCompatible.filter(claim => satisfiesEngineCompatibility(engineVersion, claim.manifest.engineCompatibility));
    if (!compatible.length) throw discoveryError("provider_engine_incompatible", `Installed Provider ${providerId} is incompatible with Engine ${engineVersion}`, { providerId, engineVersion, compatibility: familyCompatible.map(claim => claim.manifest.engineCompatibility) });
    if (compatible.length > 1) throw discoveryError("provider_implementation_ambiguous", `More than one compatible implementation claim is installed for Provider ${providerId}`, { providerId, versions: compatible.map(claim => claim.manifest.version) });
    return compatible[0];
  }
}

export async function activateProviderImplementation({ claim, providerId, families, configuration = {}, context = {}, onEvidence } = {}) {
  const evidence = [];
  const record = (stage, state, details = {}) => {
    const item = { stage, state, providerId, implementationVersion: claim.manifest.version, families: [...families], ...details };
    evidence.push(item); onEvidence?.(structuredClone(item)); return item;
  };
  record("implementation", "available", { manifestVersion: claim.manifest.manifestVersion, organisation: claim.manifest.organisation });
  let handle;
  let stage = "load";
  try {
    handle = providerHandle(await claim.load({ configuration: structuredClone(configuration), context: structuredClone(context) }));
    assertImplementation(handle, claim.manifest, providerId, families);
    requireLifecycle(handle, "implementation_available", "provider_implementation_unavailable");
    record("load", "succeeded", { kind: handle.kind, implementationId: handle.metadata.id });
    stage = "configure";
    if (typeof handle.configure === "function") await handle.configure(configuration, context);
    requireLifecycle(handle, "configured", "provider_configuration_failed");
    record("configure", "succeeded");
    stage = "connect";
    if (typeof handle.connect === "function") await handle.connect(context);
    requireLifecycle(handle, "connected", "provider_connection_failed");
    record("connect", "succeeded");
    stage = "health";
    if (typeof handle.refreshStatus === "function") await handle.refreshStatus();
    else if (typeof handle.health === "function") {
      const health = await handle.health();
      if (health?.status) handle.status.healthy = health.status === "healthy";
    }
    requireLifecycle(handle, "healthy", "provider_unhealthy");
    record("health", "succeeded");
    return { handle, evidence };
  } catch (error) {
    if (handle) await Promise.resolve(handle.shutdown?.()).catch(() => {});
    const normalized = normalizeDiscoveryError(error, stage);
    record(stageForCode(normalized.code, stage), "failed", { reason: { code: normalized.code, message: normalized.message, details: normalized.details ?? {} } });
    normalized.evidence = evidence;
    throw normalized;
  }
}

export function validateProviderManifest(manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) throw discoveryError("provider_manifest_invalid", "Provider implementation claim requires a manifest");
  for (const field of ["id", "organisation", "version", "engineCompatibility"]) if (typeof manifest[field] !== "string" || !manifest[field]) throw discoveryError("provider_manifest_invalid", `Provider manifest requires ${field}`);
  if (manifest.manifestVersion !== providerPackageManifestVersion) throw discoveryError("provider_manifest_incompatible", `Provider manifest version ${manifest.manifestVersion ?? "missing"} is not supported`, { expected: providerPackageManifestVersion, actual: manifest.manifestVersion });
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(manifest.version)) throw discoveryError("provider_manifest_invalid", "Provider manifest version must be semantic versioning");
  if (!Array.isArray(manifest.primitiveFamilies) || !manifest.primitiveFamilies.length || manifest.primitiveFamilies.some(family => !primitiveFamilies.includes(family))) throw discoveryError("provider_manifest_invalid", "Provider manifest requires canonical primitiveFamilies");
  if (!Array.isArray(manifest.implementations) || manifest.implementations.some(item => !manifest.primitiveFamilies.includes(item?.family) || !Array.isArray(item.products) || !item.products.length || item.products.some(product => typeof product !== "string" || !product))) throw discoveryError("provider_manifest_invalid", "Provider manifest requires product metadata for each implementation family");
  const described = new Set(manifest.implementations.map(item => item.family));
  if (manifest.primitiveFamilies.some(family => !described.has(family))) throw discoveryError("provider_manifest_invalid", "Provider manifest must describe products for every advertised primitive family");
  for (const field of ["operations", "observationTypes", "evidenceTypes", "permissions"]) if (!Array.isArray(manifest[field]) || manifest[field].some(item => typeof item !== "string" || !item)) throw discoveryError("provider_manifest_invalid", `Provider manifest requires ${field} as an array of strings`);
  if (typeof manifest.configurationSchema !== "string" || !manifest.configurationSchema) throw discoveryError("provider_manifest_invalid", "Provider manifest requires configurationSchema");
  return manifest;
}

export function renderProviderAssemblyDiagnostics(diagnostics) {
  return diagnostics.map(item => {
    const families = item.families.join(", ");
    const version = item.implementation?.version ? ` implementation ${item.implementation.version}` : "";
    const reason = item.failure ? `; ${item.failure.code}: ${item.failure.message}` : "";
    return `${item.providerId} [${families}]: ${item.state}${version}${reason}`;
  }).join("\n");
}

export function satisfiesEngineCompatibility(version, range) {
  const actual = parseVersion(version);
  if (!actual || typeof range !== "string") return false;
  return range.trim().split(/\s+/).every(term => {
    if (term === "*" || term === "x") return true;
    const match = term.match(/^(\^|~|>=|<=|>|<|=)?(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
    if (!match) return false;
    const expected = [Number(match[2]), Number(match[3] ?? 0), Number(match[4] ?? 0)];
    const comparison = compare(actual, expected), operator = match[1] ?? "=";
    if (operator === ">=") return comparison >= 0;
    if (operator === "<=") return comparison <= 0;
    if (operator === ">") return comparison > 0;
    if (operator === "<") return comparison < 0;
    if (operator === "^") return comparison >= 0 && actual[0] === expected[0];
    if (operator === "~") return comparison >= 0 && actual[0] === expected[0] && actual[1] === expected[1];
    return comparison === 0;
  });
}

function assertImplementation(handle, manifest, providerId, families) {
  if (handle.metadata.id !== providerId || handle.metadata.id !== manifest.id) throw discoveryError("provider_id_mismatch", `Expected Provider ${providerId}, received ${handle.metadata.id}`);
  if (handle.metadata.version !== manifest.version) throw discoveryError("provider_version_mismatch", `Provider ${providerId} loaded version ${handle.metadata.version}, manifest claims ${manifest.version}`);
  if (!Array.isArray(handle.metadata.families) || handle.metadata.families.some(family => !manifest.primitiveFamilies.includes(family)) || manifest.primitiveFamilies.some(family => !handle.metadata.families.includes(family))) throw discoveryError("provider_family_mismatch", `Loaded Provider ${providerId} primitive families do not match its manifest`, { manifestFamilies: manifest.primitiveFamilies, loadedFamilies: handle.metadata.families ?? [] });
  const unsupported = families.filter(family => !handle.metadata.families?.includes(family));
  if (unsupported.length) throw discoveryError("provider_family_incompatible", `Loaded Provider ${providerId} does not advertise selected primitive families: ${unsupported.join(", ")}`);
}
function requireLifecycle(handle, key, code) {
  if (handle.status?.[key] !== true) throw discoveryError(code, `Provider ${handle.metadata.id} is not ${key}`, { status: { ...handle.status } });
}
function stageForCode(code, fallback = "load") {
  if (code.includes("configuration")) return "configure";
  if (code.includes("connection")) return "connect";
  if (code.includes("unhealthy") || code.includes("health")) return "health";
  return fallback;
}
function parseVersion(value) { const match = String(value).match(/^(\d+)\.(\d+)\.(\d+)/); return match ? match.slice(1).map(Number) : null; }
function compare(a, b) { for (let index = 0; index < 3; index++) if (a[index] !== b[index]) return a[index] - b[index]; return 0; }
function unique(values) { return [...new Set(values)].sort(); }
function discoveryError(code, message, details = {}) { return Object.assign(new Error(message), { code, details }); }
function normalizeDiscoveryError(error, stage) {
  if (error?.code) return error;
  const codes = { load: "provider_load_failed", configure: "provider_configuration_failed", connect: "provider_connection_failed", health: "provider_health_failed" };
  return discoveryError(codes[stage] ?? "provider_load_failed", error?.message ?? `Provider ${stage} failed`);
}
