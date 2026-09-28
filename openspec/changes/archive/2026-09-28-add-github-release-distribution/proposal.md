# Proposal

## Why

The npmjs release train for `@midnight-ntwrk/midnight-vc-passport` is fully
implemented but cannot publish: the npmjs Trusted Publisher mapping is not
configured, so the publish step fails closed with npm `E404` and the package
has never been published while consumers wait for an installable artifact. A
temporary GitHub-Release distribution channel lets us ship the gated tarball
now, **coexisting** with the npm attempt so the Release asset is always
produced even while npm is unavailable.

## What Changes

- **Coexisting GitHub-Release distribution.** `.github/workflows/publish.yml`
  gains a required `tag` input and Release steps that run after the gate/pack
  and **before** the npm attempt: operator-tag reconciliation, release
  creation with assets, uploaded-digest verification, artifact attestations,
  and a release-URL consumer test. The workflow keeps a single dispatch
  surface, gate, and trust chain.
- **Best-effort npm publication.** The existing npm steps remain present and
  live, but publication is attempted best-effort: a failure is tolerated (the
  run stays green and records the outcome in its summary), and the downstream
  registry steps (propagation wait, dist-tag verification, registry consumer
  test) run only if the publish succeeded. npm remains the durable target; the
  GitHub Release is the interim channel.
- **Operator-created release tags.** The run fails closed unless the supplied
  tag exists, points at the dispatch ref's HEAD, and its version (leading `v`
  stripped) equals the resolved channel version. The workflow never creates,
  moves, or deletes any commit, tag, or branch.
- **Channel semantics.** `rc` creates a GitHub prerelease that is never marked
  latest, `release` a release marked latest, and `snapshot` fails closed with a
  clear message (run-number-stamped snapshot versions cannot be pre-tagged).
- **Release assets and integrity.** Each release carries the packed tarball, a
  `SHA256SUMS` file, the SPDX SBOM, the pack contract report, and a generated
  body (channel, version, versioned install URL, checksums, verification
  one-liners, changelog link). Uploaded digests are compared against the
  locally packed artifacts, and build-provenance attestations are generated for
  every asset. The 90-day release-evidence artifact continues to be produced.
- **Release-URL consumer verification.** A clean consumer installs the package
  from the just-created release's download URL and runs the round-trip;
  failure fails the run.
- **Consumer documentation.** Root and package READMEs document the interim
  versioned release-URL install; the publication runbook documents the window
  procedure, rerun/rollback, and exit.
- **Security self-check.** `check-security-workflows.mjs` and its mutation
  tests pin the window workflow shape exactly; every other enforced property
  (dispatch-only, channel gate, registry lock, zero token references,
  SHA-pinned actions, checkout hygiene) is unchanged.
- **Defined exit — out of scope here.** The runbook records the exit condition
  (npm mapping configured and a successful publication) and a single follow-up
  change removes the Release steps and this capability. That removal change is
  **not** implemented in this change.

## Capabilities

### New Capabilities

- `github-release-distribution`: The temporary GitHub-Release distribution
  window — operator-owned tags and their reconciliation, release assets with
  integrity evidence, channel semantics, release-URL consumer verification,
  consumer URL-install guidance, the self-check window contract, coexistence
  with a best-effort npm publication attempt, and the window's recorded exit
  condition.

### Modified Capabilities

- `npm-publication`: The trusted-publisher prerequisite and the
  registry-publication requirement gain the window clause — a non-registry
  GitHub Release may be produced during the window and the npm publication is
  attempted best-effort rather than fail-closed — and the post-publication
  registry requirements apply only when that best-effort publication succeeded.
  The remaining requirements (channels/branch gating, stateless versioning,
  pre-publication gate, release evidence, runbook) stay in force.
- `repository-toolchain`: The publication-workflow clause of the CI self-check
  requirement is scoped to the window shape (permissions exactly
  `contents: write` + `id-token: write` + `attestations: write`, the operator
  tag input, the Release steps, and a best-effort npm publish through the
  protected `npm-release` environment).

## Impact

- **Workflow**: `.github/workflows/publish.yml` — `tag` input, Release steps,
  permission shape `contents: write` + `id-token: write` + `attestations:
  write` (top level and job level), and npm steps made best-effort/gated.
- **Release tooling**: `tooling/scripts/verify-release-tag.mjs` and
  `tooling/scripts/publish-github-release.mjs` restored; `release-resolve-context.sh`
  gains the window `snapshot` guard; `prepare-release-version.mjs` re-exports
  the expected-tag helper; `test-release-package-consumers.mjs` regains the
  `--release-url` mode; `check-security-workflows.mjs` and the release-tooling
  mutation tests pin the window contract.
- **Documentation**: `docs/guides/npmjs-publication.md` (window procedure,
  rerun/rollback, exit condition), root `README.md` and package `README.md`
  (interim release-URL install).
- **Ownership**: new/restored files under `tooling/scripts/` join the existing
  CODEOWNERS release-surface entry.
- **Consumers**: no changes in this repo; downstream repos pin the versioned
  release URL directly (generic documentation only).
