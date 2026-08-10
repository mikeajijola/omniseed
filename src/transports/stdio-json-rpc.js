import { spawn } from "node:child_process";

export class ProviderTransportError extends Error {
  constructor(code, message, details = {}) { super(message); this.name = "ProviderTransportError"; this.code = code; this.details = details; }
}

/** Transport only: newline-delimited JSON-RPC 2.0 over child stdin/stdout. */
export class StdioJsonRpcTransport {
  constructor({ command, args = [], startupTimeoutMs = 2000, requestTimeoutMs = 2000, onDiagnostic = () => {} } = {}) {
    if (!command) throw new ProviderTransportError("provider_executable_missing", "Provider command is required");
    this.command = command; this.args = args; this.startupTimeoutMs = startupTimeoutMs; this.requestTimeoutMs = requestTimeoutMs; this.onDiagnostic = onDiagnostic;
    this.pending = new Map(); this.nextId = 1; this.buffer = ""; this.closed = false; this.started = false; this.child = null;
  }
  async start() {
    if (this.started) return;
    await new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => finish(new ProviderTransportError("provider_startup_timeout", `Provider process did not start within ${this.startupTimeoutMs}ms`)), this.startupTimeoutMs);
      const finish = error => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(); };
      try { this.child = spawn(this.command, this.args, { stdio: ["pipe", "pipe", "pipe"], windowsHide: true }); }
      catch (error) { finish(new ProviderTransportError("provider_executable_missing", error.message)); return; }
      this.child.once("spawn", () => { this.started = true; finish(); });
      this.child.once("error", error => finish(new ProviderTransportError(error.code === "ENOENT" ? "provider_executable_missing" : "provider_startup_failed", error.message)));
      this.child.stdout.setEncoding("utf8"); this.child.stdout.on("data", chunk => this.#receive(chunk));
      this.child.stderr.setEncoding("utf8"); this.child.stderr.on("data", chunk => this.onDiagnostic(chunk));
      this.child.on("exit", (code, signal) => this.#exit(code, signal));
    });
  }
  async request(method, params = {}, { timeoutMs = this.requestTimeoutMs } = {}) {
    if (!this.started || this.closed || !this.child?.stdin?.writable) throw new ProviderTransportError("provider_process_unavailable", "Provider process is not available");
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new ProviderTransportError("provider_request_timeout", `${method} timed out after ${timeoutMs}ms`, { method, timeoutMs })); }, timeoutMs);
      this.pending.set(id, { method, resolve, reject, timer });
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`, error => {
        if (!error) return;
        const pending = this.pending.get(id); if (!pending) return;
        clearTimeout(pending.timer); this.pending.delete(id); reject(new ProviderTransportError("provider_write_failed", error.message));
      });
    });
  }
  async close() {
    if (this.closed) return;
    this.closed = true; this.#rejectAll(new ProviderTransportError("provider_process_closed", "Provider transport closed"));
    if (!this.child) return;
    this.child.stdin?.end();
    if (this.child.exitCode === null && this.child.signalCode === null) await new Promise(resolve => {
      const timer = setTimeout(() => { this.child.kill("SIGKILL"); resolve(); }, 250);
      this.child.once("exit", () => { clearTimeout(timer); resolve(); });
    });
  }
  #receive(chunk) {
    this.buffer += chunk;
    let newline;
    while ((newline = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, newline); this.buffer = this.buffer.slice(newline + 1);
      if (!line.trim()) continue;
      let message;
      try { message = JSON.parse(line); }
      catch { this.#protocolFailure("Provider wrote malformed JSON to stdout", line); continue; }
      if (!message || message.jsonrpc !== "2.0" || !("id" in message) || (("result" in message) === ("error" in message))) { this.#protocolFailure("Provider wrote an invalid JSON-RPC response", line); continue; }
      const pending = this.pending.get(message.id);
      if (!pending) { this.#protocolFailure(`Provider returned unknown request id ${message.id}`, line); continue; }
      clearTimeout(pending.timer); this.pending.delete(message.id);
      if (message.error) pending.reject(new ProviderTransportError("provider_remote_error", message.error.message ?? "Provider returned an error", { method: pending.method, remote: message.error }));
      else pending.resolve(message.result);
    }
  }
  #protocolFailure(message, line) { this.#rejectAll(new ProviderTransportError("malformed_provider_response", message, { line })); }
  #exit(code, signal) {
    const wasClosed = this.closed; this.closed = true;
    if (!wasClosed) this.#rejectAll(new ProviderTransportError("provider_process_crashed", `Provider process exited with code ${code ?? "none"} signal ${signal ?? "none"}`, { code, signal }));
  }
  #rejectAll(error) { for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); } this.pending.clear(); }
}

