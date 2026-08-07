# ADR 0003: Runtime transport is a replaceable capability boundary

- Status: Accepted

## Context

Local, hosted, customer-hosted, embedded, agent, and machine clients need the same operations without importing core internals.

## Decision

Expose stable domain operations through an in-process runtime and a replaceable HTTP adapter. Clients depend on the operation contract, not implementation modules.

## Consequences

Fixture and live transports can be exchanged. Authorization remains inside runtime mutation operations.
