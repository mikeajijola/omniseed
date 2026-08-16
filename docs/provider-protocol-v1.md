# OmniSeed Provider Protocol v1

The protocol's Provider identity denotes the supplying organisation boundary, not a product, service, framework, SDK, feature, model, or endpoint. One Provider may expose multiple primitive-family implementations through different products. Protocol conformance does not override the semantic review required by the authoritative [Provider semantics](https://github.com/mikeajijola/omniseed-ecosystem/blob/main/docs/provider-semantics.md).

Protocol identifier: `omniseed.provider.protocol/1.0`

The protocol lets OmniSeed use a Provider running outside the Node.js process. Provider implementation language is not part of the contract.

## Layers

`ProtocolProviderHandle` implements OmniSeed's normalized internal Provider boundary. It accepts any transport with `start`, `request`, and `close`. `connectStdioProvider` constructs the first transport, `StdioJsonRpcTransport`, which knows nothing about Provider semantics.

Existing JavaScript Provider objects are wrapped by `InProcessProviderHandle`. Compiler, resolver, planner, apply, observation, persistence, and reconciliation consume handles through `ProviderRegistry`; none branch on language or transport.

## Wire format

The stdio transport uses one JSON-RPC 2.0 message per line. OmniSeed writes requests to provider stdin. The Provider writes responses, and only responses, to stdout. Provider diagnostics belong on stderr.

Values must be JSON-compatible. Request IDs correlate responses. A malformed response, unknown ID, process exit, or timeout rejects the affected protocol work without changing canonical runtime state.

## Methods

- `provider.initialize`
- `provider.status`
- `provider.validate`
- `provider.plan`
- `provider.apply`
- `provider.observe`
- `provider.invoke`
- `provider.shutdown`

Initialization receives the requested protocol version, Provider configuration, and engine context. It returns:

- Provider ID, name, and implementation version;
- supported protocol version;
- primitive families;
- offerings and operations;
- supported protocol methods.

OmniSeed rejects a protocol-version or expected-Provider-ID mismatch before registration.

Status preserves four independent booleans:

- `implementation_available`
- `configured`
- `connected`
- `healthy`

Starting a process does not prove configuration, connection, or health.

## Authority boundary

The Provider receives an already-created action. It cannot approve a plan, edit its hash, persist state, or replace the selected Provider. OmniSeed verifies the stored plan and approval before calling `provider.apply`. OmniSeed then calls `provider.observe` and persists deployment, observation, and evidence through its normal store.

`provider.plan` may return Provider-specific planning information, but it cannot replace or mutate the engine plan that approval covered.

## Reference implementation

[`examples/providers/python_reference_provider.py`](../examples/providers/python_reference_provider.py) uses only the Python standard library. It exists to prove the protocol is language-independent, not to create a Python-specific engine feature.
