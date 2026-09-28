# npmjs publication runbook

This is the operator runbook for publishing
`@midnight-ntwrk/midnight-vc-passport` to the public
npm registry. It is adapted from the sibling
[`midnight-verifiable-credentials`](https://github.com/midnightntwrk/midnight-verifiable-credentials)
publication runbook, reduced to this repository's single publishable package.

Publication is **manual-dispatch only**: the
[`publish.yml`](../../.github/workflows/publish.yml) workflow is the single
door to the registry, and the first thing it does — before any build, pack, or
publish step — is validate the channel/branch gate
(`tooling/scripts/release-resolve-context.sh`):

| Channel   | Allowed branches      | Version scheme                          | npm dist-tag |
| --------- | --------------------- | --------------------------------------- | ------------ |
| `snapshot`| `develop` only        | `<base>-snapshot.<run>.<short-sha>`      | `snapshot`   |
| `rc`      | `develop` or `main`   | `<base>-rc<N>`                           | `rc`         |
| `release` | `main` only           | `<base>`                                 | `latest`     |

Versioning is **stateless**: the base semver (`0.1.0`) lives in the root and
package manifests (they must agree, and the workflow fails if they don't); the
workflow stamps the channel version only into its ephemeral checkout. Nothing
is committed, tagged, or pushed by a publication.

> **Authentication is npm Trusted Publishing (OIDC).** There is **no npm
> token** — no `MIDNIGHTCI_NPMJS_TOKEN`, no `NODE_AUTH_TOKEN`, nothing to
> leak or rotate. The publish job runs inside the protected `npm-release`
> GitHub environment with `id-token: write`; npm (≥ 11.5.1) exchanges the
> GitHub Actions OIDC token for a short-lived publish credential when the
> npmjs-side Trusted Publisher mapping matches. This mirrors the sibling
> repositories (`midnight-verifiable-credentials`, `midnight-did`).

> **GitHub-Release distribution window (active):** while the npmjs Trusted
> Publisher mapping is not configured, every `rc`/`release` publication also
> attaches the gated tarball to a GitHub Release — created and verified
> **before** the npmjs attempt — and the npmjs publication is attempted
> **best-effort** (a failure leaves the run green). Dispatches need an
> operator-created release tag, and `snapshot` is rejected. See
> [GitHub-Release distribution window](#github-release-distribution-window)
> for the procedure, rerun/rollback rules, and the exit condition.

## Trusted-publisher prerequisites (owner actions — once)

Two external configurations must exist **before** the first dispatch. Neither
can be created from repository code; both are attested by their owners:

1. **npmjs Trusted Publisher mapping** (npm organization owner, on
   <https://www.npmjs.com>): for the package
   `@midnight-ntwrk/midnight-vc-passport`, create a
   Trusted Publisher with exactly:

   | Field               | Value                                                       |
   | ------------------- | ----------------------------------------------------------- |
   | Organization        | `midnightntwrk`                                             |
   | Repository          | `midnight-vc-passport`                                     |
   | Workflow filename   | `publish.yml` (never rename the workflow file)              |
   | GitHub environment  | `npm-release`                                               |

   The mapping binds the package to exactly this repository + workflow +
   environment; a publish from anywhere else is rejected by npm.

   After the GitHub repository rename, npm organization owners must replace
   any trusted-publisher binding that still names the previous repository
   with `midnight-vc-passport`. GitHub URL redirects do not update the npm
   binding; merging this repository change does not change npm settings.

2. **`npm-release` GitHub environment** (repository admin, Settings →
   Environments): required reviewers (a human approves each publication run),
   self-review prevention, and a deployment branch allow-list of exactly
   `main` and `develop` — no tags, no wildcards.

Until both exist, a dispatched publication runs the full gate and then fails
closed at the publish step (npm rejects the PUT) — nothing is half-published.
This is the expected behavior; configure the prerequisites and re-dispatch.
During the [GitHub-Release distribution window](#github-release-distribution-window)
the failed npm attempt is instead tolerated (best-effort) and the run stays
green on the strength of the GitHub Release; the `npm-release` environment is
still required, because the window job runs inside it.

## GitHub-Release distribution window

**WINDOW (temporary).** The npmjs Trusted Publisher mapping is not yet
configured, so the npm publish step fails with `E404` and the package has
never reached npmjs. To ship the gated tarball anyway, the publication
workflow distributes it through a GitHub Release **alongside** the npm
attempt. npmjs remains the durable target and the only registry — the window
introduces no second registry (GitHub Packages was rejected); the GitHub
Release is an interim distribution channel. Consumers install by versioned
release URL; see the "Installing from GitHub Releases (interim)" sections of
the root and package READMEs.

### What a window run does

`NPM_REGISTRY` stays locked to `https://registry.npmjs.org/`, the job keeps
the `npm-release` environment (so one human approval covers both channels),
and the permissions are exactly `contents: write` + `id-token: write` +
`attestations: write`. The CI self-check (`pnpm run check:security-workflows`)
pins this window shape — the `tag` input, the reconciliation before any build
step, the Release steps ahead of a best-effort npm publish, and the exact
permission grant — alongside every pre-existing property (dispatch-only,
channel gate, registry lock, no token references, SHA-pinned actions,
checkout hygiene). The run:

1. resolves and gates the publication context (dispatch-only; `snapshot`
   fails closed with a window-specific message — run-number-stamped snapshot
   versions cannot be pre-tagged by an operator),
2. reconciles the operator-supplied release tag **before tool setup and the
   gate** (`tooling/scripts/verify-release-tag.mjs`),
3. checks the npm CLI trusted-publishing floor, re-runs the full repository
   gate and the smoke round-trip,
4. stamps the version statelessly, packs + contract-checks + consumer-tests
   the tarball (the contract check emits
   `tooling/artifacts/contract-report.json`), generates the SPDX SBOM, and
   snapshots the npm dist-tags (read-only),
5. uploads the 90-day release-evidence artifact,
6. writes `SHA256SUMS` over the tarball/SBOM/contract report and creates the
   release on the operator tag with every asset and a generated body
   (channel, version, install URL, checksums, verification one-liners,
   changelog link) — `rc` creates a **prerelease (never latest)**, `release`
   creates the **latest** release — then verifies every uploaded asset digest
   against the packed bytes (`tooling/scripts/publish-github-release.mjs`),
7. attests every uploaded asset (build provenance),
8. runs a clean-consumer install from the just-created release's download
   URL (dependencies resolve from the public npmjs registry),
9. attempts the npmjs publication **best-effort**: on success the
   propagation wait, dist-tag verification, and registry-mode consumer test
   run as usual; on failure they are skipped, the job stays green, and the
   run summary records `npm publication (best-effort): failed — tolerated`.

### Dispatch procedure (window)

1. Confirm every [pre-dispatch gate](#pre-dispatch-gates) (CI green on the
   dispatch branch, catalog tight, manifests and changelogs current). The
   npmjs mapping is *not* required during the window.
2. Create and push the release tag `v<version>` on the release commit — the
   exact commit you will dispatch from (the branch HEAD):

   ```sh
   git tag v0.1.0-rc2            # on the release commit
   git push origin v0.1.0-rc2
   ```

3. On the **Actions** tab, choose **Publish** → **Run workflow**:
   - **Branch:** `develop` or `main` (rc) / `main` (release)
   - **Channel:** `rc` or `release` (`snapshot` is rejected during the window)
   - **Tag:** the tag you pushed (`v0.1.0-rc2`)
   - **Version:** the manifest base (optional confirmation)
   - **rc_index:** e.g. `2` (rc channel only; defaults to 1)
4. Approve the run when the `npm-release` environment's reviewer prompt
   arrives.
5. Watch the run. Expected sequence: context resolution → tag reconciliation
   → tool setup → npm CLI check → full gate → smoke round-trip → version
   preparation → pack + contract check + tarball consumer test → SBOMs →
   dist-tag snapshot → evidence artifact → sums + body → release creation +
   digest verification → attestations → release-URL consumer test → npm
   publish (best-effort) → [registry steps, only if the publish succeeded] →
   summary.
6. Verify and record: `gh release view <tag>` shows the four assets
   (tarball, `SHA256SUMS`, SBOM, contract report) with the expected
   prerelease/latest flag; `gh attestation verify --repo
   midnightntwrk/midnight-vc-passport <asset-file>` succeeds for a downloaded
   asset; read the npm outcome in the run summary; then record the release in
   the root and package changelogs.

### Tag and `rc_index` reconciliation rules

The run fails **before any build step** unless the supplied tag:

- exists in the repository (pushed, not just local),
- points at the commit the dispatch was made from (`github.sha`), and
- equals `v<resolved-full-version>` — for `rc`, `v<base>-rc<rc_index>` with
  `rc_index` defaulting to `1`; for `release`, exactly `v<base>`. The scheme
  is shared with `prepare-release-version.mjs` (`expectedReleaseTag`).

Typical mismatches: tag `v0.1.0-rc2` with `rc_index` left at its default `1`
(fails naming the expected tag), a tag on a commit other than the dispatch
HEAD (e.g. the branch moved after tagging), or a forgotten `git push` of the
tag. The workflow itself never creates, moves, or deletes any ref, and the
manifests keep the base version after publication.

### Rerun, rollback, and failure handling

- **Rerun after a success (no-op):** re-dispatching the same channel, tag,
  version, and index succeeds as an **idempotent no-op** on the Release side
  — every existing asset digest is verified against the freshly packed
  artifacts and nothing is re-created — and the npm side follows its own
  no-op rules (see [Retry and rollback](#retry-and-rollback)).
- **Partial asset upload:** a rerun uploads only the missing assets; existing
  assets are never overwritten (`--clobber` is never used).
- **Digest mismatch (after upload, or drift on an existing release):** the
  run fails closed and names the asset. Delete the failed release
  (`gh release delete <tag> --yes`) and re-dispatch, or re-dispatch the
  corrected publication under a new tag; delete the tag itself only when it
  is wrong (`git push --delete origin <tag>`).
- **Failed release-URL consumer round-trip:** the run fails after the release
  became visible. Delete the failed release so no release whose URL-installed
  package failed the round-trip remains published, fix the cause, and
  re-dispatch.
- **npm attempt failed (tolerated):** expected while the mapping is absent;
  no action needed. A failure for any other reason (e.g. a mapping that now
  exists but mismatches) is visible as a failed step and in the summary —
  investigate per [First release](#first-release-dispatch-procedure) step 5.
- **Rollback (any time):** the window is additive to git history —
  reverting its commits restores the registry-only path verbatim; existing
  releases remain as inert artifacts until deleted by an admin.

### Integrity evidence and residual risk

Every release carries the tarball, `SHA256SUMS`, the SPDX SBOM, and the
contract report; every uploaded asset carries a build-provenance
attestation. The 90-day release-evidence artifact is retained as before.
Residual risk: a repository admin can replace a release asset's bytes at the
pinned URL — accepted for the window; attestation verification makes
replacement detectable, and `v*` tag-deletion/force-push rulesets are
recommended as an owner action.

### Window exit condition

Once the npmjs Trusted Publisher mapping is configured and an npmjs
publication through this workflow succeeds (the run summary shows
`npm publication (best-effort): published`), a **single follow-up change**
ends the window: it removes the GitHub-Release steps, the tag
reconciliation, and the `tag` workflow input; removes the `snapshot` window
guard; makes the npm publish fail-closed again (no `continue-on-error`, no
outcome guards); restores the workflow permissions to `contents: read` +
`id-token: write` and the self-check to that registry-only shape; restores
the scoped `npm-publication` and `repository-toolchain` requirements to
their unconditional form; removes the `github-release-distribution`
capability; and updates the consumer documentation — returning npmjs to the
sole distribution channel. Until that exit, the window is the documented
interim publication path; it must not silently persist as a second channel.

## Ownership

| Concern                          | Owner                        |
| -------------------------------- | ---------------------------- |
| Technical (workflow, scripts, release decisions) | `@midnightntwrk/ex-identus` |
| Dispatch and release authority   | `@midnightntwrk/ex-identus` |
| npm org administration (trusted publishers, dist-tag repair) | `@midnightntwrk/mn-sre` |
| Security escalation              | `@midnightntwrk/mn-security` |

CODEOWNERS routes the release surface (workflow, scripts, this guide) to the
teams above: changes to the publication path require their review.

## Authentication policy

- **No npm token exists or may be introduced.** The publish script refuses to
  run if `NODE_AUTH_TOKEN`/`NPM_TOKEN` is present in the environment, and the
  CI self-check (`check:security-workflows`) fails the lane if the publication
  workflow references any secret. Authentication is the GitHub OIDC exchange
  under `id-token: write` in the `npm-release` environment — the same
  permission signs the npm provenance attestation.
- **Access and dist-tag ride on the publish invocation** (`--access public
  --tag <channel> --provenance --ignore-scripts`): the trusted-publishing
  identity authorizes publication only, never registry administration
  (`npm dist-tag`, `npm access`). There is deliberately no repair path in the
  pipeline — drift fails closed and is escalated (see *Retry and rollback*).
- The registry is hard-locked to `https://registry.npmjs.org/`; checkouts
  persist no credentials — both enforced by the CI self-check.

## Pre-dispatch gates

Before dispatching any publication, verify:

1. **Trusted-publisher prerequisites attested:** the npmjs mapping and the
   `npm-release` environment exist with exactly the settings above (the
   environment's approval prompt appearing on dispatch is good evidence the
   environment half is in place).
2. **CI green** on the branch you will dispatch from (`develop` for `rc` /
   `snapshot`, `main` for `release`) — the publish run re-runs the full gate
   itself, but a red CI lane means the dispatch will waste a run and fail.
3. **Catalog is tight:** `node tooling/scripts/workspace-catalog.mjs
   --publishable-paths` prints exactly
   `packages/midnight-vc-passport`. If any other
   workspace appears, stop and fix the catalog first — private evidence
   workspaces (e.g. the smoke consumer) must never be publishable.
4. **Version and changelog current:** the root and family package manifests
   carry the same base version (`0.1.0` until the first bump), and the
   `[Unreleased]` sections of both changelogs reflect what is being released.
   A supplied `version` input must equal the manifest base — the manifests are
   the source of truth (stateless versioning).

## First release (dispatch procedure)

The first publication creates the package in the `@midnight-ntwrk` org:

1. Confirm every pre-dispatch gate above (especially the trusted-publisher
   prerequisites).
2. On the **Actions** tab, choose **Publish** → **Run workflow**:
   - **Branch:** `develop`
   - **Channel:** `rc` (a `snapshot` dispatch to `develop` is the cheaper
     smoke test of the trusted-publisher mapping before the first rc)
   - **Version:** `0.1.0`
   - **rc_index:** `1`
3. Approve the run when the `npm-release` environment's reviewer prompt
   arrives.
4. Dispatch and watch the run. Expected sequence: context resolution → tool
   setup → npm CLI trusted-publishing check → full gate (`pnpm run all`) →
   smoke round-trip → version preparation (`0.1.0-rc1`, stamped only into the
   ephemeral checkout) → pack + contract check + tarball consumer test → SPDX
   SBOMs → dist-tag snapshot → evidence artifact upload → publish with
   provenance → propagation wait → dist-tag verification → registry-mode
   consumer test → summary. Note: on the very first publication of the
   package the npmjs registry automatically sets `latest` to the published
   version even with `--tag rc` (npm behavior; see the
   `@midnight-ntwrk/credential-model` precedent). The dist-tag verification
   tolerates this for a never-before-published package; `latest` will keep
   pointing at the newest rc until the first `release` dispatch moves it to a
   stable version.
5. Any step failing means **nothing was published** unless the failure is
   after the publish step; versions are immutable, so a partial failure before
   publish is always safe to re-dispatch. A failure at the publish step with
   an npm 404/permission error means the trusted-publisher mapping does not
   match — re-check the four mapping fields (org, repo, workflow filename,
   environment).

## Post-publication verification

After a green run:

```sh
npm view @midnight-ntwrk/midnight-vc-passport --json
npm view @midnight-ntwrk/midnight-vc-passport dist-tags
npm view @midnight-ntwrk/midnight-vc-passport@0.1.0-rc1 dist.attestations
```

Confirm:

- the version is **public** on npmjs (no `private: true` masking),
- the dist-tag matches the channel (`rc` for `0.1.0-rc1`) and **`latest`
  still points at the previous stable release** — with one exception: on the
  very first publication of the package, npmjs automatically sets `latest`
  to the published version even when publishing with a non-latest dist-tag,
  so until the first `release` dispatch, `latest` legitimately points at the
  newest rc,
- the **provenance attestation** is present (published with `--provenance`),
- the release-evidence artifact (tarballs, SBOMs, dist-tag snapshot) is
  attached to the workflow run,
- a clean install works from the registry:
  `npm install @midnight-ntwrk/midnight-vc-passport@0.1.0-rc1`
  (the workflow already ran this check from the registry).

Finally, record the release: add the install instructions with the live
version to the README and move the `[Unreleased]` entries to the released
version in the package and root changelogs.

## Retry and rollback

- **Retry after a failure before publish:** re-dispatch with the same inputs.
  Nothing was published; the run starts fresh.
- **Retry after a success (tokenless no-op):** re-dispatching the same
  channel, version, and index succeeds as an **idempotent no-op** — the
  publish script verifies from the public registry that the immutable version
  exists with the requested tag and publishes nothing. This is the safe answer
  to "did it finish?".
- **Drifted dist-tag:** the pipeline **cannot repair dist-tags** (trusted
  publishing authorizes publication only) — a drift fails the run. Escalate
  to an npm organization owner (`@midnightntwrk/mn-sre`) to repair manually:
  `npm dist-tag add @midnight-ntwrk/midnight-vc-passport@<version> <tag>`,
  then re-dispatch (which verifies the repair as a no-op). Never repair a tag
  onto a version the pipeline did not publish and verify.
- **A bad version is live:** npm versions are immutable. Within 72 hours of
  publication, `npm unpublish` the exact version (org policy permitting);
  otherwise deprecate it (`npm deprecate <name>@<version> "message"`) and cut
  the next rc/stable. Never move `latest` onto an untested version.

## Incident response

1. **Suspected publishing-identity compromise:** there is no token to revoke —
   the identity *is* the trusted-publisher binding. Freeze publications by
   having the npm organization owner remove the Trusted Publisher mapping
   (and/or a repository admin delete the `npm-release` environment's
   deployment protection) and page `@midnightntwrk/mn-sre`.
2. **Audit:** list recent versions and publish times
   (`npm view <name> time --json`), cross-check against the GitHub Actions
   publication runs (each has an evidence artifact), and confirm provenance
   attestations cover every published version.
3. **Escalation:** involve `@midnightntwrk/mn-security` for anything
   confirmed malicious (unexpected versions, moved `latest`, attestation
   anomalies).
4. **Post-incident:** file the incident per org process; if the root cause is
   in this pipeline, fix it in a PR reviewed by the CODEOWNERS teams before
   re-enabling publication.
