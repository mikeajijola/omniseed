# Vercel provider

The initial Vercel provider supports `vercel_project`, `vercel_deployment`, and `vercel_domain` resources behind the provider SDK lifecycle. These are implementation resources that realise capabilities; they are not new Omniform primitives.

It advertises the primitive implementations `system`, `connector`, and `observation`, plus the capability offerings `create_web_project`, `deploy_web_application`, `observe_web_deployment`, `attach_domain`, `inspect_project`, `inspect_deployment`, and `inspect_domain`. Unsupported primitives are intentionally absent. Scheduling remains outside this minimum until a clean Vercel Cron reconciliation contract is implemented.

Credentials are runtime secrets supplied to `createVercelProvider`. Portable and runtime state retain only a connection reference, external IDs, and non-sensitive metadata. Tokens and team identifiers never enter portable definitions, state, Lily context, browser code, evidence, or logs. Apply remains subject to the same plan authorization used by every provider.

## Adopt an existing project

`discover({name})` lists matching unmanaged Vercel projects without changing either system. `import(resource, discovered)` reads the project again, checks that its declared and external names match, and returns a sanitized deployed-state record with `adopted: true`. It never calls project creation. OmniSeed can then attach that deployed resource to a capability realisation and observe it independently.

The dogfood declaration in `examples/dogfood-vercel` models the existing `omniseed-os` project as the realisation of `company_operating_environment`. Its checked-in state contains example opaque IDs only; live IDs enter canonical runtime state through import.

Creation and point observation use Vercel's documented REST project, deployment, and project-domain endpoints. Update, removal, deployment polling/backoff, endpoint HTTP probing, domain configuration diagnostics, and production credential smoke tests remain future work.
