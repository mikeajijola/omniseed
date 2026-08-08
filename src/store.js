import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { emptyRuntimeState } from "./compiler.js";

export class JsonStateStore {
  constructor(path) { this.path = path; }
  async load(companyId) {
    try { return JSON.parse(await readFile(this.path, "utf8")); }
    catch (error) { if (error.code === "ENOENT") return emptyRuntimeState(companyId); throw error; }
  }
  async save(state, expectedVersion) {
    const current = await this.load(state.companyId);
    if (current.version !== expectedVersion) throw new Error(`State conflict: expected version ${expectedVersion}, found ${current.version}`);
    const next = { ...state, version: expectedVersion + 1 };
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${process.pid}.tmp`;
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
