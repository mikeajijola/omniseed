import { EngineError } from "./operations.js";
import { serializeCanonical } from "@omniseed/omniform";

/** A replaceable boundary for proposing desired-state changes to canonical Git. */
export class CompanyRepository {
  async inspect() { throw new EngineError("company_repository_unimplemented", "Company repository inspection is not implemented"); }
  async submit() { throw new EngineError("company_repository_unimplemented", "Company repository submission is not implemented"); }
  async inspectSubmission() { throw new EngineError("company_repository_unimplemented", "Company repository submission inspection is not implemented"); }
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
        content: `${serializeCanonical(candidate)}\n`,
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
}

function validateAuthority(authority) {
  if (authority?.changeMode !== "pull_request") throw new EngineError("company_repository_invalid", "Canonical company changes must use pull requests");
  repositoryName(authority?.repository);
  if (!authority?.branch || !authority?.path) throw new EngineError("company_repository_invalid", "Canonical Git authority requires branch and path");
}
function repositoryInput(authority) { return { repository: repositoryName(authority.repository), baseBranch: authority.branch }; }
function repositoryName(value) {
  if (typeof value !== "string") throw new EngineError("company_repository_invalid", "Canonical repository must be a GitHub HTTPS reference");
  const match = value.match(/^https:\/\/github\.com\/([^/\s]+\/[^/\s]+?)(?:\.git)?$/);
  if (!match) throw new EngineError("company_repository_invalid", "Canonical repository must be a GitHub HTTPS reference");
  return match[1];
}
function companyChangeBody(proposal) { return [`OmniSeed governed Company Change \`${proposal.id}\`.`, "", `Proposal hash: \`${proposal.hash}\``, `Proposed by: \`${proposal.proposedBy.actorId}\``, "", proposal.reason].join("\n"); }
function submissionStatus(observation) { return observation?.snapshot?.pullRequest?.merged ? "merged" : observation?.snapshot?.pullRequest?.state ?? "open"; }

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
