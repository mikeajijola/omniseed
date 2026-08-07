# Hosted runtime

The hosted runtime exposes the same `/operations/{operation}` boundary as local OmniSeed. Vercel Functions are a replaceable host; they are not the state store or the source of company truth.

`HostedDefinitionStore`, `HostedStateStore`, and `HostedRuntimeMetadataStore` use a small key-value client contract. The initial adapter targets the Redis-compatible REST variables supplied by a Vercel Marketplace store. Definitions, current portable state, version history, events, plans, apply metadata, and founding-session snapshots use separate keys.

Anonymous requests receive `read_company` authority only. Mutations—including plan generation, apply, accepted-gap decisions, and founding—require an owner credential held server-side or in an HTTP-only session cookie. Provider credentials never enter portable state or browser responses.

The hosted seed labels `local` and `mock-google` resources as simulated. A real Google Workspace connection must use a real provider identity and observed connection evidence.

Schedules remain Omniform intent. A future scheduler adapter may use Vercel Cron or another provider, but schedule execution is not coupled to the host.
