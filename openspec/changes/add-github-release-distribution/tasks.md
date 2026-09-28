# Tasks

## 1. Tag reconciliation and version-helper tooling

- [x] 1.1 Re-export the channel-version/expected-tag scheme (`<base>`, `<base>-rc<N>`) as a reusable helper from `tooling/scripts/prepare-release-version.mjs` without changing its CLI behavior; verify `node tooling/scripts/prepare-release-version.mjs --channel rc --rc-index 2 --dry-run --json` still resolves `0.1.0-rc2` and the existing release-tooling tests stay green
- [x] 1.2 Restore `tooling/scripts/verify-release-tag.mjs` implementing the fail-closed contract (tag exists, tag commit equals the dispatch SHA, tag equals `v<resolved-full-version>` via the shared helper; inputs only through env/args, no template interpolation); verify unit tests cover missing tag, wrong commit, version mismatch, and the happy path
- [x] 1.3 Add the window guard to `tooling/scripts/release-resolve-context.sh` rejecting channel `snapshot` with a window-specific message while the `snapshot|rc|release` input options remain intact; verify simulated dispatches — `snapshot` rejected pre-build, `rc`/`release` unaffected
- [x] 1.4 Confirm `tooling/scripts/check-release-package-contract.mjs` emits the deterministic `tooling/artifacts/contract-report.json` (per-tarball results and resolved version, no timestamps) with unchanged exit semantics; verify the report is produced on pass and lands inside the `tooling/artifacts/` path the evidence-artifact upload globs

## 2. Release-URL consumer test mode

- [x] 2.1 Restore the `--release-url <url>` mode in `tooling/scripts/test-release-package-consumers.mjs`, reusing the clean-project harness, registry-resolved dependency install, round-trip, and long-path workaround; verify argument-validation tests pass and a locally HTTP-served tarball URL round-trips

## 3. Publication workflow window, docs, and ownership

- [x] 3.1 Update `.github/workflows/publish.yml` permissions (top level and job) to exactly `contents: write`, `id-token: write`, `attestations: write` and add the required `tag` workflow_dispatch input; verify the YAML parses and the channel input still offers `snapshot|rc|release`
- [x] 3.2 Add the tag-reconciliation step immediately after `release-resolve-context.sh` (env-indirected `tag` input, dispatch SHA, and context outputs; runs before setup and the gate); verify a simulated mismatch fails the run before `setup-node-pnpm` executes
- [x] 3.3 Add the release steps per design D4 — generate `SHA256SUMS` over tarball/SBOM/contract report, `gh release create` with all assets and the generated body (channel, version, install URL, checksums, verification one-liners, changelog link), prerelease-vs-latest per channel, digest verification of uploaded assets against local digests, and idempotent-rerun no-op/drift logic (no blind `--clobber`); verify `GH_TOKEN` flows only through the step env map with no `${{ }}` inside any `run:`
- [x] 3.4 Add the pinned `actions/attest-build-provenance` step attesting each uploaded asset by sha256 digest (full commit SHA ref) and the `test-release-package-consumers.mjs --release-url` step against the just-created release; verify the 90-day evidence-artifact upload still runs unchanged
- [x] 3.5 Make the npm publication best-effort per design D5 — `continue-on-error: true` on the publish step, gate the propagation wait, dist-tag verification, and registry-mode consumer test on `steps.publish.outcome == 'success'`, and record the outcome in the run summary; verify a simulated npm failure leaves the job green and the GitHub Release intact
- [x] 3.6 Add the window section to `docs/guides/npmjs-publication.md`: dispatch procedure (create/push tag `v<version>` on the release commit, dispatch channel), tag/`rc_index` reconciliation rules, rerun/rollback, failed round-trip and digest-mismatch handling, and the recorded exit condition; verify every `github-release-distribution` requirement has a corresponding runbook step and no consumer repository is named
- [x] 3.7 Add the interim "Installing from GitHub Releases" section to root `README.md` and `packages/midnight-vc-passport/README.md`: versioned URL pinning, lockfile freezing, one-line upgrade, the no-exemption-needed note for direct URL dependencies, and optional checksum/attestation verification; verify `grep -n "releases/download" README.md` finds the family tarball URL pattern and no specific consumer is referenced
- [x] 3.8 Add the restored/new scripts to the CODEOWNERS release-surface entry; verify every new path is covered by diffing `git ls-files tooling/scripts` against the entry

## 4. Security self-check and tooling tests

- [x] 4.1 Update `assertPublishWorkflow` in `tooling/scripts/check-security-workflows.mjs` to assert the window shape exactly (permissions `contents: write` + `id-token: write` + `attestations: write` per job, the `tag` input present, the release steps present) leaving every other assertion unchanged; verify `pnpm run check:security-workflows` passes on the window workflow and fails on a copy with widened or narrowed permissions
- [x] 4.2 Extend the release-tooling mutation tests: a release step interpolating `${{ }}` inside `run:`, an unpinned action ref, a missing tag-reconciliation step, and a re-enabled push trigger each fail the assertions; verify `pnpm run test:release-tooling` is green

## 5. Offline verification

- [x] 5.1 Run the full offline gate `pnpm run all` (security self-check, vulnerability exceptions, release-tooling tests, lint, typecheck, build, tests) and `pnpm run artifacts:pack`; verify both are green with the window workflow present
- [x] 5.2 Dry-run the tag path: create a scratch tag locally, exercise `verify-release-tag.mjs` against match and mismatch cases, delete the scratch tag; verify `git status --porcelain` is clean afterward and manifests retain `0.1.0`
- [x] 5.3 Confirm the change PR title passes the PR-title gate and CI is green on the working branch

## 6. First window dispatch (operator-manual, after merge)

- [ ] 6.1 Operator creates and pushes tag `v0.1.0-rc2` on the release commit and dispatches `channel=rc`, `rc_index=2`, `tag=v0.1.0-rc2` from a permitted branch; verify the run passes gate/pack/reconciliation, creates a non-latest prerelease carrying tarball + SHA256SUMS + SBOM + contract report + generated body, passes the release-URL consumer test, and records the best-effort npm outcome
- [ ] 6.2 Operator verifies `gh attestation verify` succeeds against the uploaded assets and records the window release in the root and package changelogs
