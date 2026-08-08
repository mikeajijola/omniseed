export class OperationRegistry {
  #handlers = new Map();
  register(id, handler) { this.#handlers.set(id, handler); return this; }
  has(id) { return this.#handlers.has(id); }
  describe(operation, { providers = [] } = {}) {
    const dependencies = operation.providerDependencies ?? [];
    const providersHealthy = dependencies.every(family => providers.find(item => item.family === family)?.state === "healthy");
    const implemented = this.has(operation.id);
    return { ...operation, declared: true, implemented, handler: implemented ? operation.id : null, currentAvailability: implemented && providersHealthy ? "available" : implemented ? "provider_unavailable" : "unimplemented" };
  }
  async invoke(operation, input, context) {
    const handler = this.#handlers.get(operation.id);
    if (!handler) throw new EngineError("operation_unimplemented", `Operation is not implemented: ${operation.id}`);
    authorize(context.authorization, operation.permissions);
    return handler(input, context);
  }
}

export class EngineError extends Error { constructor(code, message, details = {}) { super(message); this.name = "EngineError"; this.code = code; this.details = details; } }
export function authorize(authorization, required = []) {
  if (!authorization?.actorId) throw new EngineError("authorization_denied", "actorId is required");
  const granted = new Set(authorization.permissions ?? []);
  const missing = required.filter(permission => !granted.has(permission));
  if (missing.length) throw new EngineError("authorization_denied", `Missing permissions: ${missing.join(", ")}`, { missing });
}
