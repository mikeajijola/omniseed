# Working on OmniSeed

When you work on OmniSeed, protect the line between saying and doing.

Read these rules before you learn the code.

## What must stay true

- Omniform says what the company wants.
- OmniSeed works out how to make it real.
- Never pretend a Provider exists.
- Never pretend work succeeded.
- Make a plan before changing the outside world.
- An approval only applies to the exact plan and actions the person reviewed.
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

## How the code protects this

- Requested, installed, configured, connected, healthy, deployed, and observed are different facts.
- The same company description and state must produce the same plan.
- Save the exact plan that a person will review.
- Reject an old plan when the company description or state has changed.
- Record observations and evidence after Provider work.
- Check who is asking and what they are allowed to do before an operation runs.
- Keep Company Search scoped to one company. Keep the source attached to each result.
- Do not put UI rendering, Lily wording, HTTP routes, or Omniform schema ownership here.
- Keep vendor code behind a replaceable Provider boundary.
- Keep in-process and protocol Providers behind the same normalized handle. Engine lifecycle code must not branch on implementation language or transport.

[Omniform](https://github.com/mikeajijola/omniform) owns the company file. [OmniSeed OS](https://github.com/mikeajijola/omniseedos) owns the per-company experience. Never import OS code into the engine.

Run `npm test` for every change. Test honest failure as well as success. Include missing Providers, bad permissions, old plans, partial approvals, company boundaries, and missing handlers.

The exact file roles, plan fields, approval checks, state model, and package rules live in [`docs/architecture.md`](docs/architecture.md).
