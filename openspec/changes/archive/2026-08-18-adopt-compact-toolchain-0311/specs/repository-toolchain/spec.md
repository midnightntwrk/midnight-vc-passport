## MODIFIED Requirements

### Requirement: Pinned Compact toolchain

The Compact compiler version SHALL be pinned identically for CI and for the nix development shell. The CI lane SHALL install the compiler through the organization's setup-compact action pinned by commit SHA. The nix flake SHALL provide the compact toolchain and circuit parameters required for offline compilation: the toolchain sourced from the `MediaNoxLabs/flake-collection` flake input, and the circuit parameters vendored as a self-contained derivation in this repository. The flake SHALL NOT depend on the `midnight-did` repository for any build input. A build-time check SHALL fail if the provided toolchain version ever drifts from the pin.

#### Scenario: Compiler versions agree

- **WHEN** the CI workflow environment and the flake-provided toolchain are compared
- **THEN** both provide the same pinned Compact compiler version

#### Scenario: Toolchain is upstream-independent

- **WHEN** the nix flake inputs are inspected
- **THEN** the compact toolchain resolves through `MediaNoxLabs/flake-collection` and the circuit parameters resolve from a derivation vendored in this repository, with no `midnight-did` input

#### Scenario: Offline contract compilation

- **WHEN** the compact contract is compiled inside the nix development shell
- **THEN** compilation succeeds without network access beyond the flake inputs

#### Scenario: Toolchain drift fails loudly

- **WHEN** the flake-provided compact toolchain version differs from the pinned compiler version
- **THEN** the build-time version check fails with an actionable error

## ADDED Requirements

### Requirement: Native runtime-version guard

The compact compiler SHALL be pinned to a version whose emitted `checkRuntimeVersion` guard matches the runtime version this repository depends on (`@midnight-ntwrk/compact-runtime@0.16.0`). The build SHALL NOT rewrite the compiler-emitted guard in generated managed code: the guard present in the built artifacts SHALL be the one the compiler emitted natively.

#### Scenario: Guard matches the installed runtime

- **WHEN** the generated managed contract module is loaded with this package's pinned compact-runtime
- **THEN** the compiler-emitted version guard passes without any post-build modification of the generated code

#### Scenario: No align-version workaround in the build

- **WHEN** the package's compact build script is inspected
- **THEN** it performs no runtime-version rewriting step and ships no such helper script
