## Purpose

Defines how the repository's publishable npm tarballs are packaged as a hermetic nix flake output so downstream repositories can consume them as a flake input instead of building the workspace themselves.

## ADDED Requirements

### Requirement: npm-artifacts flake output

The flake SHALL expose a `packages.<system>.npm-artifacts` output (and alias it as `packages.<system>.default`) on every system the flake enumerates. The output SHALL be a directory containing, for each publishable (non-private) package in the pnpm workspace, the tarball that package's `prepack`-driven `pnpm pack` produces. Private workspaces SHALL NOT be packed. Package discovery SHALL happen at nix evaluation time from the workspace manifests, so a newly added publishable package is included without further flake edits.

#### Scenario: Downstream consumption

- **WHEN** a downstream repository adds this flake as an input and builds `npm-artifacts`
- **THEN** the output directory contains one `.tgz` per publishable workspace package, named per npm's packing convention

#### Scenario: New publishable package included automatically

- **WHEN** a new non-private package is added under `packages/`
- **THEN** the next evaluation of the `npm-artifacts` output includes its tarball without changes to the flake

### Requirement: Hermetic tarball build

The tarball derivation SHALL build in a sandboxed environment with no network access during the build phase. All npm dependencies SHALL resolve from a lockfile-pinned offline store fetched as a fixed-output derivation. The compact compiler SHALL come from the flake's pinned compact toolchain, and circuit parameters SHALL be seeded from the flake's circuit-parameter package rather than fetched from the network. The derivation SHALL run the packages' real build pipeline (including `prepack`) so the tarball reflects the same artifact `pnpm pack` produces in CI. The node and pnpm versions used SHALL match the repository's declared engine pins.

#### Scenario: Offline build

- **WHEN** the tarball derivation is built in the nix sandbox
- **THEN** the build completes with no network access, resolving all dependencies from the offline store and all circuit parameters from the flake input

#### Scenario: Tarball equals the smoke artifact

- **WHEN** the flake-built tarball is compared against the tarball the smoke lane packs from the same sources
- **THEN** both are produced by the same `prepack` build pipeline and contain the same file set

### Requirement: Tarball content check

The flake SHALL expose a check that builds the tarballs and verifies the distribution invariants: each tarball contains the compiled distribution output, contains no secret material, and its filename version matches the version declared in the corresponding package manifest. For packages whose `src/` tree contains `.compact` contract sources (detected at evaluation time), the check SHALL additionally require the managed contract index, the compact contract sources, and the declared helper scripts in the tarball, and that no managed-code source maps ship. Compact-specific invariants SHALL NOT be applied to packages without `.compact` sources, so newly added non-Compact publishable packages satisfy the check without flake edits.

#### Scenario: Complete tarball passes

- **WHEN** the check runs against the `npm-artifacts` output
- **THEN** it passes, confirming dist output, compact sources, and scripts are present and no managed source maps ship

#### Scenario: Incomplete tarball fails

- **WHEN** a packed tarball is missing the compiled distribution output or contains a managed-code source map
- **THEN** the check fails with an error naming the offending tarball and violation

#### Scenario: Non-Compact publishable package

- **WHEN** a newly added publishable package under `packages/` has no `.compact` sources
- **THEN** the check applies only the universal invariants (dist output, version consistency, no secret material), and the package is packed and audited without flake edits
