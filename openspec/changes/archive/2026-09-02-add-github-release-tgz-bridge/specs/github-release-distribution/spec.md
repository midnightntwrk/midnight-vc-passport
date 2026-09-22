## Purpose

Defines the temporary GitHub-Release distribution bridge for the digital-passport package: how gated release tarballs are attached to GitHub Releases behind operator-created tags, verified after upload, and consumed by URL — while npmjs-registry publication is suspended pending an npm automation token that is currently outside the repository's control.

## ADDED Requirements

### Requirement: Bridge window suspends npmjs publication

While the bridge is active, the publication workflow SHALL distribute releases as GitHub Releases instead of publishing to the npmjs registry (the registry-facing `npm-publication` requirements are scoped accordingly for the duration of the window): the registry-publication, dist-tag snapshot/verification, propagation-wait, and registry-mode consumer-test steps SHALL be suspended, and the suspension SHALL be recoverable — the suspended steps SHALL remain present (commented) with restore instructions, and the workflow SHALL keep its registry configuration locked to the public npmjs registry (the dependency source during install). The bridge SHALL NOT introduce any second package registry target. The base versioning, pre-publication gate, packing, contract check, tarball consumer test, and SBOM generation behavior SHALL be unchanged by the bridge.

#### Scenario: Bridge run performs no registry publication

- **WHEN** a publication is dispatched during the bridge window
- **THEN** the run publishes nothing to the npmjs registry and performs no dist-tag or propagation operations

#### Scenario: Suspended steps are restorable

- **WHEN** the bridge ends and the npmjs path is restored
- **THEN** the suspended registry steps are re-enabled from their commented, instruction-marked form without redesign

#### Scenario: Registry lock survives the bridge

- **WHEN** the bridged workflow's registry configuration is inspected
- **THEN** it still points only at the public npmjs registry

### Requirement: Operator-owned release tags

During the bridge, a publication SHALL require a release tag created manually by the operator before dispatch and supplied as a workflow input. The workflow SHALL fail before any build step unless the tag exists in the repository, points at the commit the dispatch was made from, and carries (with a leading `v` stripped) exactly the version resolved from the channel inputs. The workflow itself SHALL NOT create, move, or delete any commit, tag, or branch; release tags are operator-owned inputs, and source manifests SHALL retain the base version after publication.

#### Scenario: Missing or mismatched tag fails closed

- **WHEN** the workflow is dispatched with a tag that does not exist, does not point at the dispatched commit, or whose version differs from the resolved channel version
- **THEN** the workflow fails before any build, pack, or upload step runs

#### Scenario: Workflow stays stateless

- **WHEN** a bridged publication completes
- **THEN** the workflow has created no ref in the repository and the manifests still carry the base version

### Requirement: Bridge channel semantics

During the bridge, an `rc` publication SHALL create a GitHub prerelease that is never marked latest, and a `release` publication SHALL create a GitHub release marked latest. A `snapshot` publication SHALL fail closed before any build step with a message naming the bridge restriction, because run-number-stamped snapshot versions cannot be known before the operator creates the tag. The branch gating of channels SHALL be unchanged.

#### Scenario: rc creates a non-latest prerelease

- **WHEN** an `rc` publication completes during the bridge
- **THEN** the GitHub release for that version is a prerelease and is not marked latest

#### Scenario: release channel marks latest

- **WHEN** a `release` publication completes during the bridge
- **THEN** the GitHub release for that version is marked latest

#### Scenario: Snapshot rejected during the bridge

- **WHEN** the workflow is dispatched with channel `snapshot` during the bridge
- **THEN** it fails before any build step with a bridge-specific message

### Requirement: Release assets and integrity evidence

Each bridged release SHALL attach the tested tarball under its standard packed filename, a SHA256SUMS file covering every attached artifact, the SPDX SBOM, and the release package-contract report. The release body SHALL be generated — stating the channel, version, the versioned install URL, the artifact checksums, and the attestation/checksum verification commands — and SHALL link the changelog. After upload, the workflow SHALL verify that each uploaded artifact's digest equals the digest of the locally packed artifact and fail closed on any mismatch. Artifact attestations SHALL be generated for the uploaded release assets, and the release-evidence workflow artifact (retained at least 90 days) SHALL continue to be produced.

#### Scenario: Release carries the full asset set

- **WHEN** a bridged publication completes
- **THEN** the GitHub release carries the tarball, the SHA256SUMS file, the SPDX SBOM, the contract report, and a generated body containing the install URL and verification commands

#### Scenario: Corrupted upload fails the run

- **WHEN** an uploaded release asset's digest differs from the packed artifact's digest
- **THEN** the workflow fails after upload and reports the mismatch

#### Scenario: Assets carry attestations

- **WHEN** the release assets are published
- **THEN** each carries an artifact attestation verifiable with the repository's standard verification command

### Requirement: Release-URL consumer verification

After uploading the release assets, the workflow SHALL run a clean-consumer installation test that installs the package from the actual release-download URL of the just-published release — resolving its dependencies from the public npmjs registry — and exercises the consumer round-trip. A failed round-trip SHALL fail the run, and the publication runbook SHALL direct the operator to delete the failed release or re-dispatch a corrected publication, so that no release whose URL-installed package failed the round-trip remains published.

#### Scenario: Clean consumer installs from the release URL

- **WHEN** the release-URL consumer test runs
- **THEN** a fresh project installs the package from the release download URL and the round-trip passes

#### Scenario: Failed round-trip fails the run

- **WHEN** the URL-mode consumer test fails
- **THEN** the workflow fails and the failure is visible in the run

### Requirement: Consumer URL-install guidance

The repository SHALL document, for any downstream repository, how to consume the bridged package: pin the versioned release-download URL directly in the consumer's manifest dependencies, rely on the lockfile to freeze it, and upgrade by editing the URL to a newer release. The documentation SHALL state that a direct URL dependency requires no exotic-subdependency exemption and is not subject to registry release-age floors, and SHALL include — without mandating — the checksum and attestation verification commands for consumers that want them. The documentation SHALL be generic and SHALL NOT name specific consumer repositories.

#### Scenario: A generic consumer can self-serve

- **WHEN** an arbitrary downstream repository follows the documented bridge install procedure
- **THEN** it installs the package by versioned release URL with dependencies resolved from the npmjs registry

#### Scenario: Verification is offered, not enforced

- **WHEN** the bridge documentation is inspected
- **THEN** it provides checksum and attestation verification commands while leaving their enforcement to each consumer

### Requirement: Security self-check bridge contract

The CI-enforced workflow self-check SHALL assert the bridged publication workflow's exact permission grant — `contents: write`, `id-token: write`, `attestations: write` — and SHALL continue to assert manual dispatch only, the channel/branch gate before any build step, the registry lock, absence of template interpolation inside run scripts, full-SHA action pinning, and checkout credential hygiene. The self-check SHALL fail on a mutated workflow that widens these permissions or weakens any preserved property. The `repository-toolchain` self-check clause over the publication workflow is scoped for the bridge window accordingly (see the `repository-toolchain` delta), so both capabilities pin the same bridge shape.

#### Scenario: Widened permissions fail the self-check

- **WHEN** the publication workflow grants any permission outside the bridge shape
- **THEN** the security-workflow self-check fails

#### Scenario: Preserved properties still enforced

- **WHEN** the bridged workflow gains a push trigger, loses its channel gate, or interpolates template expressions inside a run script
- **THEN** the security-workflow self-check fails

### Requirement: Bridge exit condition

The publication runbook SHALL record the bridge's exit condition and procedure: once the npm automation token is available and the first `release`-channel npmjs publication succeeds, a single follow-up change SHALL restore the commented npmjs steps, restore the scoped `npm-publication` and `repository-toolchain` requirements to their unconditional form, remove the bridge steps and their capability requirements, and update the consumer documentation — returning npmjs to the sole distribution channel. Until that exit, the bridge SHALL remain the documented publication path; it SHALL NOT silently persist as a second channel.

#### Scenario: Runbook names the exit

- **WHEN** an operator reads the publication runbook
- **THEN** it states the exit condition (first successful `release`-channel npmjs publication) and the single-change restore procedure

#### Scenario: No silent second channel

- **WHEN** the npmjs path is restored per the exit procedure
- **THEN** no GitHub-Release publication path or capability requirement remains active alongside it
