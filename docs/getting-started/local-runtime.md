# Run the local runtime

With Node.js 20+, run `npm test`, then `npm run omniseed -- plan examples/minimal --json`. The example initially reports Customer Research as realised and Customer Support as missing. `npm run omniseed -- apply examples/minimal --approve-all --json` demonstrates explicit approval and returns portable state without writing it. No external service is used.
