# One runtime, one database

SQLite is OmniSeed's preferred durable local store. The normal runtime writes one standard database file:

```text
.omniseed/
└── omniseed.db
```

`SQLiteDefinitionStore`, `SQLiteStateStore`, and `SQLiteRuntimeMetadataStore` share one relational repository while preserving semantic boundaries. Desired definitions, versioned portable state, observed evidence, and operational metadata occupy separate tables. Consolidating storage does not make these concepts interchangeable.

The schema contains companies, definition versions, capabilities, resources, state versions, plans and changes, applies, events, observations, findings, evidence, founding sessions, schedules, realisation attempts, and validated organisational learning. State snapshots and append-only activity answer what changed, which plan caused it, and who approved it without introducing event sourcing.

Portable-state validation rejects secret-like fields. Provider credentials remain runtime configuration and never enter definitions, state history, events, or browser responses.

Memory and file stores remain available. Import an older file-backed workspace with `npm run migrate:sqlite -- .omniseed/companies .omniseed/omniseed.db`.

The store interfaces remain replaceable. Physical consolidation is an implementation choice; semantic separation is an invariant.
