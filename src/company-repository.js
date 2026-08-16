import { EngineError } from "./operations.js";
import { parseOmniform, serializeCanonical } from "@omniseed/omniform";
import { isSeq, parseDocument, stringify } from "yaml";

/** A replaceable boundary for proposing desired-state changes to canonical Git. */
export class CompanyRepository {
  async inspect() { throw new EngineError("company_repository_unimplemented", "Company repository inspection is not implemented"); }
  async submit() { throw new EngineError("company_repository_unimplemented", "Company repository submission is not implemented"); }
  async inspectSubmission() { throw new EngineError("company_repository_unimplemented", "Company repository submission inspection is not implemented"); }
  async mergeSubmission() { throw new EngineError("company_repository_unimplemented", "Company repository merge is not implemented"); }
}

/** Production boundary that drives a governed Git change through a workflows Provider handle. */
export class ProviderGitCompanyRepository extends CompanyRepository {
  constructor({ provider, actor = { actorId: "omniseed_engine", actorType: "software" } } = {}) {
    super();
    if (!provider?.metadata) throw new EngineError("company_repository_invalid", "A normalized Provider handle is required");
    if (!provider.metadata.families?.includes("workflows")) throw new EngineError("company_repository_invalid", "Company repository Provider must implement the workflows primitive family");
    if (!provider.metadata.operations?.includes("company.repository.inspect")) throw new EngineError("company_repository_invalid", "Company repository Provider must advertise company.repository.inspect");
    this.provider = provider;
    this.actor = actor;
  }

  async inspect({ authority }) {
    validateAuthority(authority);
    return this.provider.invoke("company.repository.inspect", repositoryInput(authority), this.actor);
  }

  async submit({ authority, candidate, proposal }) {
    validateAuthority(authority);
    const repository = repositoryName(authority.repository);
    const repositoryState = await this.inspect({ authority });
    const branch = `omniseed/${proposal.id}`;
    const action = {
      id: `company_change_${proposal.id}`,
      type: "create",
      family: "workflows",
      resourceId: "github_company_change",
      providerId: this.provider.metadata.id,
      desired: { family: "workflows", id: "github_company_change", spec: {
        repository,
        baseBranch: authority.branch,
        expectedBaseSha: repositoryState.baseSha,
        branch,
        path: authority.path,
        content: formatCandidateDocument(repositoryState.document, proposal.patch, candidate, authority.path),
        commitMessage: `company: apply ${proposal.id}`,
        pullRequestTitle: `Company Change: ${proposal.reason}`,
        pullRequestBody: companyChangeBody(proposal)
      } }
    };
    const validation = await this.provider.validate(action);
    if (!validation.valid) throw new EngineError("company_repository_invalid", "Company repository Provider rejected the exact approved candidate", { issues: validation.issues });
    await this.provider.plan(action);
    const resource = await this.provider.apply(action);
    const observation = await this.provider.observe(resource);
    const attributes = resource.attributes ?? {};
    return {
      repository: authority.repository,
      baseBranch: authority.branch,
      baseRevision: attributes.baseSha,
      path: authority.path,
      branch,
      commit: attributes.commitSha,
      pullRequest: attributes.pullRequestUrl,
      pullRequestNumber: attributes.pullRequestNumber,
      status: submissionStatus(observation),
      providerResourceId: resource.providerResourceId,
      evidence: (observation.evidence ?? []).map((item, index) => ({ id: `git_${proposal.id}_${index + 1}`, ...item, proposalId: proposal.id, provider: this.provider.metadata.id }))
    };
  }

  async inspectSubmission({ submission }) {
    if (!submission?.providerResourceId) throw new EngineError("company_repository_invalid", "Submission requires providerResourceId");
    const observation = await this.provider.observe({
      providerResourceId: submission.providerResourceId,
      attributes: {
        repository: repositoryName(submission.repository),
        baseBranch: submission.baseBranch,
        expectedBaseSha: submission.baseRevision,
        branch: submission.branch,
        commitSha: submission.commit,
        pullRequestNumber: submission.pullRequestNumber,
        pullRequestUrl: submission.pullRequest
      }
    });
    const pullRequest = observation.snapshot?.pullRequest;
    return {
      status: pullRequest?.merged ? "merged" : pullRequest?.state ?? "unknown",
      merged: Boolean(pullRequest?.merged),
      mergeRevision: pullRequest?.mergeCommitSha ?? null,
      currentDesiredRevision: observation.snapshot?.baseSha ?? null,
      checks: observation.snapshot?.checks ?? null,
      observation
    };
  }

  async mergeSubmission({ submission, authorization }) {
    if (!this.provider.metadata.operations?.includes("company.change.merge")) throw new EngineError("company_repository_merge_unavailable", "Company repository Provider does not advertise governed merge");
    if (!(authorization?.permissions ?? []).includes("company_change.merge")) throw new EngineError("authorization_denied", "Missing permissions: company_change.merge", { missing: ["company_change.merge"] });
    const result = await this.provider.invoke("company.change.merge", { pullRequestNumber: submission.pullRequestNumber, expectedHeadSha: submission.commit }, authorization);
    return { ...result, evidence: [{ id: `git_merge_${submission.pullRequestNumber}_${result.mergeCommitSha}`, type: "company_change_merged", source: this.provider.metadata.id, pullRequest: submission.pullRequest, pullRequestNumber: submission.pullRequestNumber, mergeCommitSha: result.mergeCommitSha, mergedAt: result.mergedAt, approvedBy: result.approvedBy ?? [], checks: result.checks ?? null }] };
  }
}

function validateAuthority(authority) {
  if (authority?.changeMode !== "pull_request") throw new EngineError("company_repository_invalid", "Canonical company changes must use pull requests");
  repositoryName(authority?.repository);
  if (!authority?.branch || !authority?.path) throw new EngineError("company_repository_invalid", "Canonical Git authority requires branch and path");
}
function repositoryInput(authority) { return { repository: repositoryName(authority.repository), baseBranch: authority.branch, path: authority.path }; }
function repositoryName(value) {
  if (typeof value !== "string") throw new EngineError("company_repository_invalid", "Canonical repository must be a GitHub HTTPS reference");
  const match = value.match(/^https:\/\/github\.com\/([^/\s]+\/[^/\s]+?)(?:\.git)?$/);
  if (!match) throw new EngineError("company_repository_invalid", "Canonical repository must be a GitHub HTTPS reference");
  return match[1];
}
function companyChangeBody(proposal) { return [`OmniSeed governed Company Change \`${proposal.id}\`.`, "", `Proposal hash: \`${proposal.hash}\``, `Proposed by: \`${proposal.proposedBy.actorId}\``, "", proposal.reason].join("\n"); }
function submissionStatus(observation) { return observation?.snapshot?.pullRequest?.merged ? "merged" : observation?.snapshot?.pullRequest?.state ?? "open"; }

function formatCandidateDocument(document, patch, candidate, expectedPath) {
  if (document?.path !== expectedPath || typeof document?.content !== "string") throw new EngineError("company_repository_serialization_invalid", "Canonical repository inspection did not return the governed company document");
  if (/^\s*[\[{]/.test(document.content)) return `${serializeCanonical(candidate)}\n`;
  let yaml;
  try {
    yaml = parseDocument(document.content, { keepSourceTokens: true, strict: true });
    if (yaml.errors.length) throw yaml.errors[0];
    const formatted = patch.every(change => change.op === "replace")
      ? replaceDocumentRanges(document.content, yaml, patch)
      : applyAndStringifyDocument(yaml, patch);
    const reparsed = parseOmniform(formatted);
    if (serializeCanonical(reparsed) !== serializeCanonical(candidate)) throw new Error("formatted document differs from approved candidate");
    return formatted;
  } catch (error) {
    throw new EngineError("company_repository_serialization_invalid", `Approved company change cannot be represented safely in the canonical document: ${error.message}`);
  }
}

function replaceDocumentRanges(source, document, patch) {
  const replacements = patch.map(change => {
    const path = change.path.split("/").slice(1).map(segment => segment.replace(/~1/g, "/").replace(/~0/g, "~"));
    const node = document.getIn(path, true);
    if (!node?.range) throw new Error(`replace path does not exist in canonical document: ${change.path}`);
    const column = node.range[0] - (source.lastIndexOf("\n", node.range[0] - 1) + 1);
    const trailingWhitespace = source.slice(node.range[0], node.range[1]).match(/\s*$/)?.[0] ?? "";
    const value = stringify(change.value).trimEnd().replaceAll("\n", `\n${" ".repeat(column)}`) + trailingWhitespace;
    return { start: node.range[0], end: node.range[1], value };
  }).sort((left, right) => right.start - left.start);
  return replacements.reduce((result, replacement) => `${result.slice(0, replacement.start)}${replacement.value}${result.slice(replacement.end)}`, source);
}

function applyAndStringifyDocument(document, patch) {
  for (const change of patch) applyDocumentOperation(document, change);
  return document.toString({ lineWidth: 0 });
}

function applyDocumentOperation(document, change) {
  const path = change.path.split("/").slice(1).map(segment => segment.replace(/~1/g, "/").replace(/~0/g, "~"));
  const parentPath = path.slice(0, -1), key = path.at(-1), parent = document.getIn(parentPath, true);
  if (isSeq(parent)) {
    if (change.op === "add") {
      const index = key === "-" ? parent.items.length : Number(key);
      parent.items.splice(index, 0, document.createNode(change.value));
    } else if (change.op === "remove") parent.items.splice(Number(key), 1);
    else document.setIn([...parentPath, Number(key)], change.value);
  } else if (change.op === "remove") document.deleteIn(path);
  else document.setIn(path, change.value);
}

/** Deterministic test/reference adapter. It records a PR-shaped submission and never merges it. */
export class InMemoryGitCompanyRepository extends CompanyRepository {
  constructor() { super(); this.submissions = []; }
  async submit({ authority, proposal }) {
    if (authority.changeMode !== "pull_request") throw new EngineError("company_repository_invalid", "Canonical company changes must use pull requests");
    const branch = `omniseed/${proposal.id}`;
    const submission = {
      repository: authority.repository, baseBranch: authority.branch, path: authority.path, branch,
      pullRequest: `pr://${proposal.id}`, status: "open",
      evidence: [{ id: `git_${proposal.id}`, type: "company_change_pull_request", source: authority.repository, proposalId: proposal.id, branch, pullRequest: `pr://${proposal.id}` }]
    };
    this.submissions.push(structuredClone(submission));
    return submission;
  }
}
