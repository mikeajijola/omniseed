# Hosting independence

OmniSeed Core has no Vercel dependency. Runtime operations can be exposed in-process, over HTTP, or through future adapters. StateStore implementations must match the durability guarantees of their host: local files are suitable for the local runtime, but an ephemeral serverless filesystem is not production state.

Vercel may later be an external provider behind the existing provider contract. Provider-specific resources such as `vercel_project`, `vercel_deployment`, or `vercel_domain` belong in provider configuration, not Omniform core. Potential provider capabilities include web hosting, preview environments, production deployment, and domain management.
