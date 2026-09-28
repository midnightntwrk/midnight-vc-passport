# Spec Delta

## Purpose

Defines the temporary GitHub-Release distribution window for the digital-passport package: how gated release tarballs are attached to GitHub Releases behind operator-created tags, verified after upload, and consumed by URL — coexisting with a best-effort npmjs publication attempt while the npmjs Trusted Publisher mapping is not configured.

## ADDED Requirements

### Requirement: Window-scoped GitHub-Release distribution

While the GitHub-Release distribution window is active, an `rc` or `release` publication SHALL attach the tested tarballs to a GitHub Release, created and digest-verified before any npmjs publication is attempted. The npmjs publication SHALL then be attempted best-effort (see the `npm-publication` capability): a failed attempt SHALL NOT fail the run, SHALL NOT affect the already-created GitHub Release, and SHALL be recorded in the run summary. The GitHub Release is the interim distribution channel; the GitHub-Release window SHALL NOT introduce a second package registry target, and the npmjs registry SHALL remain the only registry.

#### Scenario: Release is produced before the npm attempt

- **WHEN** a publication is dispatched during the window
- **THEN** the tested tarballs are attached to a GitHub Release before the npmjs publication is attempted

#### Scenario: npm failure leaves the Release published

- **WHEN** the best-effort npmjs publication fails during the window
- **THEN** the run completes, the GitHub Release and its assets remain downloadable, and the failure is recorded in the run summary

#### Scenario: No second registry target

- **WHEN** the window workflow's registry and dependency configuration is inspected
- **THEN** it points only at the public npmjs registry, and the GitHub Release is the only added distribution channel

### Requirement: Operator-owned release tags

During the window, a publication SHALL require a release tag created manually by the operator before dispatch and supplied as a workflow input. The workflow SHALL fail before any build step unless the tag exists in the repository, points at the commit the dispatch was made from, and carries (with a leading `v` stripped) exactly the version resolved from the channel inputs. The workflow itself SHALL NOT create, move, or delete any commit, tag, or branch; release tags are operator-owned inputs, and source manifests SHALL retain the base version after publication.

#### Scenario: Missing or mismatched tag fails closed

- **WHEN** the workflow is dispatched with a tag that does not exist, does not point at the dispatched commit, or whose version differs from the resolved channel version
- **THEN** the workflow fails before any build, pack, or upload step runs

#### Scenario: Workflow stays stateless

- **WHEN** a window publication completes
- **THEN** the workflow has created no ref in the repository and the manifests still carry the base version

### Requirement: Window channel semantics

During the window, an `rc` publication SHALL create a GitHub prerelease that is never marked latest, and a `release` publication SHALL create a GitHub release marked latest. A `snapshot` publication SHALL fail closed before any build step with a message naming the window restriction, because run-number-stamped snapshot versions cannot be known before the operator creates the tag. The branch gating of channels SHALL be unchanged.

#### Scenario: rc creates a non-latest prerelease

- **WHEN** an `rc` publication completes during the window
- **THEN** the GitHub release for that version is a prerelease and is not marked latest

#### Scenario: release channel marks latest

- **WHEN** a `release` publication completes during the window
- **THEN** the GitHub release for that version is marked latest

#### Scenario: Snapshot rejected during the window

- **WHEN** the workflow is dispatched with channel `snapshot` during the window
- **THEN** it fails before any build step with a window-specific message

### Requirement: Release assets and integrity evidence

Each window release SHALL attach the tested tarball under its standard packed filename, a SHA256SUMS file covering every attached artifact, the SPDX SBOM, and the release package-contract report. The release body SHALL be generated — stating the channel, version, the versioned install URL, the artifact checksums, and the attestation/checksum verification commands — and SHALL link the changelog. After upload, the workflow SHALL verify that each uploaded artifact's digest equals the digest of the locally packed artifact and fail closed on any mismatch. Build-provenance attestations SHALL be generated for the uploaded release assets, and the release-evidence workflow artifact (retained at least 90 days) SHALL continue to be produced. Re-dispatching an already-created release whose assets match SHALL succeed as an idempotent no-op rather than re-uploading or overwriting assets.

#### Scenario: Release carries the full asset set

- **WHEN** a window publication completes
- **THEN** the GitHub release carries the tarball, the SHA256SUMS file, the SPDX SBOM, the contract report, and a generated body containing the install URL and verification commands

#### Scenario: Corrupted upload fails the run

- **WHEN** an uploaded release asset's digest differs from the packed artifact's digest
- **THEN** the workflow fails after upload and reports the mismatch

#### Scenario: Assets carry attestations

- **WHEN** the release assets are published
- **THEN** each carries a build-provenance attestation verifiable with the repository's standard verification command

#### Scenario: Rerun is an idempotent no-op

- **WHEN** the workflow is re-dispatched for a release whose assets already exist and match the locally packed artifacts
- **THEN** the run succeeds without re-uploading or overwriting any asset

### Requirement: Release-URL consumer verification

After uploading the release assets, the workflow SHALL run a clean-consumer installation test that installs the package from the actual release-download URL of the just-published release — resolving its dependencies from the public npmjs registry — and exercises the consumer round-trip. A failed round-trip SHALL fail the run, and the publication runbook SHALL direct the operator to delete the failed release or re-dispatch a corrected publication, so that no release whose URL-installed package failed the round-trip remains published.

#### Scenario: Clean consumer installs from the release URL

- **WHEN** the release-URL consumer test runs
- **THEN** a fresh project installs the package from the release download URL and the round-trip passes

#### Scenario: Failed round-trip fails the run

- **WHEN** the URL-mode consumer test fails
- **THEN** the workflow fails and the failure is visible in the run

### Requirement: Consumer URL-install guidance

The repository SHALL document, for any downstream repository, how to consume the window package: pin the versioned release-download URL directly in the consumer's manifest dependencies, rely on the lockfile to freeze it, and upgrade by editing the URL to a newer release. The documentation SHALL state that a direct URL dependency requires no exotic-subdependency exemption and is not subject to registry release-age floors, and SHALL include — without mandating — the checksum and attestation verification commands for consumers that want them. The documentation SHALL be generic and SHALL NOT name specific consumer repositories.

#### Scenario: A generic consumer can self-serve

- **WHEN** an arbitrary downstream repository follows the documented window install procedure
- **THEN** it installs the package by versioned release URL with dependencies resolved from the npmjs registry

#### Scenario: Verification is offered, not enforced

- **WHEN** the window documentation is inspected
- **THEN** it provides checksum and attestation verification commands while leaving their enforcement to each consumer

### Requirement: Security self-check window contract

The CI-enforced workflow self-check SHALL assert the window publication workflow's exact permission grant — `contents: write`, `id-token: write`, `attestations: write` — the presence of the operator `tag` input, and the presence of the GitHub-Release steps, and SHALL continue to assert manual dispatch only, the channel/branch gate before any build step, the registry lock, absence of template interpolation inside run scripts, full-SHA action pinning, and checkout credential hygiene. The self-check SHALL fail on a mutated workflow that widens these permissions beyond the window shape or weakens any preserved property. The `repository-toolchain` self-check clause over the publication workflow is scoped for the window accordingly (see the `repository-toolchain` delta), so both capabilities pin the same window shape. The follow-up removal change SHALL restore the self-check to the registry-only shape.

#### Scenario: Widened permissions fail the self-check

- **WHEN** the publication workflow grants any permission outside the window shape
- **THEN** the security-workflow self-check fails

#### Scenario: Preserved properties still enforced

- **WHEN** the window workflow gains a push trigger, loses its channel gate, or interpolates template expressions inside a run script
- **THEN** the security-workflow self-check fails

### Requirement: Window exit condition

The publication runbook SHALL record the window's exit condition and procedure: once the npmjs Trusted Publisher mapping is configured and the npmjs publication path is confirmed working, a single follow-up change SHALL remove the GitHub-Release steps and their capability requirements, restore the scoped `npm-publication` and `repository-toolchain` requirements to their unconditional form, and update the consumer documentation — returning npmjs to the sole distribution channel. That follow-up removal is outside the scope of this change, but until it is made the window SHALL remain the documented interim publication path; it SHALL NOT silently persist as a second channel.

#### Scenario: Runbook names the exit

- **WHEN** an operator reads the publication runbook
- **THEN** it states the exit condition and the single-change removal procedure

#### Scenario: No silent second channel

- **WHEN** the follow-up removal procedure is completed
- **THEN** no GitHub-Release publication path or capability requirement remains active alongside the npmjs registry path
