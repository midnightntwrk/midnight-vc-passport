## Purpose

Defines the repository's reproducible development and continuous-integration contract: the workspace layout, engine requirements, pinned Compact toolchain for local and CI builds, and the required CI lanes including security hygiene.

## ADDED Requirements

### Requirement: Workspace layout

The repository SHALL be a pnpm workspace with turbo task orchestration and a private root manifest. Publishable packages and private evidence workspaces SHALL live under `packages/`. The repository SHALL NOT require sibling-repository source paths, git submodules, or cross-repository workspace imports at any stage (install, build, or test).

#### Scenario: Self-contained checkout

- **WHEN** a clean checkout is installed and built
- **THEN** every step succeeds using only this repository plus registry-resolved dependencies

### Requirement: Engine requirements

The repository SHALL require Node.js >= 24 and pnpm >= 10, declared in the root manifest and enforced for package workspaces.

#### Scenario: Engines declared

- **WHEN** the root manifest is inspected
- **THEN** it declares Node >= 24 and pnpm >= 10 engine constraints

### Requirement: Pinned Compact toolchain

The Compact compiler version SHALL be pinned identically for CI and for the nix development shell. The CI lane SHALL install the compiler through the organization's setup-compact action pinned by commit SHA. The nix flake SHALL provide the compact toolchain and circuit parameters required for offline compilation, following the mechanism proven in the monorepo's nix build.

#### Scenario: Compiler versions agree

- **WHEN** the CI workflow environment and the flake-provided toolchain are compared
- **THEN** both provide the same pinned Compact compiler version

#### Scenario: Offline contract compilation

- **WHEN** the compact contract is compiled inside the nix development shell
- **THEN** compilation succeeds without network access beyond the flake inputs

### Requirement: Continuous integration lanes

The repository SHALL run, on pull requests and pushes to the integration branch, a lane that typechecks, lints, builds, and tests all workspaces. The repository SHALL additionally carry dependency-review, scorecard, and template scan lanes.

#### Scenario: PR lane exercises the full contract

- **WHEN** a pull request changes any workspace
- **THEN** CI runs typecheck, lint, build, and test and fails on any regression

#### Scenario: Security hygiene lanes present

- **WHEN** the repository workflows are inspected
- **THEN** dependency-review, scorecard, and scan workflows exist and are active

### Requirement: Build evidence for the migration

The CI build SHALL compile the compact contract from source and run the full ported test suite, providing the behavioral-equivalence evidence for the extraction.

#### Scenario: Green migration evidence

- **WHEN** CI runs on the extracted workspace
- **THEN** compact compilation, package build, and the ported test suite all succeed
