import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";

export function emptyCompanyWorkState(companyId = null) { return { version: 0, companyId, runs: [] }; }

export class JsonCompanyWorkStore {
  constructor(path) { this.path = path; }
  async load(companyId) {
    try {
      const state = JSON.parse(await readFile(this.path, "utf8"));
      if (state.companyId && companyId && state.companyId !== companyId) throw new Error(`Company work mismatch: expected ${companyId}, found ${state.companyId}`);
      return state;
    } catch (error) {
      if (error.code === "ENOENT") return emptyCompanyWorkState(companyId);
      throw error;
    }
  }
  async save(state, expectedVersion) {
    const current = await this.load(state.companyId);
    if (current.version !== expectedVersion) throw new Error(`Company work conflict: expected version ${expectedVersion}, found ${current.version}`);
    const next = { ...state, version: expectedVersion + 1 };
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    await rename(temporary, this.path);
    return next;
  }
}

export class MemoryCompanyWorkStore {
  constructor(state) { this.state = state ?? emptyCompanyWorkState(); }
  async load(companyId) { return this.state.companyId ? structuredClone(this.state) : { ...structuredClone(this.state), companyId }; }
  async save(state, expectedVersion) {
    if (this.state.version !== expectedVersion) throw new Error("Company work conflict");
    this.state = { ...structuredClone(state), version: expectedVersion + 1 };
    return structuredClone(this.state);
  }
}

// Separate CAS prevents timeline writes from invalidating reviewed plans.
export class HttpCompanyWorkStore {
  constructor({ endpoint, token, fetchImpl = fetch }) {
    if (!endpoint || !token) throw new Error("A durable company-work endpoint and server-side token are required.");
    this.endpoint = endpoint.replace(/\/$/, "");
    this.token = token;
    this.fetch = fetchImpl;
  }
  async load(companyId) {
    const response = await this.fetch(`${this.endpoint}/companies/${encodeURIComponent(companyId)}/work`, { headers: this.#headers() });
    if (response.status === 404) return emptyCompanyWorkState(companyId);
    if (!response.ok) throw new Error(`Durable company work load failed (${response.status}).`);
    const state = await response.json();
    if (state.companyId !== companyId) throw new Error("Durable company work crossed a company boundary.");
    return state;
  }
  async save(state, expectedVersion) {
    const response = await this.fetch(`${this.endpoint}/companies/${encodeURIComponent(state.companyId)}/work`, {
      method: "PUT",
      headers: { ...this.#headers(), "content-type": "application/json", "if-match": String(expectedVersion) },
      body: JSON.stringify(state),
    });
    if (response.status === 409 || response.status === 412) throw new Error("Company work conflict");
    if (!response.ok) throw new Error(`Durable company work save failed (${response.status}).`);
    const saved = await response.json();
    if (saved.companyId !== state.companyId || saved.version !== expectedVersion + 1) throw new Error("Durable company work service returned an invalid version or company.");
    return saved;
  }
  #headers() { return { authorization: `Bearer ${this.token}`, accept: "application/json" }; }
}
