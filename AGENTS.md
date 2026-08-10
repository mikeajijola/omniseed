# Working on OmniSeed

When you work on OmniSeed, protect the line between saying and doing.

Read these rules before you learn the code.

## What must stay true

- Omniform says what the company wants.
- OmniSeed works out how to make it real.
- Never pretend a Provider exists.
- Never pretend work succeeded.
- Make a plan before changing the outside world.
- Approval must apply to the exact plan that was reviewed.
- After doing work, check what really happened.
- Keep evidence of what happened.
- Lily, the UI, and other actors must go through OmniSeed.
- They must not secretly call Providers behind OmniSeed's back.
- Search helps find knowledge. Search is not company truth.
- Providers must remain replaceable.

Be honest about gaps. “Missing,” “not connected,” and “failed” are useful answers. A made-up success is dangerous.

## A simple example

Omniform may say:

> This company needs a public website.

OmniSeed must not report a working website until a Provider has done the work and OmniSeed has checked the result.

The same rule applies to email, workflows, agents, search, and every other part of a company.

## Running ourselves in the open

OmniSeed should use Company as Code for its own project.

When Provider choices are otherwise good enough, prefer tools that contributors can inspect and understand. This helps us test our own ideas and invite useful work from others.

This is a preference for running the OmniSeed project. Never turn it into a restriction on other companies. The core product stays Provider-neutral.

## For maintainers

- `compiler.js` turns Omniform plus saved state into the current company view.
- `resolver.js` finds possible ways to cover missing needs.
- `provider.js` owns Provider registration, status, and shared adapter rules.
- `planner.js` owns stable company and plan hashes and creates actions.
- `operations.js` owns handlers, permissions, approvals, dependencies, and authorization.
- `store.js` keeps deployed items, observations, evidence, history, and plans separate.
- `engine.js` joins these parts. Provider side effects must enter through its approved paths.

Keep these technical rules:

- Requested, installed, configured, connected, healthy, deployed, and observed are different facts.
- The same company description and state must produce the same plan.
- Save the exact plan and its content hash.
- Bind approval to the actor, permissions, plan ID, plan hash, and chosen action IDs.
- Reject a plan when the company description or state changed after review.
- Record observations and evidence after Provider work.
- Check actor identity and every required permission before an operation runs.
- Keep Company Search scoped to one company. Keep the source attached to each result.
- Do not put UI rendering, Lily wording, HTTP routes, or Omniform schema ownership here.
- Put vendor SDK code behind a Provider adapter. Do not make it core engine policy.

The dependency direction is:

```text
omniform → omniseed → omniseedos
```

[Omniform](https://github.com/mikeajijola/omniform) owns the company file. [OmniSeed OS](https://github.com/mikeajijola/omniseedos) owns the per-company experience. Never import OS code into the engine.

Use public, versioned package exports between projects. Do not commit `file:../...` production dependencies.

Run `npm test` for every change. Test honest failure as well as success. Include missing Providers, bad permissions, old plans, partial approvals, company boundaries, and missing handlers.

Update [`docs/architecture.md`](docs/architecture.md) when a deep technical rule changes.
