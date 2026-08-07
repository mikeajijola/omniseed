# Run the local runtime

With Node.js 20+, run `npm install`, `npm test`, then `npm run omniseed -- plan examples/minimal --json`. The example initially reports Customer Research as realised and Customer Support as missing.

Run `npm run dev` (or `npm run runtime`) to expose the durable local reference runtime at `http://localhost:8787`. OmniSeed OS can then use its live transport and mock founding designer. Definitions, versioned portable state, plans, events, evidence, founding sessions, and schedules use separate tables in `.omniseed/omniseed.db`. Generate a plan by submitting `examples/minimal/company-with-support.json`, then apply explicit approved change IDs with authorization. Restarting the process reloads the same state. No external service is used.
