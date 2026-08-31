# Company snapshot consumer contract

Engine is authoritative for both deployed/current resources and their observations. A UI, OmniSeed OS, Lily, indexer, or cache obtains a snapshot with `getCompanySnapshot(declaration, authorization, currentSnapshot)`, or through a declared `get_company_snapshot` operation with `{ current }`; it must not construct current state from Omniform, Provider responses, or search results.

The caller needs `company.read`. The result has one of four deterministic outcomes:

- `create`: the consumer supplied no snapshot.
- `update`: the consumer supplied an older Engine snapshot.
- `no-op`: the supplied revision is exactly the current revision.
- `stale`: the supplied identity is invalid, belongs to another company, conflicts at the same state version, or claims a later state version. The returned Engine snapshot remains authoritative; `stale` never accepts the consumer's values.

Every result includes the complete authoritative `snapshot`. Its `revision` is a `sha256:` identity over the canonical redacted projection, including the definition hash, runtime state version, desired and observed revisions, capability states, resources, deployments, and observations. Consumers should retain the whole snapshot unchanged and send it back on their next read. They must not recalculate or rewrite the revision.

Sensitive keys such as passwords, secrets, credentials, private keys, authorization values, and tokens are recursively replaced with `[REDACTED]` before hashing and returning the snapshot. This means the revision identifies exactly the safe consumer projection and does not leak or depend on the secret value.

An unobserved resource is represented explicitly:

```json
{
  "state": "missing",
  "status": null,
  "checkedAt": null,
  "evidence": []
}
```

Missing is not healthy, deployed, or an inferred Provider result. Once Engine has a real observation, `state` is `observed` and the Provider observation fields accompany it.

## Consumer example

```js
let cached = null;
const result = await engine.getCompanySnapshot(company, reader, cached);

if (result.outcome !== "no-op") cached = result.snapshot;
```

The deterministic fixture in `test/fixtures/company-snapshots.json` documents create, update, no-op, stale, missing-observation, and redaction expectations in executable form.
