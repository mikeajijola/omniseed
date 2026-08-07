# ADR 0007: SQLite-first company in a box

## Status

Accepted.

## Context

OmniSeed needs durable definitions, state history, plans, events, observations, evidence, founding sessions, schedules, realisation attempts, and learning. These records have relational boundaries and currently fit one runtime process.

## Decision

Use one SQLite database as the canonical local persistence implementation. Use the same relational schema through a SQLite-compatible remote adapter on ephemeral hosts. Keep store contracts replaceable and retain memory, file, and legacy key-value adapters for tests and migration.

Run local schedules through the runtime. Store validated learning relationally before considering vector infrastructure.

## Consequences

Local development requires only Node and `npm install`. A company can be backed up and inspected as a definition plus one database file. Hosting and database vendors remain replaceable. Semantic boundaries remain separate inside one physical database.

New infrastructure requires a documented requirement that the runtime and SQLite cannot satisfy reliably.
