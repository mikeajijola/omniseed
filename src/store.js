import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { emptyRuntimeState } from "./compiler.js";

export class JsonStateStore {
  constructor(path) { this.path = path; }
  async load(companyId) {
    try {
      const state = JSON.parse(await readFile(this.path, "utf8"));
      if (state.companyId && companyId && state.companyId !== companyId) throw new Error(`State company mismatch: expected ${companyId}, found ${state.companyId}`);
      return state;
    }
    catch (error) { if (error.code === "ENOENT") return emptyRuntimeState(companyId); throw error; }
  }
  async save(state, expectedVersion) {
    const current = await this.load(state.companyId);
    if (current.version !== expectedVersion) throw new Error(`State conflict: expected version ${expectedVersion}, found ${current.version}`);
    const next = { ...state, version: expectedVersion + 1 };
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    await rename(temporary, this.path);
    return next;
  }
}

export class MemoryStateStore {
  constructor(state) { this.state = state ?? emptyRuntimeState(); }
  async load(companyId) { return this.state.companyId ? structuredClone(this.state) : { ...structuredClone(this.state), companyId }; }
  async save(state, expectedVersion) {
    if (this.state.version !== expectedVersion) throw new Error("State conflict");
    this.state = { ...structuredClone(state), version: expectedVersion + 1 };
    return structuredClone(this.state);
  }
}

/** Durable state boundary for stateless runtimes. Git remains desired-state authority. */
export class HttpStateStore {
  constructor({ endpoint, token, fetchImpl = fetch }) {
    if (!endpoint || !token) throw new Error("A durable state endpoint and server-side token are required.");
    this.endpoint = endpoint.replace(/\/$/, "");
    this.token = token;
    this.fetch = fetchImpl;
  }
  async load(companyId) {
    const response = await this.fetch(`${this.endpoint}/companies/${encodeURIComponent(companyId)}/state`, { headers: this.#headers() });
    if (response.status === 404) return emptyRuntimeState(companyId);
    if (!response.ok) throw new Error(`Durable state load failed (${response.status}).`);
    const state = await response.json();
    if (state.companyId !== companyId) throw new Error("Durable state crossed a company boundary.");
    return state;
  }
  async save(state, expectedVersion) {
    const response = await this.fetch(`${this.endpoint}/companies/${encodeURIComponent(state.companyId)}/state`, {
      method: "PUT",
      headers: { ...this.#headers(), "content-type": "application/json", "if-match": String(expectedVersion) },
      body: JSON.stringify(state)
    });
    if (response.status === 409 || response.status === 412) throw new Error("State conflict");
    if (!response.ok) throw new Error(`Durable state save failed (${response.status}).`);
    const saved = await response.json();
    if (saved.companyId !== state.companyId || saved.version !== expectedVersion + 1) throw new Error("Durable state service returned an invalid version or company.");
    return saved;
  }
  #headers() { return { authorization: `Bearer ${this.token}`, accept: "application/json" }; }
}
