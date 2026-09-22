## 1. Tag reconciliation and contract-report tooling

- [x] 1.1 Refactor `tooling/scripts/prepare-release-version.mjs` to export its channel-version scheme (`<base>`, `<base>-rc<N>`, snapshot suffix) as a reusable helper without changing its CLI behavior; verify `node tooling/scripts/prepare-release-version.mjs --channel rc --rc-index 1 --dry-run --json` still resolves `0.1.0-rc1` and the existing release-tooling tests stay green
- [x] 1.2 Create `tooling/scripts/verify-release-tag.mjs` implementing the fail-closed contract (tag exists, tag commit equals the dispatch SHA, tag equals `v<resolved-full-version>` via the shared helper; inputs only through env/args, no template interpolation); verify unit tests cover missing tag, wrong commit, version mismatch, and the happy path
- [x] 1.3 Add the bridge guard to `tooling/scripts/release-resolve-context.sh` rejecting channel `snapshot` with a bridge-specific message while the checker-required `snapshot|rc|release` input options stay intact; verify simulated dispatches: `snapshot` rejected pre-build, `rc`/`release` unaffected
- [x] 1.4 Extend `tooling/scripts/check-release-package-contract.mjs` to emit a machine-readable report at `tooling/artifacts/contract-report.json` (per-tarball check results and resolved version; deterministic content, no timestamps) without changing its exit semantics; verify release-tooling unit tests cover report emission on pass and failure, and that the file lands inside the `tooling/artifacts/` path the evidence-artifact upload globs

## 2. Release-URL consumer test mode

- [x] 2.1 Extend `tooling/scripts/test-release-package-consumers.mjs` with `--release-url <url>` mode reusing the clean-project harness, registry-resolved dependency install, round-trip, and long-path workaround; verify argument-validation unit tests pass and a local HTTP-served tarball URL exercised by the tooling tests round-trips

## 3. Publication workflow bridge

- [x] 3.1 Update `.github/workflows/publish.yml` permissions (top level and job) to exactly `contents: write`, `id-token: write`, `attestations: write`; add the `tag` workflow_dispatch input; verify the YAML parses and the dispatch inputs still offer `channel: snapshot|rc|release`
- [x] 3.2 Comment out steps 4 (npm CLI trusted-publishing check), 10 (dist-tag snapshot), and 12–15 (npm publish, propagation wait, dist-tag verify, registry consumer test) plus the inert `NODE_AUTH_TOKEN` job env, under a `BRIDGE (temporary)` marker block with restore instructions; verify `NPM_REGISTRY` stays locked to `https://registry.npmjs.org/` and the channel gate still runs first
- [x] 3.3 Add the tag-reconciliation step immediately after `release-resolve-context.sh` (env-indirected `tag` input, dispatch SHA, and context outputs; runs before setup and the gate); verify a simulated mismatch fails the run before `setup-node-pnpm` executes
- [x] 3.4 Add the release steps per design D4: generate SHA256SUMS over tarball/SBOM/contract report (the `tooling/artifacts/contract-report.json` emitted by task 1.4), `gh release create` with all assets and the generated body (channel, version, install URL, checksums, verification one-liners, changelog link), prerelease-vs-latest per channel, digest verification of uploaded assets against local digests, and the idempotent-rerun no-op/drift logic (no blind `--clobber`); verify `GH_TOKEN` flows only through the step env map with no `${{ }}` inside any `run:`
- [x] 3.5 Add the pinned `actions/attest-build-provenance` step attesting each uploaded asset by sha256 digest (full commit SHA ref) and the `test-release-package-consumers.mjs --release-url` step against the just-created release; verify the 90-day evidence artifact upload still runs unchanged

## 4. Security self-check and tooling tests

- [x] 4.1 Update `assertPublishWorkflow` in `tooling/scripts/check-security-workflows.mjs` to assert the bridge permission shape exactly (`contents: write` + `id-token: write` + `attestations: write` per job) leaving every other assertion byte-identical; verify `pnpm run check:security-workflows` passes on the bridged workflow and fails on a copy with widened or narrowed permissions
- [x] 4.2 Extend the release-tooling mutation tests: bridge step interpolating `${{ }}` inside `run:`, unpinned action ref, missing tag-reconciliation step, and re-enabled push trigger each fail the assertions; verify `pnpm run test:release-tooling` is green

## 5. Documentation and ownership

- [x] 5.1 Add the bridge section to `docs/guides/npmjs-publication.md`: bridge dispatch procedure (create/push tag `v<version>` on the release commit, dispatch channel), tag/`rc_index` reconciliation rules, rerun/rollback, failed round-trip and digest-mismatch handling (the operator deletes the failed release or re-dispatches the correction), and the exit condition (first successful `release`-channel npmjs publication → single restore change that also returns the scoped `npm-publication` and `repository-toolchain` requirements to unconditional form); verify every bridge requirement has a corresponding runbook step and no consumer repository is named
- [x] 5.2 Add the generic "Installing from GitHub Releases (temporary bridge)" section to root `README.md` and `packages/midnight-verifiable-credential-digital-passport/README.md`: versioned URL pinning, lockfile freezing, one-line upgrade, no-exemption-needed note for direct URL deps, optional checksum/attestation verification commands; verify `grep -n "releases/download" README.md` finds the family tarball URL pattern and no specific consumer is referenced
- [x] 5.3 Add `tooling/scripts/verify-release-tag.mjs` (and any new release scripts) to the CODEOWNERS release-surface entry; verify the file parses and covers every new path via `git ls-files` diff

## 6. Offline verification

- [x] 6.1 Run the full offline gate `pnpm run all` (security self-check, vulnerability exceptions, release-tooling tests, lint, typecheck, build, tests) and `pnpm run artifacts:pack`; verify both are green with the bridged workflow present
- [x] 6.2 Dry-run the tag path: create a scratch tag locally, exercise `verify-release-tag.mjs` against match and mismatch cases, delete the scratch tag; verify `git status --porcelain` is clean afterward and manifests retain `0.1.0`
- [x] 6.3 Confirm the change PR title passes the PR-title gate and CI is green on the `release-tgz` branch

## 7. First bridge dispatch (operator-manual, after merge)

- [x] 7.1 Operator creates and pushes tag `v0.1.0-rc1` on the release commit and dispatches `channel=rc` with the tag input from the permitted branch; verify the run passes gate/pack/reconciliation, creates a non-latest prerelease carrying tarball + SHA256SUMS + SBOM + contract report + generated body, and the release-URL consumer test passes
- [x] 7.2 Operator verifies `gh attestation verify` succeeds against the uploaded assets and records the bridge release in the root and package changelogs
