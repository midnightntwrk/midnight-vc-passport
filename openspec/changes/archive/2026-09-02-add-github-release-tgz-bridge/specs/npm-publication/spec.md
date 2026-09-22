## Purpose

Scopes the registry-facing requirements of the npmjs release train to the period when the npmjs-registry publication path is active: during the temporary GitHub-Release bridge window (see the `github-release-distribution` capability) those requirements are suspended, and they are restored to unconditional form by the bridge-exit change. The remaining `npm-publication` requirements — publication channels and branch gating, stateless release versioning, the pre-publication gate, and the publication runbook — remain in force unchanged during the bridge; the release-evidence requirement is scoped with the registry-facing set because its npm dist-tag state snapshot is produced by the suspended dist-tag snapshot step and cannot exist during the bridge window.

## MODIFIED Requirements

### Requirement: Registry publication with provenance

When the npmjs-registry publication path is active, the workflow SHALL publish the tested tarballs to `https://registry.npmjs.org/` only, with public access, the channel's npm dist-tag, and npm provenance enabled, authenticated with the organization's npm automation token available to the workflow as a secret. The workflow SHALL NOT place the token in workflow inputs, command arguments, repository files, or logs. The workflow SHALL verify before use that the available npm CLI supports trusted publishing, so the authentication path can later move to npm OIDC without workflow changes. The path is inactive during the GitHub-Release bridge window (see the `github-release-distribution` capability): no publish step runs, and this requirement is suspended until the bridge-exit change restores it.

#### Scenario: Publication is public with provenance

- **WHEN** the publish step completes
- **THEN** the package version is public on npmjs, carries the requested dist-tag, and has provenance attestation

#### Scenario: Registry is locked

- **WHEN** the publish step is configured with any registry other than the public npmjs registry
- **THEN** the workflow fails before publishing

#### Scenario: Suspended during the bridge window

- **WHEN** the GitHub-Release bridge is active and a publication is dispatched
- **THEN** no publish step runs and nothing is published to the npmjs registry

### Requirement: Dist-tag safety and idempotency

When the npmjs-registry publication path is active, the workflow SHALL, before publishing, snapshot the relevant npm dist-tags and, after publishing, verify them and fail closed on unexpected drift, in particular protecting an existing `latest` tag during `snapshot` and `rc` publications. On the very first publication of a package — when no `latest` exists to protect — the workflow SHALL tolerate the registry setting `latest` to the just-published version (unavoidable npmjs behavior) and fail only if `latest` resolves to any other version. Re-running the workflow for an already-published version and dist-tag SHALL be a no-op that succeeds without republishing. During the GitHub-Release bridge window (see the `github-release-distribution` capability) no npmjs publication occurs and this requirement is suspended until the bridge exits.

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

When the npmjs-registry publication path is active, the workflow SHALL, after publishing, wait for the version to propagate on the public registry, verify the expected dist-tags, and run a clean-consumer installation test that resolves the published version — and its transitive dependencies — from the public registry. During the GitHub-Release bridge window (see the `github-release-distribution` capability) these steps are suspended together with publication itself; the bridge's release-URL consumer verification applies instead.

#### Scenario: Propagation wait and tag verification

- **WHEN** the publish step completes
- **THEN** the workflow polls the registry until the version is visible, then verifies the dist-tags match the release intent

#### Scenario: Clean consumer installs the published version

- **WHEN** the registry-mode consumer test runs
- **THEN** a fresh project installs the published version from npmjs and the consumer round-trip passes

### Requirement: Release evidence

When the npmjs-registry publication path is active, the publication workflow SHALL generate an SPDX SBOM for each packed tarball and upload a release-evidence artifact containing the tested tarballs, the dist-tag state snapshot, and the SBOMs, retained for at least 90 days. During the GitHub-Release bridge window (see the `github-release-distribution` capability) no npm dist-tag state exists — the dist-tag snapshot step is suspended together with publication itself — so the evidence artifact SHALL instead contain the tested tarballs and their SPDX SBOMs, retained for at least 90 days; the bridge's additional integrity evidence (SHA256SUMS, contract report, artifact attestations) is carried by the GitHub release assets.

#### Scenario: Evidence artifact per publication

- **WHEN** a publication run completes with the npmjs-registry path active
- **THEN** the run's artifact contains the published tarballs, their SPDX SBOMs, and the recorded npm release state

#### Scenario: Evidence continues during the bridge

- **WHEN** a bridged publication run completes
- **THEN** the run's evidence artifact contains the tested tarballs and their SPDX SBOMs, retained for at least 90 days
