# Persistent company instances

The default local runtime uses replaceable `FileDefinitionStore`, `FileStateStore`, and `FileRuntimeMetadataStore` implementations. Tests and embedded callers may use the corresponding memory stores.

```text
.omniseed/companies/<company-id>/
├── company.json
├── state/
│   ├── current.json
│   └── history/<version>.json
└── runtime/
    ├── applies/
    └── founding/
```

Definition, portable state, evidence, and operational metadata remain separate. Writes are atomic. Every successful apply saves a numbered state snapshot; runtime metadata records which plan, actor, and approved changes produced it. Portable-state validation rejects secret-like fields.
