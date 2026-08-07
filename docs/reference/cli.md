# CLI contract

Commands are `init`, `validate`, `plan`, `apply`, `state`, `inspect`, and `drift`. `--json` emits a single JSON document on stdout. Apply requires explicit approval (`--approve-all` is development shorthand). Consumers should use JSON and structured events, not parse human output.
