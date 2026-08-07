# ADR 0004: Vercel is replaceable deployment and provider infrastructure

- Status: Accepted

## Context

OmniSeed OS needs public web hosting. Vercel can host the OS and may later be managed as an external provider, but neither role changes Company-as-Code meaning.

## Decision

Omniform and OmniSeed Core remain platform-neutral. OmniSeed OS may be hosted on Vercel through its replaceable transport boundary. Ephemeral serverless filesystems are not a durable `StateStore`. A future Vercel provider belongs behind the provider SDK and may implement provider-specific resources such as projects, deployments, and domains.

## Consequences

Vercel is not the source of organisational truth. The same OS can run on Azure, AWS, customer-controlled or local infrastructure. Hosting the OS does not constitute implementing a Vercel provider.
