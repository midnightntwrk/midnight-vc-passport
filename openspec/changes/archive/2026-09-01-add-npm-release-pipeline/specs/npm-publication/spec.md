## Purpose

Defines the npmjs release train for the digital-passport package: how versions are cut, what gates a publication must pass, how the registry receives tested artifacts with provenance evidence, and how dist-tags are kept safe. Adapted from the `midnight-verifiable-credentials` publication model to this single-package repository.

## ADDED Requirements

### Requirement: Publication channels and branch gating

The repository SHALL provide a manually dispatched publication workflow accepting a `channel` input of `snapshot`, `rc`, or `release`, an optional base `version`, and an optional `rc_index`. The workflow SHALL reject a `snapshot` publication from any branch other than `develop`, an `rc` publication from any branch other than `develop` or `main`, and a `release` publication from any branch other than `main`. The `rc_index` input SHALL be rejected unless the channel is `rc`, where it SHALL be a positive integer. A supplied base version SHALL be a stable semantic version. Publication SHALL be possible only through this workflow; no automated (push-event) publication SHALL exist.

#### Scenario: Snapshot rejected outside develop

- **WHEN** the publication workflow is dispatched with channel `snapshot` from `main`
- **THEN** the workflow fails before any build, pack, or publish step runs

#### Scenario: Release rejected outside main

- **WHEN** the publication workflow is dispatched with channel `release` from `develop`
- **THEN** the workflow fails before any build, pack, or publish step runs

#### Scenario: rc index only with rc channel

- **WHEN** the workflow is dispatched with channel `snapshot` or `release` and a non-empty `rc_index`
- **THEN** the workflow fails before any build, pack, or publish step runs

#### Scenario: Manual dispatch only

- **WHEN** any branch is pushed to or a pull request is opened
- **THEN** no publication workflow run starts

### Requirement: Stateless release versioning

The base semantic version SHALL be maintained in the root and publishable package manifests, and the workflow SHALL fail if they disagree. The workflow SHALL compute the release version from the base version and channel — `snapshot` as `<base>-snapshot.<run-number>.<short-sha>` with npm tag `snapshot`, `rc` as `<base>-rc<index>` with npm tag `rc`, and `release` as the base version with npm tag `latest` — and SHALL stamp it only into its ephemeral checkout. No commit, tag, or branch SHALL be created by the publication workflow, and source manifests SHALL retain the base version after publication.

#### Scenario: Version stamped without committing

- **WHEN** a publication completes
- **THEN** the published version follows the channel scheme and the repository's manifests still carry the base version

#### Scenario: Manifest mismatch fails early

- **WHEN** the publishable package manifest version differs from the root manifest base version
- **THEN** the workflow fails before packing

#### Scenario: Private workspace never published

- **WHEN** the workflow selects the workspaces to publish
- **THEN** it enumerates them from the workspace catalog's supported entries and private workspaces (such as the smoke consumer) are excluded

### Requirement: Pre-publication gate

The publication workflow SHALL, in its own run and before any publish step: re-run the repository's full verification gate (security self-checks, lint, typecheck, build, tests, and the consumer smoke round-trip), pack the publishable workspaces into tarballs, verify the release package contract over the packed tarballs, and run clean-consumer installation tests against the packed tarballs. Only tarballs produced and verified in the same run SHALL be publishable.

#### Scenario: Gate re-run in the publication run

- **WHEN** the publication workflow runs
- **THEN** it executes the repository gate itself rather than trusting a prior CI run

#### Scenario: Untested bytes are never published

- **WHEN** any gate, pack, contract-check, or tarball consumer test step fails
- **THEN** the workflow fails and no publish step runs

### Requirement: Registry publication with provenance

The workflow SHALL publish the tested tarballs to `https://registry.npmjs.org/` only, with public access, the channel's npm dist-tag, and npm provenance enabled, authenticated with the organization's npm automation token available to the workflow as a secret. The workflow SHALL NOT place the token in workflow inputs, command arguments, repository files, or logs. The workflow SHALL verify before use that the available npm CLI supports trusted publishing, so the authentication path can later move to npm OIDC without workflow changes.

#### Scenario: Publication is public with provenance

- **WHEN** the publish step completes
- **THEN** the package version is public on npmjs, carries the requested dist-tag, and has provenance attestation

#### Scenario: Registry is locked

- **WHEN** the publish step is configured with any registry other than the public npmjs registry
- **THEN** the workflow fails before publishing

### Requirement: Dist-tag safety and idempotency

Before publishing, the workflow SHALL snapshot the relevant npm dist-tags. After publishing, it SHALL verify them and fail closed on unexpected drift, in particular protecting an existing `latest` tag during `snapshot` and `rc` publications. On the very first publication of a package — when no `latest` exists to protect — the workflow SHALL tolerate the registry setting `latest` to the just-published version (unavoidable npmjs behavior) and fail only if `latest` resolves to any other version. Re-running the workflow for an already-published version and dist-tag SHALL be a no-op that succeeds without republishing.

#### Scenario: latest protected during prerelease

- **WHEN** an `rc` or `snapshot` version is published
- **THEN** the `latest` dist-tag still resolves to its pre-publication version, else the workflow fails

#### Scenario: First publication tolerates the registry setting latest

- **WHEN** the very first version of a package is published under an `rc` or `snapshot` dist-tag
- **THEN** the workflow tolerates `latest` resolving to that just-published version (the registry sets it unconditionally on first publication), but fails if `latest` resolves to any other version

#### Scenario: Idempotent rerun

- **WHEN** the workflow is re-dispatched with the same channel, version, and index after a successful publication
- **THEN** the run succeeds as a no-op without publishing a new dist-tag state

### Requirement: Post-publication registry verification

After publishing, the workflow SHALL wait for the version to propagate on the public registry, verify the expected dist-tags, and run a clean-consumer installation test that resolves the published version — and its transitive dependencies — from the public registry.

#### Scenario: Propagation wait and tag verification

- **WHEN** the publish step completes
- **THEN** the workflow polls the registry until the version is visible, then verifies the dist-tags match the release intent

#### Scenario: Clean consumer installs the published version

- **WHEN** the registry-mode consumer test runs
- **THEN** a fresh project installs the published version from npmjs and the consumer round-trip passes

### Requirement: Release evidence

The publication workflow SHALL generate an SPDX SBOM for each packed tarball and upload a release-evidence artifact containing the tested tarballs, the dist-tag state snapshot, and the SBOMs, retained for at least 90 days.

#### Scenario: Evidence artifact per publication

- **WHEN** a publication run completes
- **THEN** the run's artifact contains the published tarballs, their SPDX SBOMs, and the recorded npm release state

### Requirement: Publication runbook

The repository SHALL carry a publication runbook document covering ownership (technical, credentials, security escalation), authentication and token policy, pre-dispatch gates, the first-release dispatch procedure, post-publication verification, retry and rollback, and incident response.

#### Scenario: Runbook covers the operator path

- **WHEN** a release operator follows the runbook
- **THEN** it names the owners, the required secret, the dispatch inputs, and the verification and rollback steps for a publication
