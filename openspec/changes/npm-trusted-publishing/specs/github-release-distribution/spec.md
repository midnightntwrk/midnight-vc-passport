# github-release-distribution delta — bridge retirement

The bridge ends through this change: npm Trusted Publishing removes the dependency on the npm automation token that kept the bridge alive, so the temporary GitHub-Release distribution capability is retired in full, per its own exit requirement (single follow-up change, npmjs returns to the sole distribution channel, no silent second channel).

## REMOVED Requirements

### Requirement: Bridge window suspends npmjs publication

**Reason:** the bridge existed only while the npm token grant was unavailable; npm Trusted Publishing (OIDC) authenticates without any token, so the suspension is lifted and the registry path is restored in the same change.

**Migration:** the suspended npmjs steps are replaced by their trusted-publishing form (see the `npm-publication` capability); already-published GitHub Releases remain downloadable, and new publications go to npmjs only.

### Requirement: Operator-owned release tags

**Reason:** operator-created release tags existed to anchor GitHub Releases; the registry path publishes statelessly under its own version scheme, so the `tag` workflow input and its reconciliation step are removed.

**Migration:** release dispatch no longer requires a pre-created tag; the workflow stays stateless exactly as the `npm-publication` stateless-versioning requirement specifies.

### Requirement: Bridge channel semantics

**Reason:** channel semantics (prerelease/latest marking) were bridge-specific; the `snapshot` channel's fail-closed restriction existed only because run-number-stamped versions cannot be pre-tagged by an operator, which no longer applies.

**Migration:** channels return to the unconditional `npm-publication` branch gating; `snapshot` publications to npmjs resume with run-number-stamped versions under the `snapshot` dist-tag.

### Requirement: Release assets and integrity evidence

**Reason:** GitHub-Release asset assembly, digest verification, and artifact attestations were the bridge's distribution mechanism.

**Migration:** tarball integrity moves to the registry path: contract-checked tarballs are published with npm provenance, and release evidence (tarballs, SBOMs, dist-tag snapshot) is carried by the workflow's release-evidence artifact per the `npm-publication` capability.

### Requirement: Release-URL consumer verification

**Reason:** URL-mode consumer verification exercised the bridge's distribution URL.

**Migration:** consumer verification runs in registry mode against the published npmjs version per the `npm-publication` capability.

### Requirement: Consumer URL-install guidance

**Reason:** URL-install guidance documented how to consume the bridged package without a registry.

**Migration:** consumers install `@midnight-ntwrk/midnight-verifiable-credential-digital-passport` from npmjs under the published dist-tags; existing URL-pinned installs keep resolving against the already-published GitHub Releases.

### Requirement: Security self-check bridge contract

**Reason:** the bridge pinned a temporary publication-workflow shape (`contents: write`, `id-token: write`, `attestations: write`).

**Migration:** the self-check returns to the unconditional publication shape — and now additionally asserts the `npm-release` environment and the absence of npm token references (see the `repository-toolchain` capability).

### Requirement: Bridge exit condition

**Reason:** this change is the bridge exit; its exit condition (npm token available plus a first successful registry publication) is superseded by the trusted-publisher configuration prerequisite.

**Migration:** the runbook's exit procedure is replaced by the trusted-publisher prerequisites and first-publication procedure in the `npm-publication` capability; npmjs becomes the sole distribution channel and no GitHub-Release publication path remains.
