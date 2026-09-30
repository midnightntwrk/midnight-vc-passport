# Spec Delta

## REMOVED Requirements

### Requirement: Window-scoped GitHub-Release distribution

**Reason**: The GitHub-Release distribution window has exited: v0.1.0-rc4 was accepted and became visible on npmjs through the Trusted Publishing path, meeting the window's exit condition.
**Migration**: npmjs is the only distribution channel (see `npm-publication`, "npmjs-only publication with trusted publishing"). Existing rc2–rc4 GitHub Releases are left in place; new versions are installed from npmjs.

### Requirement: Operator-owned release tags

**Reason**: Operator tags existed only to anchor window Releases; registry-only publication needs no repository ref.
**Migration**: The `tag` workflow input is removed; dispatch with `channel`, `version`, and `rc_index` only. The workflow remains stateless (see `npm-publication`, "Stateless release versioning").

### Requirement: Window channel semantics

**Reason**: No GitHub Releases are created, so prerelease/latest Release marking no longer applies, and the snapshot restriction existed only because snapshot versions could not be pre-tagged.
**Migration**: Channel semantics are the npm dist-tags in `npm-publication`; `snapshot` is available again from `develop` only (see `npm-publication`, "Publication channels and branch gating").

### Requirement: Release assets and integrity evidence

**Reason**: No Release assets are published.
**Migration**: Integrity evidence is the npm provenance attestation, the registry payload-identity check (see `npm-publication`, "Verified post-publication registry checks"), and the 90-day release-evidence workflow artifact with tarballs and SBOMs (see `npm-publication`, "Release evidence and retention").

### Requirement: Release-URL consumer verification

**Reason**: No Release URL exists to install from.
**Migration**: The registry-mode consumer test (see `npm-publication`, "Verified post-publication registry checks") is the post-publication consumer check.

### Requirement: Consumer URL-install guidance

**Reason**: Consumers install from npmjs.
**Migration**: See `npm-publication`, "Consumer install guidance". Consumers pinned to an rc2–rc4 Release URL keep working; they upgrade by switching the dependency to the npmjs version.

### Requirement: Security self-check window contract

**Reason**: The window workflow shape no longer exists.
**Migration**: The self-check enforces the registry-only shape and forbids reintroducing the window shape (see `repository-toolchain`, "Continuous integration and registry-only publication self-check lanes").

### Requirement: Window exit condition

**Reason**: The exit has been carried out by this change.
**Migration**: The runbook records the window's end and the fate of existing Releases (see `npm-publication`, "Publication runbook").
