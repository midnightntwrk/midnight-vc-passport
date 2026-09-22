## MODIFIED Requirements

### Requirement: Pinned Compact toolchain

The Compact compiler version SHALL be pinned identically for CI and for the nix development shell. The CI lane SHALL install the compiler through the organization's setup-compact action pinned by commit SHA. The nix flake SHALL provide the compact toolchain and circuit parameters required for offline compilation, both sourced from the `MediaNoxLabs/flake-collection` flake input: the toolchain as `compact-toolchain` and the circuit parameters as `midnight-circuit-params`. The flake SHALL NOT depend on the `midnight-did` repository for any build input, and circuit parameters SHALL NOT be vendored as a derivation in this repository. A build-time check SHALL fail if the provided toolchain version ever drifts from the pin.

#### Scenario: Compiler versions agree

- **WHEN** the CI workflow environment and the flake-provided toolchain are compared
- **THEN** both provide the same pinned Compact compiler version

#### Scenario: Toolchain is upstream-independent

- **WHEN** the nix flake inputs are inspected
- **THEN** the compact toolchain and the circuit parameters both resolve through `MediaNoxLabs/flake-collection`, with no `midnight-did` input and no locally vendored circuit-parameter derivation

#### Scenario: Offline contract compilation

- **WHEN** the compact contract is compiled inside the nix development shell
- **THEN** compilation succeeds without network access beyond the flake inputs

#### Scenario: Toolchain drift fails loudly

- **WHEN** the flake-provided compact toolchain version differs from the pinned compiler version
- **THEN** the build-time version check fails with an actionable error
