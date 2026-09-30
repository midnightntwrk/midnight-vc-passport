# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **BREAKING (release process):** npmjs publication is mandatory and the
  GitHub-Release distribution window has ended. A green publish run now
  means the version is **Verified** (see `CONTEXT.md`): `continue-on-error`
  and every publish-outcome guard are gone; a single convergence gate polls
  every 30s for at most 300s and requires the registry payload to match the
  packed tarball (integrity, then a content comparison); `npm publish` runs
  once and is never retried; the registry consumer test installs the exact
  `dist.tarball` URL with a run-private pnpm store and cache (3 attempts,
  10s apart); and the always-run summary reports Rejected, Accepted
  (propagation timed out), Visible (verification failed), or Verified with
  retry guidance. The `tag` input, operator-tag reconciliation, GitHub
  Release creation/attestation, and the release-URL consumer mode are
  removed, the workflow permissions are back to `contents: read` +
  `id-token: write`, and `snapshot` is available again from `develop`. The
  security-workflow self-check now forbids reintroducing any of the window
  shape. The rc2–rc4 GitHub Releases stay in place, but no new versions are
  attached to GitHub Releases.

### Added

- Fifth release candidate: **`v0.1.0-rc5`** dispatched on `develop` at
  `394ee8e` (channel `rc`, `rc_index=5`,
  [run 36713241182](https://github.com/midnightntwrk/midnight-vc-passport/actions/runs/36713241182)),
  the first run of the mandatory npmjs publication path and its end-to-end
  validation. It was **Verified**: `npm publish` was Accepted at 12:12:49Z,
  the version became Visible (payload integrity matched, `rc` resolved to it)
  after 91 seconds of the 300-second convergence budget, the dist-tag check
  confirmed `latest` unchanged at `0.1.0-rc3`, and the clean registry install
  of the exact tarball URL passed on its first attempt. No GitHub Release was
  created.

- Fourth release candidate: **`v0.1.0-rc4`** dispatched on `develop` at
  `cb916ad` (channel `rc`, `rc_index=4`,
  [run 36700635993](https://github.com/midnightntwrk/midnight-vc-passport/actions/runs/36700635993)),
  the last GitHub-Release window release and the first run of the workflow
  whose npmjs publication went through Trusted Publishing. The
  [prerelease](https://github.com/midnightntwrk/midnight-vc-passport/releases/tag/v0.1.0-rc4)
  was created as before. On npmjs, `npm publish` was **Accepted** at about
  10:10:21Z and the version became **Visible** about four minutes later
  (version and dist-tags by about 10:14:43Z, install packument by about
  10:16:56Z). The publish script's 60-second read-back timed out first, and
  the best-effort guard reported a tolerated failure that was not an
  authentication rejection and skipped the registry checks (issue #17). The
  registry now serves `rc=0.1.0-rc4` and `latest=0.1.0-rc3`.

- Third release candidate: **`v0.1.0-rc3`** dispatched on `develop` at
  `cb916ad` (channel `rc`, `rc_index=3`,
  [run 36692150763](https://github.com/midnightntwrk/midnight-vc-passport/actions/runs/36692150763)).
  Documentation and openspec-sync only since rc2 (no package source changes;
  the tarball is the rc2 contents re-cut). The
  [prerelease](https://github.com/midnightntwrk/midnight-vc-passport/releases/tag/v0.1.0-rc3)
  (never latest) carries the contract-checked tarball, `SHA256SUMS`, the SPDX
  SBOM, and the package-contract report; every uploaded digest matched the
  packed artifact, the release-URL consumer round-trip passed, and the
  tarball's build-provenance attestation verified via `gh attestation
  verify`. The best-effort npmjs publication again failed with `E404` (the
  Trusted Publisher mapping is still not configured) and was tolerated as
  designed.

- First GitHub-Release distribution window release: **`v0.1.0-rc2`**
  dispatched on `develop` at `e4b5160` (channel `rc`, `rc_index=2`,
  [run 36428782614](https://github.com/midnightntwrk/midnight-vc-passport/actions/runs/36428782614)). The
  [prerelease](https://github.com/midnightntwrk/midnight-vc-passport/releases/tag/v0.1.0-rc2) (never latest)
  carries the contract-checked tarball, `SHA256SUMS`, the SPDX SBOM, and the
  package-contract report; every uploaded digest matched the packed
  artifact, the release-URL consumer round-trip passed, and every asset's
  build-provenance attestation verified via `gh attestation verify`. The
  best-effort npmjs publication failed with `E404` (Trusted Publisher
  mapping not yet configured) and was tolerated as designed; the window's
  exit condition lives in the
  [publication runbook](docs/guides/npmjs-publication.md#github-release-distribution-window-ended).

- First bridge release: **`v0.1.0-rc1`** dispatched on `develop` (channel
  `rc`, [run 33615405618](https://github.com/midnightntwrk/midnight-verifiable-credential-digital-passport/actions/runs/33615405618))
  through the temporary GitHub-Release distribution bridge pending the npmjs
  automation token. The prerelease (never latest) carries the
  contract-checked tarball, `SHA256SUMS`, the SPDX SBOM, the package-contract
  report, and build-provenance attestations for every asset; the release-URL
  consumer round-trip passed and every attestation verified via
  `gh attestation verify`. Consumers install by the versioned release URL
  (see the READMEs); the dispatch procedure and the bridge exit condition
  live in the [publication runbook](docs/guides/npmjs-publication.md).

### Security

- Pinned the transitive `nanoid` to **3.3.18** via a single workspace
  override, clearing **GHSA-2v37-7h3g-55p8** (high: custom generators can
  loop indefinitely when size is zero). The lockfile had resolved 3.3.17
  while 3.3.18 sat inside the 7-day `minimumReleaseAge` window, and
  `pnpm update` no-ops on an already-satisfying lockfile; 3.3.18 carries npm
  provenance attestations like its predecessor. Dev-tooling scope only
  (postcss chain) — surfaced by the first `develop` → `main` dependency
  review, which fails on high severity.

### Added

- The npmjs release train for
  `@midnight-ntwrk/midnight-vc-passport`, ported
  from the `midnight-verifiable-credentials` publication model and reduced to
  this single-package repository (change `add-npm-release-pipeline`):
  - **`publish.yml`**: a dispatch-only publication workflow (`channel`
    `snapshot`/`rc`/`release`, `version`, `rc_index`) with sibling branch
    rules (`snapshot` from `develop` only, `rc` from `develop`/`main`,
    `release` from `main` only), an in-run full gate (`pnpm run all` + smoke),
    stateless version stamping (never committed back), tarball packing with a
    contract check and clean-consumer tests (tarball and registry modes),
    SPDX SBOMs, `--provenance`-enabled publication to the locked public npmjs
    registry, dist-tag snapshot/verification with `latest` protection,
    idempotent no-op reruns, and a 90-day release-evidence artifact.
  - **Release tooling** under `tooling/scripts/` (all covered by the new
    `test:release-tooling` suite wired into the CI gate): workspace catalog,
    version preparation, context resolution, artifact packing, package
    contract check, consumer testing, publication, dist-tag state,
    propagation wait, and SBOM generation.
  - **CI on `develop`**: the CI lane now runs on pushes to `develop` and
    `main`, giving rc candidates pre-dispatch signal.
  - **Self-guard extension**: `check-security-workflows` now asserts the
    publication workflow stays dispatch-only, keeps its branch/channel gate,
    pins the public npmjs registry, and holds least-privilege permissions.
  - **Runbook** at `docs/guides/npmjs-publication.md` (ownership, token
    policy, pre-dispatch gates, first-release dispatch, verification,
    retry/rollback, incident response); README carries npm install
    instructions; CODEOWNERS routes the release surface to
    `ex-identus`/`mn-sre`/`mn-security`.
  - **Manifest hygiene**: the family package manifest gains `publishConfig`,
    `repository`, `description`, `keywords`, `homepage`, and `bugs`, plus a
    package-level `CHANGELOG.md` shipped in the tarball.

### Security

- Adopted the OSS security-hardening posture the sibling repositories
  (`midnight-did`, `midnight-verifiable-credentials`) already operate:
  - **Supply-chain hardened installs**: `pnpm-workspace.yaml` now enforces
    `blockExoticSubdeps`, a 7-day `minimumReleaseAge`, and a `no-downgrade`
    trust policy (empty, explicit exclusion lists), and declares the
    previously-silent build-script skips (`esbuild`, `unrs-resolver`) as
    `ignoredBuiltDependencies`; `.npmrc` gains `min-release-age=7`.
  - **Dependency update automation**: the npm Dependabot lane is re-enabled
    (daily, 7-day cooldown) next to github-actions, and `renovate.json`
    activates the installed Renovate app via the org preset
    (`local>midnightntwrk/renovate-config`).
  - **Fail-closed scan lane**: the Scan workflow pins
    `midnightntwrk/upload-sarif-github-action` to `e90808c`, fails on
    high-severity findings, skips the duplicated Scorecard pass, disables
    checkout credential persistence, and runs on `ubuntu-24.04`.
  - **Self-guarding workflows**: two CI-enforced checks
    (`check:security-workflows`, ported from midnight-verifiable-credentials
    and adapted to this repo's main-only branch policy; and
    `check:vulnerability-exceptions`) assert full-SHA action pinning,
    `persist-credentials: false`, structural workflow contracts, and
    documented/owned/expiring OSV exceptions; both run in the CI verify lane
    via the root `all` script.
  - **Vulnerability exception governance**: `osv-scanner.toml` (currently
    empty) paired with `docs/security/vulnerability-exceptions.md`; every
    future ignored advisory must be documented with an accountable owner and
    an expiry, enforced in CI.
  - **Workflow pin tidy-up**: `actions/checkout` normalized to v7.0.1 and
    `setup-node` to v7.0.0 (sibling-pinned SHAs) across `ci.yml`,
    `scorecard.yml`, `dependency-review.yml`, and the setup composite;
    CODEOWNERS now guards `scorecard.yml` and `dependency-review.yml` and the
    dependabot entry points at `/.github/dependabot.yml` (was a dangling
    workflows path); README carries the OpenSSF Scorecard badge.
- Added a digital-passport threat-model proposal at
  `docs/security/digital-passport-threat-model.md` (promotion into
  `SECURITY.md` is `@midnightntwrk/mn-security`'s decision).

### Changed

- Renamed the publishable package to
  **`@midnight-ntwrk/midnight-vc-passport`** (was
  `@midnight-ntwrk/midnight-verifiable-credential-digital-passport`) and its
  workspace directory to `packages/midnight-vc-passport`. Nothing was ever
  published to npm under the old name, so there is no deprecation cycle; the
  npmjs Trusted Publisher mapping prerequisite now names the new package.
  The GitHub repository, root workspace name, SPDX headers, and on-chain
  identifiers (`midnight:vc:digital-passport`, `digital-passport:v1`) are
  unchanged (change `rename-npm-package`, issue #47).

- Pinned the Compact toolchain at **0.31.1** (was 0.30.0), matching the
  `midnight-did` (#409) and `midnight-verifiable-credentials` (#432)
  migrations. The nix devshell now inherits `compact-toolchain`,
  `compact-midnight`, and the Midnight circuit parameters
  (`midnight-circuit-params`) from the `MediaNoxLabs/flake-collection` flake
  input; the `midnight-did` flake input and the vendored
  `nix/midnight-circuit-params.nix` derivation are gone.
  CI pins the same compiler version (`COMPACT_COMPILER_VERSION: 0.31.1`), and
  the `pinned-compact-compiler-version` flake check still fails loudly on
  drift. Generated managed code is unchanged (byte-identical artifacts).

### Added

- A hermetic `npm-artifacts` flake output (aliased as `default`): a flat
  directory with the `pnpm pack` tarball of every publishable workspace
  package, built offline from a lockfile-pinned fixed-output dependency
  fetch, the pinned Compact toolchain, and flake-supplied circuit parameters
  (`nix build .#npm-artifacts`). The `npm-artifacts-contents` flake check
  audits the tarballs for the distribution invariants (dist output, compact
  sources, helper scripts, no managed source maps, version consistency).
  Publishable packages are discovered at eval time from
  `packages/*/package.json`, so new packages flow in without flake edits.

### Removed

- The `align-runtime-version` post-build workaround
  (`scripts/align-runtime-version.mjs` and its invocation in the `compact`
  build script). compactc 0.31.1 natively targets `compact-runtime` 0.16.0 and
  emits the matching `checkRuntimeVersion` guard, so the generated managed
  code no longer needs any post-build rewriting.

### Fixed

- Correctness bugs in the digital-passport Compact circuits found by review:
  the derived presentation request now pins its own format version instead of
  copying the transport-envelope version; schema-reference validation now pins
  the family `minorVersion` (1.0) alongside the major version; and the
  age-over-threshold predicate now counts full calendar years (proleptic
  Gregorian, leap-day aware) instead of `threshold * 365` days, which let
  proofs pass up to ~16 days early.
- `turbo.json` declares `src/managed/**` as an output of the `typecheck` task:
  the task regenerates the managed contract code, so a cache hit after a
  `clean` restores it instead of reporting success with the generated code
  missing.
