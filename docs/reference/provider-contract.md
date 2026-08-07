# Provider contract

Providers implement `validate`, `plan`, `apply`, and `observe`; they may implement `discover`, `import`, `destroy`, and `health`. Core owns portable plans and state. Providers own vendor translation and return opaque identifiers/evidence without secrets. The local and mock providers make the complete lifecycle deterministic offline.
