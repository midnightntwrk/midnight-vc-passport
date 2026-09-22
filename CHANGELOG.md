# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
  `@midnight-ntwrk/midnight-verifiable-credential-digital-passport`, ported
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
