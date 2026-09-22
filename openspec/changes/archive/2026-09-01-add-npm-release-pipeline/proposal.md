## Why

The package `@midnight-ntwrk/midnight-verifiable-credential-digital-passport` is designed for registry consumption (the README promises "consumers install it as a normal npm package"), but it has never been published: the registry returns 404 for the name, and the repository has no publication pipeline, scripts, or runbook. Both sibling repositories (`midnight-verifiable-credentials`, `midnight-did`) already operate a proven npmjs release train; the `adopt-oss-hardening` change explicitly deferred release enablement as its follow-up, and this change is that follow-up.

## What Changes

Delivers the `midnight-verifiable-credentials` (VC) publication model, npm-only, adapted to this single-package repository:

- **New `.github/workflows/publish.yml`** — `workflow_dispatch` with `channel` (`snapshot` / `rc` / `release`), `version`, and `rc_index` inputs; resolves publication context with sibling branch rules (`snapshot` only from `develop`, `rc` from `develop` or `main`, `release` only from `main`); re-runs the full repository gate (`pnpm run all` + consumer smoke) in-workflow; stamps the release version statelessly (never commits back); packs and contract-checks tarballs; runs clean-consumer tests from the tarballs **and** after publication from the registry; generates SPDX SBOMs; publishes with `npm publish --provenance --access public`; waits for registry propagation and verifies dist-tags; uploads release evidence as a 90-day workflow artifact.
- **Ported release tooling** under `tooling/scripts/` (adapted from VC): `workspace-catalog.mjs` (full catalog shape, single row, `releaseStage: "supported"`), `release-resolve-context.sh`, `prepare-release-version.mjs`, `pack-artifacts.sh`, `check-release-package-contract.mjs`, `test-release-package-consumers.mjs` (tarball mode + registry mode reusing the existing consumer round-trip), `publish-npm-packages.sh`, `wait-for-npm-packages.mjs`, `npm-release-state.mjs`, `generate-release-sbom.mjs`, plus `release-tooling.test.mjs` wired into CI. New root scripts: `artifacts:pack`, `test:release-tooling`.
- **Stateless versioning** — base semver (`0.1.0`) stays in the root and package manifests (they must match); the workflow stamps `0.1.0-snapshot.<run>.<sha>` (tag `snapshot`), `0.1.0-rc<N>` (tag `rc`), or the base version (tag `latest`) into its ephemeral checkout only. Idempotent reruns are no-ops; `latest` is snapshotted before publish and verified after, failing closed on drift.
- **Authentication** — org `MIDNIGHTCI_NPMJS_TOKEN` secret (sibling path), `id-token: write` for npm provenance, npm trusted-publishing version check (npm ≥ 11.5.1). The first publication creates the package in the `@midnight-ntwrk` org.
- **Manifest hygiene** for the publishable package: `publishConfig` (`access: public`, npmjs registry), `repository` (with `directory`), `description`, `keywords`, `homepage`/`bugs`, and a package-level `CHANGELOG.md`.
- **CI extended to `develop`** — `ci.yml` push triggers become `[develop, main]` so rc-candidate branches have pre-dispatch signal.
- **Self-guard extension** — `check-security-workflows.mjs` gains dedicated `publish.yml` assertions: dispatch-only trigger, branch/channel gate present, registry locked to `https://registry.npmjs.org/`, provenance enabled, least-privilege permissions.
- **Runbook** — `docs/guides/npmjs-publication.md` (ownership, authentication/token policy, pre-dispatch gates, first-release dispatch, verification, retry/rollback, incident response), ported from VC and adapted to this repository.
- **CODEOWNERS** — the release surface (`publish.yml`, release scripts, publication guide) routes to `@midnight-ntwrk/ex-identus @midnight-ntwrk/mn-security @midnight-ntwrk/mn-sre`.
- **First release (manual, operator-owned)** — after merge, the repository operator verifies `MIDNIGHTCI_NPMJS_TOKEN` is available and dispatches `0.1.0-rc1` (channel `rc`, version `0.1.0`, `rc_index: 1`) from `develop`; the stable `0.1.0` follows from `main` once the operator merges `develop` → `main` (out of scope here).

Out of scope: GitHub Releases, Cosign signing, SLSA generic provenance, GHCR artifacts (no ZK artifacts exist in this family), a standalone post-release smoke workflow, npm OIDC-only trusted publishing (token removal is a future org-policy step), stricter TS/browser consumer lanes (node round-trip only, matching the existing `smoke-consumer` evidence bar), the nix `npm-artifacts` output (unchanged, continues shipping source-packed base-version tarballs), and branch-model changes (`main` ↔ `develop` reconciliation is the operator's call).

## Capabilities

### New Capabilities

- `npm-publication`: The npmjs release train — channel/branch rules, stateless version stamping, the publish workflow contract (gate, pack, consumer verification, provenance, SBOM evidence, dist-tag safety, registry verification), the release tooling catalog, and the publication runbook.

### Modified Capabilities

- `repository-toolchain`: The continuous-integration contract is modified — the CI lane runs on pushes to `develop` as well as `main`, and the security self-check gains machine-enforced assertions over the publication workflow's shape (dispatch-only trigger, branch/channel gate, pinned npmjs registry, provenance, least-privilege permissions) alongside the existing full-SHA pinning and checkout-hygiene rules.
- `package-distribution`: A new requirement — publication metadata — the publishable manifest SHALL carry `publishConfig` (public access, npmjs registry), `repository` (with directory), `description`, `keywords`, `homepage`/`bugs`, and the package SHALL include a `CHANGELOG.md` in its tarball; existing requirements (identity, export surface, registry-clean dependencies, tarball completeness, consumer evidence) are unchanged.

## Impact

- **Workflows**: new `.github/workflows/publish.yml`; `ci.yml` trigger extension. All must satisfy the self-guard (full-SHA action pins, `persist-credentials: false`); `publish.yml` additionally satisfies the new dedicated assertions.
- **Tooling**: ~11 new scripts under `tooling/scripts/` plus `release-tooling.test.mjs` wired into the CI gate; root `package.json` gains `artifacts:pack` and `test:release-tooling`.
- **Package manifest**: `packages/midnight-verifiable-credential-digital-passport/package.json` gains metadata fields only — no dependency, exports, or build changes.
- **Secrets**: requires `MIDNIGHTCI_NPMJS_TOKEN` on this repository (operator verification before first dispatch); no other credentials.
- **Docs**: new `docs/guides/npmjs-publication.md`; README gains npm install instructions once a version is live; package-level `CHANGELOG.md` added.
- **CODEOWNERS**: new entries for the release surface.
- **No impact**: on-chain identifiers, contract sources, build outputs, the nix flake `npm-artifacts` output, and the smoke-consumer round-trip (reused, not replaced).
