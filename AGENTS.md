# Generation 1 invariants

- Omniform serialization is format-neutral; YAML and JSON normalize before runtime use.
- JSON Schema remains the structural authority.
- Company Search is a first-class, replaceable provider family and not canonical truth.
- Lily and every other actor invoke Company Search through executable OmniSeed operations, never vendor APIs.
- Desired search providers are never fabricated or silently replaced.
- Every indexing, retrieval and search request carries company isolation.
