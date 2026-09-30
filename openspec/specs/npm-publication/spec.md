## Purpose

Defines the npmjs release train for the digital-passport package: how versions are cut, what gates a publication must pass, how the registry receives tested artifacts with provenance evidence, and how dist-tags are kept safe — authenticated end-to-end by npm Trusted Publishing (GitHub Actions OIDC under the protected `npm-release` environment; no npm token exists). Adapted from the `midnight-verifiable-credentials` publication model to this single-package repository.

## Requirements

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

### Requirement: Release evidence and retention

The publication workflow SHALL generate an SPDX SBOM for each packed tarball and upload a release-evidence artifact containing the tested tarballs, the dist-tag state snapshot, and the SBOMs, retained for at least 90 days.

#### Scenario: Evidence artifact per publication

- **WHEN** a publication run completes
- **THEN** the run's artifact contains the published tarballs, their SPDX SBOMs, and the recorded npm release state

### Requirement: Publication runbook

The repository SHALL carry a publication runbook document covering ownership (technical, release authority, security escalation), trusted-publisher prerequisites (the npmjs Trusted Publisher mapping and the `npm-release` environment configuration — both owner actions outside the repository), pre-dispatch gates, the dispatch procedure, post-publication verification, retry and rollback, and incident response including the registry-authority escalation path for dist-tag drift. The retry guidance SHALL state that versions are immutable, that the operator inspects the registry before re-dispatching after a failed run, and that re-dispatching a Visible version is a no-op that completes verification. The runbook SHALL record the package's known `latest` state while no stable version exists — `latest` resolving to the first-published prerelease until the first `release` publication moves it — and SHALL record the end of the GitHub-Release distribution window, stating that previously created Releases remain but receive no new versions. The runbook SHALL NOT instruct any operator to provision or supply an npm token.

#### Scenario: Runbook covers the operator path

- **WHEN** a release operator follows the runbook
- **THEN** it names the owners, the trusted-publisher prerequisites, the dispatch inputs, and the verification, retry, rollback, and escalation steps for a publication

#### Scenario: Runbook explains retry after a propagation timeout

- **WHEN** an operator reads the runbook after a run failed with an Accepted but not Visible outcome
- **THEN** it directs them to inspect the registry and re-dispatch with the same inputs, and warns that versions are immutable

#### Scenario: No token provisioning is documented

- **WHEN** the publication runbook is inspected
- **THEN** it contains no instruction to create, configure, or supply an npm token secret

### Requirement: Mandatory trusted-publisher prerequisite

The publication workflow SHALL fail closed at the publish step — publishing nothing — unless npm Trusted Publishing is available to it: the npmjs Trusted Publisher mapping for `@midnight-ntwrk/midnight-vc-passport` (organization `midnightntwrk`, repository `midnight-vc-passport`, workflow filename `publish.yml`, GitHub environment `npm-release`) created by npm organization owners, and the protected `npm-release` GitHub environment configured by repository owners. No npm token secret SHALL be provisioned, referenced, or required. The publication runbook SHALL name both owner actions as prerequisites, and the repository's tooling SHALL NOT attempt registry administration (access grants or dist-tag repair) that the trusted-publishing identity cannot perform. A failed or rejected publish attempt SHALL fail the run; no publication outcome SHALL be tolerated as best-effort.

#### Scenario: Missing trusted-publisher mapping fails closed

- **WHEN** a publication is dispatched while the npmjs Trusted Publisher mapping is absent or mismatched
- **THEN** the publish step fails without publishing anything to the registry, and the run fails

#### Scenario: Protected environment gates the publish job

- **WHEN** the publish job starts
- **THEN** it runs only inside the protected `npm-release` environment, whose configuration requires reviewers, prevents self-review, and allows only the `main` and `develop` branches

### Requirement: npmjs-only publication with trusted publishing

The publication workflow SHALL publish the tested tarballs to `https://registry.npmjs.org/` only, with public access, the channel's npm dist-tag, and npm provenance enabled. npmjs SHALL be the only distribution channel: the workflow SHALL NOT attach release tarballs to a GitHub Release or publish them to any other location. Authentication SHALL be npm Trusted Publishing: the publish job SHALL run with `id-token: write` in the protected `npm-release` GitHub environment and SHALL NOT reference any npm token secret in environment variables, workflow inputs, command arguments, repository files, or logs. Public access and the channel's dist-tag SHALL be applied as arguments of the publish invocation itself, because the trusted-publishing identity cannot perform post-publish `npm access` or `npm dist-tag` mutations, and the workflow SHALL NOT attempt them. The workflow SHALL verify, before publishing, that the available npm CLI supports trusted publishing (npm ≥ 11.5.1). The publish command SHALL be invoked at most once per package per run and SHALL NOT be retried; a successful publish invocation establishes only that the version is Accepted, and it SHALL NOT be reported as Published until post-publication verification establishes that it is Verified.

#### Scenario: Publication is public with provenance

- **WHEN** a publication run completes successfully
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

#### Scenario: npmjs is the only channel

- **WHEN** an `rc` or `release` publication completes
- **THEN** no GitHub Release is created or modified by the run and the tarball is distributed only through npmjs

#### Scenario: Publish is never retried

- **WHEN** the publish invocation fails or its result is uncertain
- **THEN** the run does not invoke publish again for that package and fails, leaving recovery to a re-dispatch that starts from a fresh registry preflight

### Requirement: Dist-tag safety and idempotent reruns

The workflow SHALL, before publishing, snapshot the relevant npm dist-tags by read-only inspection of the public registry and, after publishing, verify them and fail closed on unexpected drift, in particular protecting an existing `latest` tag during `snapshot` and `rc` publications. A drifted dist-tag SHALL NOT be repaired by the workflow — repair requires registry authority the trusted-publishing identity does not have — so drift fails the run and the runbook SHALL direct the operator to the escalation path. On the very first publication of a package — when no `latest` exists to protect — the workflow SHALL tolerate the registry setting `latest` to the just-published version (unavoidable npmjs behavior) and fail only if `latest` resolves to any other version. Re-running the workflow for an already-published version and dist-tag SHALL be a tokenless no-op that succeeds without republishing: the run verifies from the public registry that the immutable version exists with the packed payload (payload identity as defined in the verified post-publication registry checks requirement) and the requested tag already applied, then runs the same post-publication verification as a fresh publication. An already-present version whose payload differs from the packed tarball, or whose requested tag does not resolve to it, SHALL fail the run before any publish invocation.

#### Scenario: latest protected during prerelease

- **WHEN** an `rc` or `snapshot` version is published
- **THEN** the `latest` dist-tag still resolves to its pre-publication version, else the workflow fails

#### Scenario: First publication tolerates the registry setting latest

- **WHEN** the very first version of a package is published under an `rc` or `snapshot` dist-tag
- **THEN** the workflow tolerates `latest` resolving to that just-published version (the registry sets it unconditionally on first publication), but fails if `latest` resolves to any other version

#### Scenario: Idempotent rerun

- **WHEN** the workflow is re-dispatched with the same channel, version, and index after the version became Visible
- **THEN** the run publishes nothing new, verifies the existing version's payload and dist-tag from the public registry, completes post-publication verification, and succeeds

#### Scenario: Pre-existing payload mismatch fails before publishing

- **WHEN** the target version already exists on the registry but its payload differs from the packed tarball
- **THEN** the workflow fails before any publish invocation

#### Scenario: Drift is not repaired

- **WHEN** the post-publish verification finds a dist-tag resolving to an unexpected version
- **THEN** the workflow fails and no registry mutation is attempted from within the run

### Requirement: Verified post-publication registry checks

After the publish step, the publication workflow SHALL establish that the release is Verified before the run may succeed, and every post-publication step SHALL run unconditionally whenever the publish step succeeded. Verification SHALL consist of:

1. **Bounded convergence.** A single wait, starting when the publish step completes, SHALL poll the public registry every 30 seconds for at most 300 seconds, with every registry request individually time-bounded, until the exact version is Visible: served by the registry, its payload identical to the packed tarball, and the channel's dist-tag resolving to it. Only a recognised not-found answer for the exact version, or a valid dist-tag not yet pointing at it, SHALL count as pending; any other command failure or malformed registry metadata SHALL fail immediately. A non-`release` version owning `latest` SHALL fail immediately. Evidence that arrives only after the deadline SHALL fail the run. No other step SHALL poll for propagation.
2. **Payload identity.** The registry's recorded integrity SHALL equal the packed tarball's integrity; when it does not, the workflow SHALL download the registry tarball and compare its package contents with the packed tarball, accepting content-identical payloads and failing on any difference.
3. **Dist-tag verification** as defined in the dist-tag safety and idempotent reruns requirement.
4. **Registry consumer test.** A clean consumer, with a fresh, run-private package-manager cache and store, SHALL install the exact tarball the registry serves for the version, requesting fresh registry metadata, with dependencies resolved from the public registry, and the consumer round-trip SHALL pass. The install SHALL be attempted at most 3 times, 10 seconds apart.

#### Scenario: Delayed visibility within the budget succeeds

- **WHEN** the publish step succeeds and the version and its dist-tag become visible on the registry 4 minutes later
- **THEN** the convergence wait succeeds and the run proceeds to dist-tag verification and the consumer test

#### Scenario: Propagation timeout fails the run

- **WHEN** the publish step succeeds but the version is not Visible within 300 seconds
- **THEN** the run fails without invoking publish again

#### Scenario: Unexpected registry error fails immediately

- **WHEN** a registry read during the convergence wait fails for a reason other than the exact version being not found, or returns malformed metadata
- **THEN** the wait fails immediately rather than continuing to poll

#### Scenario: Content-identical rebuild accepted

- **WHEN** the registry's integrity for the version differs from a rebuilt packed tarball whose package contents are identical to the registry tarball
- **THEN** payload identity is accepted

#### Scenario: Different payload rejected

- **WHEN** the registry tarball's package contents differ from the packed tarball
- **THEN** the run fails

#### Scenario: Stale local metadata cannot hide a published version

- **WHEN** the runner holds package-manager metadata cached before the version was published
- **THEN** the registry consumer test does not read that cache and installs the version from the registry

#### Scenario: Clean consumer installs the published version

- **WHEN** the registry-mode consumer test runs
- **THEN** a fresh project installs the tarball served by npmjs for the published version and the consumer round-trip passes

### Requirement: Publication outcome reporting

The publication workflow SHALL write an always-run summary that classifies the run's publication outcome as exactly one of: **Rejected** (no publish invocation was made, or the publish invocation failed — nothing is claimed to exist on the registry); **Accepted, propagation timed out** (the publish invocation succeeded but the version was not Visible within the convergence budget); **Visible, verification failed** (the version is Visible but dist-tag verification or the registry consumer test failed); or **Verified**. The summary SHALL use "published" only for Verified, SHALL NOT claim that nothing was published for an Accepted outcome, and for every non-Verified outcome SHALL carry retry guidance: versions are immutable, inspect the registry before re-dispatching, and a re-dispatch never republishes an existing version. A run SHALL succeed only when the outcome is Verified.

#### Scenario: Timeout after acceptance is reported accurately

- **WHEN** the publish invocation succeeds and the convergence wait times out
- **THEN** the run fails and its summary reports Accepted, propagation timed out, with retry guidance, and does not state that nothing was published

#### Scenario: Rejection is reported

- **WHEN** the publish invocation fails
- **THEN** the run fails and its summary reports Rejected

#### Scenario: Downstream failure is reported

- **WHEN** the version is Visible but the registry consumer test fails
- **THEN** the run fails and its summary reports Visible, verification failed

#### Scenario: Only Verified is green

- **WHEN** convergence, payload identity, dist-tag verification, and the registry consumer test all pass
- **THEN** the run succeeds and its summary reports Verified

### Requirement: Consumer install guidance

The repository's consumer-facing documentation SHALL direct consumers to install the package from the public npmjs registry by name and version or dist-tag. It SHALL NOT present GitHub Release download URLs as an install path, except for a single note that the tarballs attached to earlier prerelease GitHub Releases remain available at their existing URLs and that no new versions are attached to GitHub Releases.

#### Scenario: Consumers are pointed at npmjs

- **WHEN** a downstream developer reads the repository README install section
- **THEN** it shows installing `@midnight-ntwrk/midnight-vc-passport` from npmjs and no Release-URL install procedure
