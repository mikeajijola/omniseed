# OmniSeed

OmniSeed makes a company described in Omniform real.

## The idea

Writing down a company is not enough.

Something has to make it real.

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

Providers must stay replaceable. Search is one Provider type. It helps find knowledge, but it is not the source of truth about the company.

## OmniSeed tries to run itself in the open

OmniSeed itself is a Company-as-Code company.

Its own Omniform should be public. Its workflows should be visible where practical. Its plans, docs, issues, code, and company structure should be understandable by contributors.

When several Providers are good enough, the OmniSeed project should prefer one that makes its work easier to inspect, understand, and contribute to.

For example, GitHub Actions may be a good Workflow Provider for OmniSeed because contributors can see the workflow beside the code.

This is a dogfood preference for the OmniSeed project. It is not a rule for companies that use OmniSeed.

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

State is stored in `.omniseed/state.json` by default.

The command line does not offer a quick apply command. Applying work needs the saved plan, its exact approval, and the right permissions. Use the software library or a trusted service for that flow.

## For developers

Read [`docs/architecture.md`](docs/architecture.md) for the full control loop, Provider states, plan hashes, approval checks, stored state, operation availability, and Company Search rules.

See [`examples/customer-support.mjs`](examples/customer-support.mjs) for a working example.

OmniSeed consumes the versioned `@omniseed/omniform` package. OmniSeed OS consumes the versioned `@omniseed/engine` package. Sibling folders are useful during development, but production does not depend on that folder layout.

## Project status

OmniSeed is in Generation 1 and early development.

Licensing has not been decided. The package does not declare a license yet.
