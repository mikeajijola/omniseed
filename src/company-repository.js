import { EngineError } from "./operations.js";

/** A replaceable boundary for proposing desired-state changes to canonical Git. */
export class CompanyRepository {
  async submit() { throw new EngineError("company_repository_unimplemented", "Company repository submission is not implemented"); }
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
