# OmniSeed

An OmniSeed instance is a particular company definition, its desired state, governed history, realisations, Provider bindings, and observed state being managed and reconciled by OmniSeed. The company is the durable identity; the engine process, endpoint, deployment, and interfaces are replaceable.

OmniSeed makes a company described in Omniform real.

## The idea

Writing down a company is not enough.

Something has to make it real.

A written company should be able to become a working company.

OmniSeed reads the company's Omniform. It works out:

- what the company needs
- what already exists
- what is missing
- which Providers can help
- what should happen next

Then OmniSeed makes a plan.

Important changes can require approval. The approval is tied to the exact plan that a person reviewed.

After approval, OmniSeed asks the chosen Providers to do the work. Then it checks the real world to see whether the work actually succeeded.

It never treats “we asked for it” as “it exists.”

Over time, more of this work can happen automatically when the company has given permission. People, software, AI agents, services, and machines can all help do the work.

## How it fits

Company as Code means a company can be described, created, checked, and changed through code.

```text
Company as Code
      ↓
Omniform describes the company
      ↓
OmniSeed makes the company real
      ↓
OmniSeed OS is where the company is seen and operated
```

[Omniform](https://github.com/mikeajijola/omniform) says what the company should be able to do.

OmniSeed plans, asks Providers to do work, and checks the result.

[OmniSeed OS](https://github.com/mikeajijola/omniseedos) shows that real company state. Lily is the company's steward inside OmniSeed OS.

## A small example

Omniform says:

> We need a public website.

OmniSeed checks and says:

> We do not have one.

A Provider says:

> Vercel can host one.

Vercel is only one possible realisation. Another Provider could satisfy the same need.

OmniSeed makes a plan:

> Create or adopt the project and deploy the site.

A person can review and approve that plan. OmniSeed then asks Vercel to do the work.

After deployment, OmniSeed checks Vercel. Only then can the website Capability become realised.

## What this project owns

OmniSeed owns the safe path from a company description to real work.

It owns:

- reading a valid Omniform company
- comparing what was asked for with what exists
- finding honest gaps
- choosing from available Provider options
- making and saving an exact plan
- checking approval for that exact plan
- asking Providers to do approved work
- checking and recording what happened
- giving Lily, the UI, and other actors one safe way to use company operations

OmniSeed does not own the Omniform language. It does not own the browser experience or Lily's conversation design.

OmniSeed also governs changes to the company definition itself. A **Realisation Plan** changes reality to match the current definition. A **Company Change Proposal** proposes changing that definition. Semantic systems such as Lily may create a proposal and explain its evidence, but they cannot directly edit canonical Omniform or bypass separate approval and apply authority. See [`docs/company-change.md`](docs/company-change.md).

Providers must stay replaceable. Company Search is one part of a company. The company can choose which Search Provider supplies it. Search helps find knowledge, but it is not the source of truth about the company.

## OmniSeed tries to run itself in the open

If OmniSeed says a company can be code, people should be able to open our repositories and see how OmniSeed itself runs.

OmniSeed itself is a Company-as-Code company. Its own Omniform should be public. Its workflows should be visible where practical. Its plans, docs, issues, code, and company structure should be understandable by contributors.

When there is a reasonable choice, the OmniSeed company should prefer an option that is visible, understandable, easy to inspect, and easy to contribute to.

For example, the OmniSeed company may choose GitHub as its Provider for a Workflow primitive and use GitHub Actions as the product implementing that responsibility. Actions is not a separate Provider.

This is one example of a dogfood choice for the OmniSeed company's own implementation. It is not part of the universal model or a rule for other companies.

Omniform and OmniSeed must remain Provider-neutral.

## Try it

You need Node.js 22 or newer. With `omniform` beside this folder:

```sh
npm install --no-save ../omniform
npm test
npx omniseed validate ../omniform/examples/company.omniform.yaml
npx omniseed inspect ../omniform/examples/company.omniform.yaml
npx omniseed plan ../omniform/examples/company.omniform.yaml
```

## For developers

Read [`docs/architecture.md`](docs/architecture.md) for saved state, the full plan and approval rules, Provider states, operation checks, Company Search, and package details.

See [`examples/customer-support.mjs`](examples/customer-support.mjs) for a working example.

Providers may run inside Node.js or in a separate process through the language-neutral Provider Protocol. The Python reference Provider proves that the engine lifecycle does not depend on Provider implementation language. See [`docs/provider-protocol-v1.md`](docs/provider-protocol-v1.md).

## Project status

OmniSeed is in Generation 1 and early development.

OmniSeed is licensed under the Apache License 2.0. See [LICENSE](LICENSE).
