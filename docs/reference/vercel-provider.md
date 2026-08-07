# Vercel provider

The initial Vercel provider supports `vercel_project`, `vercel_deployment`, and `vercel_domain` resources behind the provider SDK's `validate`, `plan`, `apply`, and `observe` lifecycle. These are implementation resources that realise capabilities; they are not Omniform primitives.

Credentials are runtime secrets supplied to `createVercelProvider`. Tokens and team identifiers must never enter portable definitions, state, Lily context, browser code, evidence, or logs. Apply remains subject to the same plan authorization used by every provider.

The provider currently covers creation and point observation. Update, removal, richer deployment readiness, domain configuration diagnostics, and production credential smoke tests remain future work.
