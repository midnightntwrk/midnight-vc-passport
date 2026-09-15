# Tasks: npm trusted publishing

## 1. Publication workflow — exit the bridge onto trusted publishing

- [x] 1.1 In `.github/workflows/publish.yml`: add `environment: npm-release` to the publish job; narrow permissions to exactly `contents: read` + `id-token: write` (drop `attestations: write`); delete the suspended `NODE_AUTH_TOKEN` env block and its restore-instructions comment permanently.
- [x] 1.2 Remove the bridge machinery: the `tag` workflow input, the operator-tag reconciliation step, the SHA256SUMS/release-body step, the GitHub-Release create/verify step, the release-asset attestation step, and the release-URL consumer test step.
- [x] 1.3 Restore the npm path in trusted-publishing form: the npm ≥ 11.5.1 CLI gate, the dist-tag snapshot step, the publish step (no token; `--access public --tag <channel> --provenance --ignore-scripts` on the prepacked tarball), the propagation wait, the dist-tag verification (fail-closed), and the registry-mode consumer test. End the `snapshot` fail-closed bridge restriction.
- [x] 1.4 Update the workflow header comment and release summary to the trusted-publishing (post-bridge) form.

## 2. Publish tooling

- [x] 2.1 `tooling/scripts/publish-npm-packages.sh`: remove the `NODE_AUTH_TOKEN` hard-fail; add a pre-publish registry check that the exact version/tag pair is absent or already-correct (idempotent tokenless rerun); apply access and tag via the publish invocation; remove the dist-tag repair path (drift fails the run).
- [x] 2.2 `tooling/scripts/npm-release-state.mjs`: keep read-only snapshot/verify; drop any repair semantics; ensure verification tolerates the first-publication `latest` behavior exactly as specified.
- [x] 2.3 Verify the pack → contract-check → publish flow passes `--ignore-scripts`-compatible packed tarballs (no publish-time lifecycle execution).

## 3. Security self-check and tests

- [x] 3.1 `tooling/scripts/check-security-workflows.mjs`: re-pin the publication-workflow contract to the trusted-publishing shape — dispatch-only trigger, channel/branch gate, registry lock, provenance, `npm-release` environment present, zero npm token secret references, permissions exactly `contents: read` + `id-token: write`.
- [x] 3.2 `tooling/scripts/release-tooling.test.mjs`: replace `NODE_AUTH_TOKEN`-based cases with trusted-publishing cases — missing mapping fails closed, drift fails without mutation, idempotent rerun is a tokenless no-op, tag/access present on the publish invocation.
- [x] 3.3 Run the full gate (`pnpm run all`, `pnpm run smoke`) and the security self-check locally.

## 4. Documentation

- [x] 4.1 `docs/guides/npmjs-publication.md`: replace the bridge section with the trusted-publisher exit — owner-action checklist (npmjs Trusted Publisher mapping fields; `npm-release` environment with required reviewers, no self-review, branch allow-list `main`/`develop`), the prohibition on npm tokens, drift escalation (human registry authority), and the hold rule (no dispatch before attestation).
- [x] 4.2 Remove the bridge dispatch procedure and URL-install consumer guidance; point consumers at npmjs dist-tags (existing URL-pinned installs keep working against published GitHub Releases).
- [x] 4.3 Record the first-dispatch smoke procedure (snapshot channel to `develop`) as the mapping verification step.

## 5. Spec housekeeping and verification

- [x] 5.1 Update `openspec/specs/npm-publication/spec.md` and `openspec/specs/repository-toolchain/spec.md` Purposes to drop their bridge-window scoping paragraphs (direct edits; the deltas only carry requirement changes).
- [ ] 5.2 Retire `openspec/specs/github-release-distribution/` at archive time (all requirements are removed by this change's delta).
- [x] 5.3 `openspec validate npm-trusted-publishing --strict` passes; `openspec status` shows all artifacts complete.
