## Why

The npmjs release train (`add-npm-release-pipeline`) cannot run: the `MIDNIGHTCI_NPMJS_TOKEN` grant is blocked outside our control, so the package has never been published to the registry while downstream consumers wait for an installable artifact. As a temporary bridge, the gated release tarball will be attached to GitHub Releases and consumers install it by versioned release URL; npmjs remains the sole eventual target (GitHub Packages was rejected to avoid a second confusing registry target).

## What Changes

- **Bridge the publication workflow to GitHub Releases.** In `.github/workflows/publish.yml`, comment out the npm-registry steps (npm CLI trusted-publishing check, dist-tag snapshot, npm publish, propagation wait, dist-tag verify, registry-mode consumer test — with an explicit restore-instructions comment block) and add bridge steps: manual-tag reconciliation, release creation and asset upload, uploaded-asset digest verification, a release-URL-mode consumer test, and artifact attestations.
- **Operator-created release tags.** A new `tag` workflow input; the run fails closed unless the tag exists, points at the dispatch ref's HEAD, and its version (leading `v` stripped) equals the resolved channel version. The workflow itself never commits, tags, or pushes (statelessness preserved; tags are operator-owned inputs).
- **Channel semantics under the bridge.** `rc` publishes a GitHub prerelease (never latest), `release` publishes a release marked latest, and `snapshot` fails closed with a clear message (run-number-stamped snapshot versions cannot be pre-tagged).
- **Release assets and body.** Each release carries the packed tarball (default npm-pack filename), a SHA256SUMS file, the SPDX SBOM, the pack contract report, and a generated summary body (channel, version, install URL, checksum, verification one-liners) linking the changelog. The 90-day release-evidence artifact is retained.
- **Integrity.** Artifact attestations are generated for the uploaded assets; the residual risk of mutable release assets is accepted and documented (mitigation: tag-deletion protection via rulesets where the org permits).
- **Security self-check update.** `check-security-workflows.mjs` and its release-tooling tests assert the bridge permission shape exactly (`contents: write`, `id-token: write`, `attestations: write`); every other enforced property (dispatch-only, channel gate, npmjs-locked `NPM_REGISTRY`, env indirection, SHA-pinned actions, `persist-credentials: false`) is unchanged.
- **Consumer documentation (generic — any repo, never named).** Versioned release-URL pinning in `dependencies` with lockfile freezing, the one-line upgrade procedure, why no exotic-dep exemption is needed for a direct URL dependency, and the documented-but-not-mandated `gh attestation verify`/checksum verification commands.
- **Defined exit.** The runbook records the exit condition: after the first successful `release`-channel npmjs publication once the token lands, a single follow-up change comments the bridge out, restores the npm path, and returns the scoped `npm-publication` and `repository-toolchain` requirements to their unconditional form.

Not changed: the package contract (`package-distribution`), the flake `npm-artifacts` output, the pack/SBOM/contract-check tooling semantics (the contract check additionally emits a report artifact; its checking semantics are unchanged), CODEOWNERS ownership model (new script files join the existing release-surface ownership).

## Capabilities

### New Capabilities

- `github-release-distribution`: The temporary GitHub-Release distribution bridge — operator-owned tags and their reconciliation, release assets with integrity evidence, channel semantics under the bridge, consumer URL-install guidance, the suspension of npmjs-registry publication during the bridge window, and the bridge's exit condition.

### Modified Capabilities

- `npm-publication`: The four registry-facing requirements — registry publication with provenance, dist-tag safety and idempotency, post-publication registry verification, and release evidence — are scoped to apply only while the npmjs-registry publication path is active, with the GitHub-Release bridge window named as the suspension period (the pipeline change `add-npm-release-pipeline` is already archived and its main spec exists, so `MODIFIED` deltas validate against it). Release evidence joins the scoped set because its dist-tag state snapshot is produced by the suspended snapshot step: during the bridge the evidence artifact carries the tested tarballs and SBOMs, while the SHA256SUMS, contract report, and attestations ride on the GitHub release assets. The remaining `npm-publication` requirements — publication channels and branch gating, stateless release versioning, the pre-publication gate, and the publication runbook — remain in force unchanged. When the bridge exits, its removal change restores the four scoped requirements to unconditional form and deletes the `github-release-distribution` requirements — leaving `npm-publication` as the sole publication spec.
- `repository-toolchain`: The CI-lane self-check requirement's publication-workflow clause — dispatch-only trigger, branch/channel gate, registry lock, provenance-enabled publish, least-privilege permissions — is scoped to the npmjs-path-active period, with the bridge window named as the period during which the self-check instead asserts the bridge publication shape (no publish step; permissions exactly `contents: write`, `id-token: write`, `attestations: write`). The main spec exists, so the `MODIFIED` delta validates against it; the same bridge-exit change restores the clause to unconditional form.

## Impact

- **Workflow**: `.github/workflows/publish.yml` — commented npm steps, new bridge steps, `tag` input, permission shape `contents: write` + `id-token: write` + `attestations: write` (top level and job level).
- **Release tooling**: `tooling/scripts/release-resolve-context.sh` and/or `prepare-release-version.mjs` (tag input plumbing and reconciliation), `test-release-package-consumers.mjs` (release-URL mode), `check-release-package-contract.mjs` (machine-readable contract-report emission — checking semantics unchanged), a new release-upload/verify script (exact split decided in design), `check-security-workflows.mjs` (bridge permission assertions) plus the release-tooling unit tests that exercise mutated workflow copies.
- **Documentation**: `docs/guides/npmjs-publication.md` (bridge dispatch procedure and exit condition), root `README.md` and package `README.md` (bridge install section).
- **Ownership**: new files under `tooling/scripts/` added to the existing CODEOWNERS release-surface entry.
- **Process**: work lands on the `release-tgz` branch; review routes to `@midnight-ntwrk/ex-identus`, `@midnight-ntwrk/mn-security`, `@midnight-ntwrk/mn-sre`.
- **Consumers**: no changes required in this repo; downstream repos pin the versioned release URL directly (generic documentation only).
