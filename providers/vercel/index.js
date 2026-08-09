import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { ReferenceProvider } from "../../src/provider.js";

const execFileAsync = promisify(execFile);

export class VercelProvider extends ReferenceProvider {
  constructor({ projectName, productionUrl, sourcePath, scope, runner = vercelCliRunner } = {}) {
    if (!projectName) throw new Error("VercelProvider requires projectName");
    const project = { family: "systems", id: `${projectName}_project`, name: `${projectName} Vercel Project`, offers: ["web_application_hosting"], spec: { kind: "vercel_project", providerOperation: "adopt_web_project", projectName } };
    const deployment = { family: "systems", id: `${projectName}_production`, name: `${projectName} Production Deployment`, offers: ["production_deployment"], spec: { kind: "vercel_deployment", providerOperation: "adopt_web_deployment", projectName, productionUrl } };
    const endpoint = { family: "systems", id: `${projectName}_endpoint`, name: `${projectName} Public Endpoint`, offers: ["public_endpoint"], spec: { kind: "vercel_endpoint", providerOperation: "adopt_public_endpoint", projectName, productionUrl } };
    const observation = { family: "observations", id: `${projectName}_deployment_observation`, name: `${projectName} Deployment Observation`, offers: ["deployment_observation"], spec: { kind: "vercel_observation", providerOperation: "adopt_deployment_observation", projectName, productionUrl } };
    super({ id: "vercel", families: ["systems", "schedules", "observations"], offerings: [
      { family: "systems", id: "web_application_hosting", resource: project },
      { family: "systems", id: "production_deployment", resource: deployment },
      { family: "systems", id: "public_endpoint", resource: endpoint },
      { family: "observations", id: "deployment_observation", resource: observation },
      ...["discover_web_project", "import_web_project", "create_web_project", "deploy_web_application", "inspect_web_project", "attach_domain"].map(id => ({ family: "systems", id })),
      { family: "observations", id: "observe_web_deployment" },
      { family: "schedules", id: "schedule_http_operation" }
    ] });
    this.projectName = projectName;
    this.productionUrl = productionUrl;
    this.sourcePath = sourcePath ? resolve(sourcePath) : null;
    this.scope = scope;
    this.runner = runner;
  }

  async discover() {
    try {
      const output = await this.runner(["project", "inspect", this.projectName, "--yes", "--no-color", ...scopeArgs(this.scope)]);
      const projectId = output.match(/^ID\s+([^\s]+)$/m)?.[1];
      const name = output.match(/^Name\s+([^\s]+)$/m)?.[1] ?? this.projectName;
      if (!projectId) return [];
      return [{ type: "unmanaged_external_resource", family: "systems", provider: "vercel", providerResourceId: projectId, name, projectName: name }];
    } catch (error) {
      if (/not found|could not find/i.test(error.message)) return [];
      throw error;
    }
  }

  async inspectDeployment(url = this.productionUrl) {
    if (!url) throw new Error("Vercel deployment URL is required for observation");
    return JSON.parse(await this.runner(["inspect", url, "--json", "--no-color", ...scopeArgs(this.scope)]));
  }

  async plan(action) {
    if (action.desired.spec?.providerOperation === "adopt_web_project") {
      const [project] = await this.discover();
      if (!project) throw new Error(`Existing Vercel project not found: ${this.projectName}`);
      return { actionPatch: { providerOperation: "adopt_web_project", expectedExternalResult: { projectId: project.providerResourceId, projectName: project.name }, risk: "low", reversible: false, approvalRequirement: "required" } };
    }
    if (action.desired.spec?.providerOperation?.startsWith("adopt_")) {
      const deployment = await this.inspectDeployment();
      return { actionPatch: { providerOperation: action.desired.spec.providerOperation, expectedExternalResult: safeDeployment(deployment), risk: "low", reversible: false, approvalRequirement: "required" } };
    }
    return { actionPatch: { providerOperation: action.desired.spec?.providerOperation ?? "deploy_web_application", expectedExternalResult: { projectName: this.projectName, target: "preview" }, risk: "medium", reversible: true, approvalRequirement: "required" } };
  }

  async apply(action) {
    if (action.providerOperation === "adopt_web_project") {
      const [project] = await this.discover();
      if (!project) throw new Error(`Existing Vercel project not found: ${this.projectName}`);
      return { providerResourceId: project.providerResourceId, status: "adopted", attributes: { projectName: project.name } };
    }
    if (action.providerOperation?.startsWith("adopt_")) {
      const deployment = await this.inspectDeployment();
      const safe = safeDeployment(deployment);
      return { providerResourceId: resourceExternalId(action.desired.spec.kind, safe), status: "adopted", attributes: safe };
    }
    if (action.providerOperation === "deploy_web_application") {
      if (!this.sourcePath) throw new Error("Vercel preview deployment requires sourcePath");
      const output = await this.runner(["deploy", this.sourcePath, "--project", this.projectName, "--yes", "--json", "--no-color", ...scopeArgs(this.scope)]);
      const created = JSON.parse(output), createdUrl = created.url ?? created.deployment?.url;
      if (!createdUrl) throw new Error("Vercel deployment response did not contain a URL");
      const deployment = await this.inspectDeployment(createdUrl.startsWith("http") ? createdUrl : `https://${createdUrl}`);
      return { providerResourceId: deployment.id, status: deployment.readyState?.toLowerCase() ?? "created", attributes: safeDeployment(deployment) };
    }
    throw new Error(`Unsupported Vercel operation: ${action.providerOperation}`);
  }

  async observe(resource) {
    const url = resource.attributes?.url ? `https://${resource.attributes.url.replace(/^https?:\/\//, "")}` : this.productionUrl;
    const deployment = await this.inspectDeployment(url);
    const safe = safeDeployment(deployment), healthy = safe.readyState === "READY";
    return { status: healthy ? "healthy" : "unhealthy", checkedAt: new Date().toISOString(), providerResourceId: resource.providerResourceId, attributes: safe, evidence: [{ type: "provider_status", source: "vercel", value: safe.readyState, externalId: safe.deploymentId, url: safe.url }] };
  }

  createPreviewDeploymentResource() {
    return { family: "systems", id: `${this.projectName}_generation_1_preview`, name: `${this.projectName} Generation 1 Preview`, offers: [], risk: "medium", spec: { kind: "vercel_deployment", providerOperation: "deploy_web_application", projectName: this.projectName, target: "preview" } };
  }
}

export async function vercelCliRunner(args) {
  const { stdout, stderr } = await execFileAsync("vercel", args, { maxBuffer: 10 * 1024 * 1024, env: process.env });
  return (stdout.trim() || sanitize(stderr));
}

function scopeArgs(scope) { return scope ? ["--scope", scope] : []; }
function sanitize(value) { return String(value).replace(/(--token\s+)\S+/gi, "$1[REDACTED]").trim(); }
function safeDeployment(value) {
  return { deploymentId: value.id, projectName: value.name, url: value.url, target: value.target ?? null, readyState: value.readyState, createdAt: value.createdAt, aliases: value.aliases ?? [] };
}
function resourceExternalId(kind, deployment) {
  if (kind === "vercel_endpoint") return deployment.aliases[0] ?? deployment.url;
  if (kind === "vercel_observation") return `observation:${deployment.deploymentId}`;
  return deployment.deploymentId;
}
