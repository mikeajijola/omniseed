import { StdioJsonRpcTransport } from "./transports/stdio-json-rpc.js";

export const providerProtocolVersion = "omniseed.provider.protocol/1.0";
export const providerProtocolMethods = Object.freeze([
  "provider.initialize", "provider.status", "provider.validate", "provider.plan",
  "provider.apply", "provider.observe", "provider.invoke", "provider.shutdown"
]);

export class ProviderProtocolError extends Error {
  constructor(code, message, details = {}) { super(message); this.name = "ProviderProtocolError"; this.code = code; this.details = details; }
}

/** A ProviderHandle backed by a language-neutral protocol transport. */
export class ProtocolProviderHandle {
  constructor({ transport, metadata, status }) {
    this.transport = transport; this.metadata = metadata; this.status = status;
    this.kind = "protocol"; this.providerHandle = true;
  }
  static async connect({ transport, expectedProviderId, configuration = {}, context = {}, startupTimeoutMs = 2000 } = {}) {
    if (!transport?.start || !transport?.request || !transport?.close) throw new ProviderProtocolError("provider_transport_invalid", "Provider transport must implement start, request, and close");
    try {
      await transport.start();
      const initialized = await transport.request("provider.initialize", { protocolVersion: providerProtocolVersion, configuration, context }, { timeoutMs: startupTimeoutMs });
      const metadata = validateInitialization(initialized, expectedProviderId);
      const status = validateStatus(await transport.request("provider.status", {}));
      return new ProtocolProviderHandle({ transport, metadata, status });
    } catch (error) {
      await transport.close();
      throw normalizeError(error, "provider_startup_failed");
    }
  }
  async refreshStatus() { this.status = validateStatus(await this.#request("provider.status", {})); return this.status; }
  async validate(action) { return validateValidation(await this.#request("provider.validate", { action })); }
  async plan(action) { return validateProviderPlan(await this.#request("provider.plan", { action }), action); }
  async apply(action) { return validateApply(await this.#request("provider.apply", { action })); }
  async observe(resource) { return validateObservation(await this.#request("provider.observe", { resource })); }
  async invoke(operation, input, actor) { return this.#request("provider.invoke", { operation, input, actor }); }
  async index(input, actor) { return this.invoke("index", input, actor); }
  async update(input, actor) { return this.invoke("update", input, actor); }
  async remove(input, actor) { return this.invoke("remove", input, actor); }
  async search(input, actor) { return this.invoke("search", input, actor); }
  async retrieve(input, actor) { return this.invoke("retrieve", input, actor); }
  async shutdown() {
    if (this.transport.closed) return;
    try { await this.#request("provider.shutdown", {}); }
    finally { await this.transport.close(); }
  }
  async #request(method, params) {
    try { return await this.transport.request(method, params); }
    catch (error) { throw normalizeError(error, "provider_protocol_failed"); }
  }
}

export async function connectStdioProvider({ command, args = [], startupTimeoutMs = 2000, requestTimeoutMs = 2000, onDiagnostic, ...protocolOptions } = {}) {
  const transport = new StdioJsonRpcTransport({ command, args, startupTimeoutMs, requestTimeoutMs, onDiagnostic });
  return ProtocolProviderHandle.connect({ ...protocolOptions, transport, startupTimeoutMs });
}

function validateInitialization(value, expectedProviderId) {
  const result = validateObject(value, "provider.initialize");
  if (result.protocolVersion !== providerProtocolVersion) throw new ProviderProtocolError("protocol_version_mismatch", `Provider protocol ${result.protocolVersion ?? "missing"} is not supported`, { expected: providerProtocolVersion, actual: result.protocolVersion });
  if (!result.provider?.id || !result.provider.version) throw new ProviderProtocolError("invalid_provider_response", "Provider initialization requires provider id and version");
  if (expectedProviderId && result.provider.id !== expectedProviderId) throw new ProviderProtocolError("provider_id_mismatch", `Expected Provider ${expectedProviderId}, received ${result.provider.id}`);
  const families = requireStrings(result.primitiveFamilies, "primitiveFamilies", true);
  const methods = requireStrings(result.methods, "methods", true);
  const missingMethods = providerProtocolMethods.filter(method => !methods.includes(method));
  if (missingMethods.length) throw new ProviderProtocolError("protocol_method_missing", `Provider does not advertise required methods: ${missingMethods.join(", ")}`);
  const offerings = Array.isArray(result.offerings) ? result.offerings : invalid("offerings must be an array");
  if (offerings.some(item => !item || typeof item !== "object" || typeof item.family !== "string" || typeof item.id !== "string" || !families.includes(item.family))) invalid("offerings must declare an id in an advertised primitive family");
  const operations = requireStrings(result.operations ?? [], "operations");
  return { id: result.provider.id, name: result.provider.name ?? result.provider.id, version: result.provider.version, protocolVersion: result.protocolVersion, families, offerings, operations, methods };
}
function validateStatus(value) {
  const result = validateObject(value, "provider.status"), status = {};
  for (const key of ["implementation_available", "configured", "connected", "healthy"]) {
    if (typeof result[key] !== "boolean") throw new ProviderProtocolError("invalid_provider_response", `provider.status requires boolean ${key}`);
    status[key] = result[key];
  }
  return status;
}
function validateValidation(value) {
  const result = validateObject(value, "provider.validate");
  if (typeof result.valid !== "boolean" || !Array.isArray(result.issues)) throw new ProviderProtocolError("invalid_provider_response", "provider.validate requires valid and issues");
  return result;
}
function validateProviderPlan(value, action) {
  const result = validateObject(value, "provider.plan");
  if (result.deterministic !== true || result.actionId !== action.id) throw new ProviderProtocolError("invalid_provider_response", "provider.plan must confirm deterministic planning for the supplied action ID");
  return result;
}
function validateApply(value) {
  const result = validateObject(value, "provider.apply");
  if (typeof result.providerResourceId !== "string" || !result.providerResourceId || typeof result.status !== "string") throw new ProviderProtocolError("invalid_provider_response", "provider.apply requires providerResourceId and status");
  if (result.attributes !== undefined && (!result.attributes || typeof result.attributes !== "object" || Array.isArray(result.attributes))) throw new ProviderProtocolError("invalid_provider_response", "provider.apply attributes must be an object");
  return result;
}
function validateObservation(value) {
  const result = validateObject(value, "provider.observe");
  if (typeof result.status !== "string" || typeof result.checkedAt !== "string" || !Array.isArray(result.evidence)) throw new ProviderProtocolError("invalid_provider_response", "provider.observe requires status, checkedAt, and evidence");
  if (result.evidence.some(item => !item || typeof item !== "object" || typeof item.source !== "string" || !item.source)) throw new ProviderProtocolError("invalid_provider_response", "provider.observe evidence requires a source");
  return result;
}
function validateObject(value, method) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ProviderProtocolError("invalid_provider_response", `${method} must return an object`);
  return value;
}
function requireStrings(value, name, nonempty = false) {
  if (!Array.isArray(value) || (nonempty && !value.length) || value.some(item => typeof item !== "string" || !item)) invalid(`${name} must be ${nonempty ? "a non-empty" : "an"} array of strings`);
  return [...new Set(value)];
}
function invalid(message) { throw new ProviderProtocolError("invalid_provider_response", message); }
function normalizeError(error, fallback) { return error instanceof ProviderProtocolError ? error : new ProviderProtocolError(error.code ?? fallback, error.message, error.details); }
