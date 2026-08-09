# Vercel provider

The Vercel provider is a deterministic adapter for the `systems`, `schedules`, and `observations` primitive families. Generation 1 implements only the vertical slice required to discover/adopt an existing web project, inspect/adopt its production deployment and endpoint, deploy a preview artifact, and independently observe deployment readiness.

Supported offerings include `discover_web_project`, `import_web_project`, `create_web_project`, `deploy_web_application`, `inspect_web_project`, `attach_domain`, `observe_web_deployment`, and `schedule_http_operation`. An advertised offering is not necessarily exercised by the dogfood declaration.

Authentication comes from the Vercel CLI/runtime environment. Tokens are never accepted in declarations or copied into plans, state, evidence, logs, or browser data. Preview deployment is the default; production promotion is deliberately outside this milestone.
