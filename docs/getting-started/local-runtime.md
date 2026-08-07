# Run the local runtime

With Node.js 20+, run `npm install`, `npm test`, then `npm run omniseed -- plan examples/minimal --json`. The example initially reports Customer Research as realised and Customer Support as missing.

Run `npm run runtime` to expose the in-memory reference runtime at `http://localhost:8787`. OmniSeed OS can then use its live transport. Generate a plan by submitting `examples/minimal/company-with-support.json` to `generatePlan`, and apply explicit approved change IDs with an authorization object. The local provider creates `support_agent`; state and activity remain in memory for this development session. No external service is used.
