# Spec Delta

## MODIFIED Requirements

### Requirement: Trusted-publisher configuration prerequisite

The publication workflow SHALL fail closed at the publish step — publishing nothing — unless npm Trusted Publishing is available to it: the npmjs Trusted Publisher mapping for `@midnight-ntwrk/midnight-vc-passport` (organization `midnightntwrk`, repository `midnight-vc-passport`, workflow filename `publish.yml`, GitHub environment `npm-release`) created by npm organization owners, and the protected `npm-release` GitHub environment configured by repository owners. No npm token secret SHALL be provisioned, referenced, or required. The publication runbook SHALL name both owner actions as prerequisites, and the repository's tooling SHALL NOT attempt registry administration (access grants or dist-tag repair) that the trusted-publishing identity cannot perform. During the GitHub-Release distribution window (see the `github-release-distribution` capability) the workflow SHALL still attempt publication under the same trusted-publishing identity, but the attempt SHALL be best-effort: an absent or mismatched mapping SHALL NOT fail the run, because the GitHub Release rather than npmjs is the interim distribution channel, and the outcome SHALL be recorded in the run summary. The fail-closed behavior of this requirement applies once the window has exited.

#### Scenario: Missing trusted-publisher mapping fails closed

- **WHEN** a publication is dispatched before the npmjs Trusted Publisher mapping exists and the GitHub-Release window is not active
- **THEN** the publish step fails without publishing anything to the registry

#### Scenario: Missing mapping is tolerated during the window

- **WHEN** a publication is dispatched during the GitHub-Release window and the npmjs Trusted Publisher mapping is absent or mismatched
- **THEN** the publish attempt fails but the run completes, the GitHub Release remains published, and the outcome is recorded in the run summary

#### Scenario: Protected environment gates the publish job

- **WHEN** the publish job starts
- **THEN** it runs only inside the protected `npm-release` environment, whose configuration requires reviewers, prevents self-review, and allows only the `main` and `develop` branches

### Requirement: Registry publication with trusted publishing

The publication workflow SHALL publish the tested tarballs to `https://registry.npmjs.org/` only, with public access, the channel's npm dist-tag, and npm provenance enabled. Authentication SHALL be npm Trusted Publishing: the publish job SHALL run with `id-token: write` in the protected `npm-release` GitHub environment and SHALL NOT reference any npm token secret in environment variables, workflow inputs, command arguments, repository files, or logs. Public access and the channel's dist-tag SHALL be applied as arguments of the publish invocation itself, because the trusted-publishing identity cannot perform post-publish `npm access` or `npm dist-tag` mutations, and the workflow SHALL NOT attempt them. The workflow SHALL verify, before publishing, that the available npm CLI supports trusted publishing (npm ≥ 11.5.1). During the GitHub-Release distribution window (see the `github-release-distribution` capability) the workflow MAY additionally attach the tested tarballs to a GitHub Release; that is not a second registry target and the npmjs registry remains the only registry. During the window the npmjs publication SHALL be attempted after the GitHub Release has been created and verified, best-effort: a failed attempt SHALL NOT fail the run and SHALL NOT affect the created Release.

#### Scenario: Publication is public with provenance

- **WHEN** the publish step completes successfully
- **THEN** the package version is public on npmjs, carries the requested dist-tag, and has provenance attestation

#### Scenario: Registry is locked

- **WHEN** the publish step is configured with any registry other than the public npmjs registry
- **THEN** the workflow fails before publishing

#### Scenario: No token anywhere

- **WHEN** the publication workflow definition and its scripts are inspected
- **THEN** no npm token secret is referenced, and the publish job carries `id-token: write` plus the `npm-release` environment

#### Scenario: Tag and access ride on the publish command

- **WHEN** the publish step runs
- **THEN** public access and the channel's dist-tag are requested by the publish invocation itself, and no separate dist-tag or access mutation command runs

#### Scenario: Window distribution coexists with the registry path

- **WHEN** a publication is dispatched during the GitHub-Release window
- **THEN** the tested tarballs are attached to a GitHub Release first, the npmjs publication is then attempted best-effort, and a registry failure leaves the GitHub Release published while the run still completes

### Requirement: Dist-tag safety and idempotency

The workflow SHALL, before publishing, snapshot the relevant npm dist-tags by read-only inspection of the public registry and, after publishing, verify them and fail closed on unexpected drift, in particular protecting an existing `latest` tag during `snapshot` and `rc` publications. A drifted dist-tag SHALL NOT be repaired by the workflow — repair requires registry authority the trusted-publishing identity does not have — so drift fails the run and the runbook SHALL direct the operator to the escalation path. On the very first publication of a package — when no `latest` exists to protect — the workflow SHALL tolerate the registry setting `latest` to the just-published version (unavoidable npmjs behavior) and fail only if `latest` resolves to any other version. Re-running the workflow for an already-published version and dist-tag SHALL be a tokenless no-op that succeeds without republishing: the run verifies from the public registry that the immutable version exists with the requested tag already applied. During the GitHub-Release distribution window (see the `github-release-distribution` capability) the pre-publish snapshot still occurs, but the post-publish verification runs only when the best-effort publication succeeded; when it did not, no npmjs publication or dist-tag mutation occurred and the verification is skipped.

#### Scenario: latest protected during prerelease

- **WHEN** an `rc` or `snapshot` version is published
- **THEN** the `latest` dist-tag still resolves to its pre-publication version, else the workflow fails

#### Scenario: First publication tolerates the registry setting latest

- **WHEN** the very first version of a package is published under an `rc` or `snapshot` dist-tag
- **THEN** the workflow tolerates `latest` resolving to that just-published version (the registry sets it unconditionally on first publication), but fails if `latest` resolves to any other version

#### Scenario: Idempotent rerun

- **WHEN** the workflow is re-dispatched with the same channel, version, and index after a successful publication
- **THEN** the run succeeds as a tokenless no-op, having verified from the public registry that the version exists with the requested tag, and publishes nothing new

#### Scenario: Drift is not repaired

- **WHEN** the post-publish verification finds a dist-tag resolving to an unexpected version
- **THEN** the workflow fails and no registry mutation is attempted from within the run

#### Scenario: Registry verification skipped after a tolerated failure

- **WHEN** a window publication fails at the best-effort publish step
- **THEN** no post-publish dist-tag verification runs, and the run still completes on the strength of the GitHub Release

### Requirement: Post-publication registry verification

The publication workflow SHALL, after publishing, wait for the version to propagate on the public registry, verify the expected dist-tags, and run a clean-consumer installation test that resolves the published version — and its transitive dependencies — from the public registry. During the GitHub-Release distribution window (see the `github-release-distribution` capability) these post-publication steps SHALL run only when the best-effort publication succeeded; when it did not, the window's release-URL consumer verification applies instead.

#### Scenario: Propagation wait and tag verification

- **WHEN** the publish step completes successfully
- **THEN** the workflow polls the registry until the version is visible, then verifies the dist-tags match the release intent

#### Scenario: Clean consumer installs the published version

- **WHEN** the registry-mode consumer test runs
- **THEN** a fresh project installs the published version from npmjs and the consumer round-trip passes

#### Scenario: Registry verification deferred to the window

- **WHEN** a publication is dispatched during the window and the best-effort publish attempt fails
- **THEN** no registry propagation wait, dist-tag verification, or registry-mode consumer test runs, and the window's release-URL consumer verification is the consumer check for that run
