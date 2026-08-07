# Provider contract

Providers implement `validate`, `plan`, `apply`, and `observe`; they may implement `discover`, `import`, `destroy`, and `health`. Core owns portable plans, authorization, state, drift, findings, and proposed responses. Providers own vendor translation and return opaque identifiers and evidence without secrets. The local and mock providers make the complete lifecycle deterministic offline.

## GitHub provider

The first external provider supports `github_repository` resources. Vendor configuration is implementation data on a resource, not an Omniform primitive:

```json
{
  "id": "company_repository",
  "type": "github_repository",
  "realises": ["source_control"],
  "provider": {
    "github": {
      "owner": "acme",
      "name": "company",
      "description": "Canonical company source",
      "private": true,
      "defaultBranch": "main"
    }
  }
}
```

`createGitHubProvider` accepts a token at runtime and never returns it in plans, state, observations, or evidence. Its HTTP boundary is injectable so tests use a deterministic fake GitHub API and perform no network mutation.

The initial external lifecycle validates and plans repository creation, requires shared `apply_plan` authorization, creates and observes the repository, converts the response into sanitized evidence, calculates drift, and produces structured findings and proposed responses. A response is not automatically executed.

Only repository creation is currently applied. Update, removal, webhook ingestion, retry policy, rate-limit handling, and production credential resolution remain future provider work.
