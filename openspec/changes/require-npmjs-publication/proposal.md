# Proposal

## Why

The v0.1.0-rc4 publication was **Accepted** by npmjs (and became **Visible** about four minutes later), but the publish script's 60-second read-back timed out, the best-effort `continue-on-error` guard kept the run green, and the propagation, dist-tag, and registry-consumer checks were silently skipped (issue #17). A green run no longer means the package is on npmjs. rc4 also proves the npmjs Trusted Publishing path works, which is exactly the runbook's exit condition for the temporary GitHub-Release distribution window — so this is the single follow-up change that ends the window and makes npmjs publication mandatory and correctly verified. The convergence model follows midnight-did's post-incident fix for the same registry read-after-write lag (midnight-did#443).

## What Changes

- **BREAKING (release process)**: npmjs publication is mandatory. `continue-on-error` and every `if: steps.publish.outcome == 'success'` guard are removed; a green run means the release is **Verified** (Visible, `latest` unchanged for a non-`release` channel, registry consumer test passed). "Published" means Verified.
- **One bounded convergence gate** in `wait-for-npm-packages.mjs`: a 300-second deadline measured from acceptance, polled every 30 seconds, with bounded per-request timeouts. Only a recognised E404 counts as pending; any other command failure or malformed metadata fails closed; a non-`release` version owning `latest` fails immediately; evidence after the deadline fails. `npm publish` is never retried. The duplicate 60-second poll in `publish-npm-packages.sh` is removed — the publisher preflights and publishes only.
- **Payload-integrity read-back**: Visible requires the registry's `dist.integrity` to match the packed tarball; on mismatch the registry tarball is downloaded and its contents compared, so an idempotent rerun with a byte-different but content-identical rebuild still succeeds and a genuinely different payload fails closed.
- **Registry consumer test** resolves the exact `dist.tarball` URL and installs it with `--prefer-online` and a fresh temporary cache/store, retrying up to 3 attempts 10 seconds apart — no shared pnpm metadata cache to go stale.
- **Accurate always-run summary** distinguishing Rejected (not attempted or `npm publish` failed), Accepted-but-propagation-timed-out, Visible-but-downstream-verification-failed, and Verified, with retry guidance (versions are immutable; inspect the registry before re-dispatching; a re-dispatch of a Visible version is a no-op).
- **BREAKING (release process)**: the GitHub-Release window ends. Removed: the `tag` workflow input, operator-tag reconciliation (`verify-release-tag.mjs`), GitHub Release creation/verification/attestation (`publish-github-release.mjs`), and the release-URL consumer mode. Workflow permissions return to `contents: read` + `id-token: write`. The `snapshot` channel is available again from `develop` only.
- The security-workflow self-check flips from requiring the window shape to forbidding best-effort publication, guarded registry steps, the `tag` input, and GitHub-Release steps, and pins the registry-only permissions.
- Consumer documentation points at npmjs; the README notes rc2–rc4 tarballs stay at their existing Release URLs but no new versions are attached. Existing Releases are untouched.
- The runbook documents that `latest` currently resolves to `0.1.0-rc3` (npm assigns `latest` to a package's first-ever version) until `0.1.0` ships, and records rc4's real outcome (Accepted then Visible; not an authentication rejection) with observed timings.
- A root `CONTEXT.md` glossary fixes the release vocabulary: Channel, Dist-tag, Rejected, Accepted, Visible, Verified, Published.

Non-goals (tracked in #18): privilege-separated jobs with a digest-pinned artifact handoff, an `env -i` isolated npm sandbox, and cosign/SLSA signing.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `npm-publication`: trusted-publisher prerequisite, registry publication, dist-tag safety, and post-publication verification lose their window/best-effort clauses and become mandatory; post-publication verification gains the bounded convergence gate, payload-integrity read-back, tarball-URL consumer install, and the four-outcome run summary; a consumer install-guidance requirement points at npmjs; the runbook requirement gains the window-exit history and the `latest` exception.
- `repository-toolchain`: the publication self-check clause returns to its registry-only form (`contents: read` + `id-token: write`) and additionally forbids best-effort publication, guarded registry steps, the `tag` input, and GitHub-Release steps.
- `github-release-distribution`: removed in full — the window has exited.

## Impact

- **Workflow**: `.github/workflows/publish.yml` (inputs, permissions, steps, summary).
- **Scripts**: `tooling/scripts/publish-npm-packages.sh`, `wait-for-npm-packages.mjs`, `npm-release-state.mjs`, `test-release-package-consumers.mjs`, `release-resolve-context.sh`, `check-security-workflows.mjs`; deleted: `verify-release-tag.mjs`, `publish-github-release.mjs`; `release-tooling.test.mjs` updated with mocked-time coverage.
- **Docs**: `docs/guides/npmjs-publication.md`, `README.md`, `CHANGELOG.md`, `packages/midnight-vc-passport/CHANGELOG.md`, new `CONTEXT.md`.
- **Specs**: `npm-publication`, `repository-toolchain`, `github-release-distribution` (removed).
- **Operations**: after merge, an `rc5` dispatch from `develop` is the end-to-end validation run and must report Verified. The npmjs Trusted Publisher mapping and the `npm-release` environment are unchanged.
