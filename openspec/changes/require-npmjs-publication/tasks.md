# Tasks

## 1. Payload identity module

- [ ] 1.1 Add `tooling/scripts/npm-package-identity.mjs` (design D4): compute a packed tarball's `sha512-` integrity, compare with a registry `dist.integrity`, and on mismatch download the registry tarball with bounded size/time and compare entries (paths, bytes, executable bit; ignore mtime/ownership). Verify with new `release-tooling.test.mjs` cases: identical integrity → match; byte-different content-identical tarballs → match; changed file content / extra file / missing file → mismatch; oversize or timed-out download → error.

## 2. Publisher: preflight and publish only

- [ ] 2.1 In `publish-npm-packages.sh`, remove `NPM_VIEW_RETRIES`/`NPM_VIEW_INTERVAL`/`view_json_until` and the post-publish poll; the script invokes `npm publish` once per absent tarball and exits (design D2). Verify with tests: a mocked accepted publish followed by an absent `npm view` exits 0 without polling; a mocked failing publish exits non-zero with exactly one publish call.
- [ ] 2.2 Make the preflight for an already-present version require payload identity (task 1.1) plus the requested dist-tag, failing before any publish on mismatch. Verify with tests: present + matching payload + matching tag → no-op, zero publish calls; present + different payload → fails, zero publish calls; present + drifted tag → fails, zero publish calls.

## 3. Single convergence gate

- [ ] 3.1 Rework `wait-for-npm-packages.mjs` per design D3: defaults `--timeout 300 --interval 30`, per-request timeout, E404-only pending, strict metadata parsing, payload identity via task 1.1, `latest`-owned-by-non-release fails immediately, late evidence fails; inject clock/sleep/view command. Verify with fake-clock tests covering: visible at 240s → success; tag lagging then converging → success; still absent at 300s → timeout failure; evidence at 301s → failure; non-E404 error → immediate failure with no sleeps; malformed JSON → immediate failure; rc owning `latest` → immediate failure; payload mismatch → immediate failure.
- [ ] 3.2 Confirm `npm-release-state.mjs --verify --protect-latest` passes for an rc when `latest` stays at a pre-existing prerelease (the `latest=0.1.0-rc3` state), and fails when `latest` moves. Verify with a test using that snapshot.

## 4. Registry consumer test

- [ ] 4.1 In `test-release-package-consumers.mjs`, make registry mode resolve `dist.tarball` with `npm view … --prefer-online`, install that URL in the clean project with a run-private pnpm `store-dir` and `cache-dir` (removed in `finally`), and retry up to 3 attempts 10s apart with injectable sleep (design D5). Verify with tests: a stale pre-seeded cache is not consulted; a first-attempt failure followed by success passes with one sleep; 3 failures fail.
- [ ] 4.2 Remove the `--release-url` mode and its tests. Verify `node tooling/scripts/test-release-package-consumers.mjs --release-url x` fails with an unknown-argument error.

## 5. Workflow and window removal

- [ ] 5.1 Rewrite `.github/workflows/publish.yml` per design D1/D6. Remove: the `tag` input, the tag reconcile step, the GitHub Release checksums/body, create, attest and release-URL steps, `fetch-depth: 0`, `continue-on-error`, and every `steps.publish.outcome` guard. Set permissions to `contents: read` + `id-token: write` at workflow and job level. Give the steps the ids `publish`, `converge`, `dist-tags` and `registry-test`. Update the header comment. Verify with `pnpm run check:security-workflows` after task 6.1.
- [ ] 5.2 Replace the summary step with the four-outcome classification (Rejected / Accepted, propagation timed out / Visible, verification failed / Verified), plus retry guidance for every non-Verified outcome. It reads step outcomes only through `env`. Verify with a test that extracts the summary script and runs it against each outcome combination, including publish `skipped` → Rejected (not attempted).
- [ ] 5.3 Delete `tooling/scripts/verify-release-tag.mjs` and `tooling/scripts/publish-github-release.mjs` and their test cases, and drop the snapshot window guard from `release-resolve-context.sh`. Verify: `pnpm run test:release-tooling` passes; `release-resolve-context.sh --channel snapshot` succeeds on `develop` and fails on `main`.

## 6. Security self-check

- [ ] 6.1 Invert the window assertions in `tooling/scripts/check-security-workflows.mjs` per design D7. It requires exactly `contents: read` + `id-token: write`, and forbids `continue-on-error`, `steps.publish.outcome` guards, `inputs.tag`, `attest-build-provenance`, and `gh release`/`publish-github-release` in `publish.yml`. Add a negative fixture test for each. Verify: `pnpm run check:security-workflows` passes on the new workflow, and each fixture fails with a named violation.

## 7. Documentation and glossary

- [ ] 7.1 Update `docs/guides/npmjs-publication.md`:
  - replace the "GitHub-Release distribution window" section with a short record of the window's end (existing Releases kept, no new versions attached);
  - rewrite dispatch, post-publication verification and retry sections around the four outcomes, the 300s/30s budget, and "inspect the registry before re-dispatching; versions are immutable; re-dispatching a Visible version is a no-op";
  - document `latest=0.1.0-rc3` until 0.1.0 ships;
  - record rc4 as Accepted then Visible (about 10:10:21Z accepted, version/tags seen by about 10:14:43Z, install packument by about 10:16:56Z), reported as tolerated because of the 60s poll and not an auth rejection.

  Verify that no remaining text instructs supplying a `tag` input or creating a release tag.
- [ ] 7.2 Update `README.md`: replace "Installing from GitHub Releases (interim)" with npm install guidance, plus one note that rc2–rc4 tarballs remain at their Release URLs and no new versions are attached. Verify that `grep -n "releases/download" README.md` hits only that note.
- [ ] 7.3 Add rc4 and the window-exit entries to `CHANGELOG.md` and `packages/midnight-vc-passport/CHANGELOG.md`. Verify the rc4 entry uses the Accepted/Visible terms.
- [ ] 7.4 Commit the root `CONTEXT.md` glossary (Channel, Dist-tag, Rejected, Accepted, Visible, Verified, Published). Check that the runbook and summary use its terms, and that none of them uses "published" for a state short of Verified.

## 8. Integration

- [ ] 8.1 Run `pnpm run all` and `openspec validate require-npmjs-publication --strict`, and verify both pass.
- [ ] 8.2 After merge to `develop`, dispatch `publish.yml` with `channel: rc`, `version: 0.1.0`, `rc_index: 5`. Verify that the run summary reports **Verified**, `rc=0.1.0-rc5`, `latest` unchanged at `0.1.0-rc3`, and that no GitHub Release was created. Record the run link in the runbook/changelog.
