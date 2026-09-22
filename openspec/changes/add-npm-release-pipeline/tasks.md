## 1. Package manifest and package-level changelog

- [x] 1.1 Add publication metadata to `packages/midnight-verifiable-credential-digital-passport/package.json` — `publishConfig` (`access: public`, `registry: https://registry.npmjs.org/`), `repository` (git URL + `directory`), `description`, `keywords`, `homepage`, `bugs` — and verify `pnpm --filter @midnight-ntwrk/midnight-verifiable-credential-digital-passport pack --dry-run` still succeeds with the intended file list
- [x] 1.2 Create `packages/midnight-verifiable-credential-digital-passport/CHANGELOG.md` (Keep-a-Changelog format, `0.1.0` / Unreleased section mirroring the root changelog) and verify it is included in the packed tarball via `pnpm pack` + `tar -tzf`
- [x] 1.3 Update root `CHANGELOG.md` `[Unreleased]` with this change's entries and verify `grep` shows the release-pipeline entry

## 2. Release tooling port

- [x] 2.1 Port `workspace-catalog.mjs` from VC, reduced to this repo's catalog: the family package as the single `releaseStage: "supported"` entry and `packages/smoke-consumer` as a private non-packable entry; keep the exported symbols (`supportedWorkspacePaths`, `packableWorkspacePaths`, `workspaceCatalog`, `--publishable-paths`, `--packable-paths`, `--check`) and verify `node tooling/scripts/workspace-catalog.mjs --check` passes and `--publishable-paths` prints exactly the family package path
- [x] 2.2 Port `prepare-release-version.mjs` (version computation: `snapshot`/`rc`/`release`, github-output writing, base-version agreement check, `--dry-run`) and verify `node tooling/scripts/prepare-release-version.mjs --channel rc --rc-index 1 --dry-run --json` reports `0.1.0-rc1` with tag `rc` and that manifests are untouched afterward
- [x] 2.3 Port `release-resolve-context.sh` (dispatch-only enforcement, channel/branch rules, rc-index and version validation) and verify by simulating `GITHUB_*` env combinations for all pass/fail branch-gate cases in the tooling tests
- [x] 2.4 Port `pack-artifacts.sh` (pack publishable workspaces into `tooling/artifacts/npm`, tarball-count check) plus a `check-release-package-contract.mjs` adapted to this package (manifest publication metadata, `CHANGELOG.md`/`README`/`package.json` presence, expected dist/compact/scripts contents, no managed source maps) and verify `pnpm run artifacts:pack` fails on a deliberately stripped tarball in a sandboxed test and passes on the real one
- [x] 2.5 Port `test-release-package-consumers.mjs` with tarball mode wrapping the existing `smoke-consumer` round-trip, and verify `pnpm run artifacts:pack` end-to-end packs, checks, and consumer-tests the tarball
- [x] 2.6 Port `publish-npm-packages.sh` (registry/lockdown, tarball-then-version verification, `--provenance --access public --tag`, dist-tag snapshot/repair, idempotent no-op) and `npm-release-state.mjs` + `wait-for-npm-packages.mjs`, and verify the tooling tests cover tag-repair and no-op branches with a mocked registry view command
- [x] 2.7 Port `generate-release-sbom.mjs` (dependency-free SPDX from tarball contents) and verify it emits an SPDX JSON per tarball under `tooling/artifacts/sbom` for the packed artifact
- [x] 2.8 Port and extend `release-tooling.test.mjs` (node:test) covering version computation, catalog checks, resolve-context rules, publish-script contract (registry lockdown, provenance flag, no-op path) and run `pnpm run test:release-tooling` green; add `artifacts:pack` and `test:release-tooling` to root `package.json` scripts

## 3. Publish workflow

- [x] 3.1 Create `.github/workflows/publish.yml` per the design: `workflow_dispatch` inputs (`channel`, `version`, `rc_index`), `permissions: contents: read, id-token: write`, `ubuntu-24.04`, concurrency group, env (`COMPACT_COMPILER_VERSION: 0.31.1`, `NPM_REGISTRY` locked), steps: checkout (persist-credentials false) → resolve context → `setup-node-pnpm` (registry-url npmjs) → npm trusted-publishing version check → gate (`pnpm run all`, `pnpm run smoke`) → prepare version → `artifacts:pack` → SBOMs → dist-tag snapshot → upload evidence artifact (90-day retention) → publish tested tarballs → wait for propagation → verify dist-tags → registry-mode consumer test → step summary; verify `pnpm run check:security-workflows` passes with the new workflow present
- [x] 3.2 Extend `test-release-package-consumers.mjs` with `--registry <url> --version <version>` mode that runs the smoke round-trip against the published version, and verify the mode's argument validation is covered by tooling tests (live-registry exercise happens at first dispatch)
- [x] 3.3 Run the workflow YAML through the local guard and a dispatch-context dry run (`release-resolve-context.sh` simulations for rc-from-develop, release-from-main, snapshot-from-main rejection) and verify all gate rejections fail before any build step

## 4. CI and self-guard updates

- [x] 4.1 Extend `ci.yml` push triggers to `[develop, main]` and verify the workflow lints (`pnpm run check:security-workflows`) and the YAML parses (`yaml` devDependency already present)
- [x] 4.2 Wire `test:release-tooling` into the CI gate lane (after `check:vulnerability-exceptions`, before or beside `lint`) and verify the lane definition still matches the repository-toolchain contract
- [x] 4.3 Add dedicated `publish.yml` assertions to `check-security-workflows.mjs`: dispatch-only `on:`, resolve-context step present, `NPM_REGISTRY` locked to `https://registry.npmjs.org/`, job permissions exactly `contents: read` + `id-token: write`, provenance flag asserted through the publish-script contract test; verify the guard fails on a mutated copy of `publish.yml` (add push trigger, widen permissions, point registry elsewhere) and passes on the real one

## 5. Documentation and ownership

- [x] 5.1 Write `docs/guides/npmjs-publication.md` adapted from VC's runbook: ownership (ex-identus technical, mn-sre credentials/incidents, mn-security escalation), authentication and token policy (granular read/write token, bypass 2FA, scope `@midnight-ntwrk`, never in inputs/args/logs, future OIDC migration), pre-dispatch gates (secret present, CI green, catalog lists only the family package, version/changelog current), first-release dispatch (`channel=rc, version=0.1.0, rc_index=1` from `develop`), verification, retry/rollback (no-op rerun, dist-tag repair), incident response; verify every section heading from the sibling runbook is present and adapted
- [x] 5.2 Extend `CODEOWNERS` with the release surface: `/.github/workflows/publish.yml`, `/tooling/scripts/workspace-catalog.mjs`, `/tooling/scripts/prepare-release-version.mjs`, `/tooling/scripts/release-resolve-context.sh`, `/tooling/scripts/pack-artifacts.sh`, `/tooling/scripts/check-release-package-contract.mjs`, `/tooling/scripts/test-release-package-consumers.mjs`, `/tooling/scripts/publish-npm-packages.sh`, `/tooling/scripts/wait-for-npm-packages.mjs`, `/tooling/scripts/npm-release-state.mjs`, `/tooling/scripts/generate-release-sbom.mjs`, `/docs/guides/npmjs-publication.md` → `@midnight-ntwrk/ex-identus @midnight-ntwrk/mn-security @midnight-ntwrk/mn-sre`; verify the file parses and covers every new path (`git ls-files` diff)
- [x] 5.3 Add README npm install instructions for the rc line (placeholder for the live version number, finalized after first dispatch) and verify `grep -n "npm install" README.md` finds the family package

## 6. Integration verification (offline)

- [x] 6.1 Run the full offline gate: `pnpm run all` (now including release-tooling tests) and `pnpm run artifacts:pack`, and verify both are green with the catalog, contract check, and tarball consumer test exercising the real package
- [x] 6.2 Dry-run the version path end-to-end: `prepare-release-version.mjs --channel rc --rc-index 1 --dry-run --json` for `0.1.0-rc1` and `--channel snapshot --dry-run --json` (expects run/sha suffix) and verify manifests retain `0.1.0` and no git state changes (`git status --porcelain` clean)
- [x] 6.3 Confirm the change's own PR title passes the PR-title gate (type `feat`, scope `release`) and CI is green on the PR

## 7. First release (operator-manual, after merge)

- [ ] 7.1 Operator verifies `MIDNIGHTCI_NPMJS_TOKEN` is available to the repository and may create new packages in the `@midnight-ntwrk` org (runbook pre-dispatch gates)
- [ ] 7.2 Operator dispatches `channel=rc, version=0.1.0, rc_index=1` from `develop` and verifies `@midnight-ntwrk/midnight-verifiable-credential-digital-passport@0.1.0-rc1` is public on npmjs under the `rc` dist-tag with provenance; on this first-ever publication `latest` will also resolve to `0.1.0-rc1` (unavoidable npmjs behavior, tolerated by the pipeline) until the first `release` dispatch
- [ ] 7.3 Update README install instructions with the live rc version and record the release in the package and root changelogs
