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

> **Publication is mandatory and verified.** A green run means the version
> is **Verified**: Visible on npmjs with the packed payload and the channel's
> dist-tag, `latest` unchanged for a non-`release` channel, and a clean
> consumer installed it from the registry. "Published" means Verified and
> nothing less — the vocabulary (Rejected, Accepted, Visible, Verified) is
> defined in [`CONTEXT.md`](../../CONTEXT.md).

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
closed at the publish step (npm rejects the PUT) — the run fails as
**Rejected** and nothing reaches the registry. Configure the prerequisites and
re-dispatch.

## GitHub-Release distribution window (ended)

From v0.1.0-rc2 to v0.1.0-rc4, while the npmjs Trusted Publisher mapping was
not yet configured, every `rc`/`release` run also attached the gated tarball
to a GitHub Release on an operator-created tag and attempted the npmjs
publication best-effort. v0.1.0-rc4 proved the Trusted Publishing path (see
[v0.1.0-rc4 record](#v010-rc4-record)), which was the window's exit
condition, and the window ended with the change that made npmjs publication
mandatory:

- the `tag` input, the operator-tag reconciliation, the GitHub Release
  creation/verification/attestation steps, and the release-URL consumer test
  are gone, and the workflow permissions are back to `contents: read` +
  `id-token: write`;
- `snapshot` is available again from `develop`;
- the existing v0.1.0-rc2, v0.1.0-rc3, and v0.1.0-rc4 GitHub Releases and
  their tags are left in place (their tarball URLs keep working), but **no new
  versions are attached to GitHub Releases** — npmjs is the only
  distribution channel.

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

## Dispatch procedure

1. Confirm every pre-dispatch gate above.
2. On the **Actions** tab, choose **Publish** → **Run workflow**:
   - **Branch:** `develop` (`snapshot`, `rc`) or `main` (`rc`, `release`)
   - **Channel:** `snapshot`, `rc`, or `release`
   - **Version:** the manifest base, e.g. `0.1.0` (optional confirmation)
   - **rc_index:** e.g. `5` (rc channel only; defaults to 1)

   There is no tag input: a publication creates no git ref.
3. Approve the run when the `npm-release` environment's reviewer prompt
   arrives.
4. Watch the run. Expected sequence: context resolution → tool setup → npm
   CLI trusted-publishing check → full gate (`pnpm run all`) → smoke
   round-trip → version preparation (stamped only into the ephemeral
   checkout) → pack + contract check + tarball consumer test → SPDX SBOMs →
   dist-tag snapshot → evidence artifact upload → **publish** → **converge**
   → **dist-tags** → **registry-test** → summary.
5. Read the outcome at the top of the run summary (see below), then record
   the release in the root and package changelogs.

## Post-publication verification

Every step after `publish` runs only when the previous ones succeeded, and
nothing is best-effort. The step ids map onto the run summary's outcome:

| First failing step | Summary outcome | Meaning |
| ------------------ | --------------- | ------- |
| `publish` (or an earlier step) | **Rejected** | `npm publish` failed or the preflight refused the version, or the run stopped before publishing ("not attempted"). Nothing is claimed to exist on the registry. |
| `converge` | **Accepted, propagation timed out** | npm reported success, but the version was not Visible within the budget. It may still appear — do **not** assume the version is absent. |
| `dist-tags` or `registry-test` | **Visible, verification failed** | The version is served with the packed payload, but the dist-tag check or the clean registry install failed. |
| none | **Verified** | The only green outcome. |

What each stage checks:

- **publish** (`publish-npm-packages.sh`): preflight — for an already-present
  version, the registry payload must be the packed payload and the channel's
  dist-tag must already resolve to it (a tokenless no-op); otherwise the run
  fails before publishing. For an absent version, `npm publish` runs **once**
  and is never retried. Success means Accepted, nothing more.
- **converge** (`wait-for-npm-packages.mjs`): the single convergence gate.
  It polls the registry every **30 seconds for at most 300 seconds** (each
  read time-bounded) until the exact version is Visible: served, its
  `dist.integrity` equal to the packed tarball's (or, for a byte-different
  rebuild, its downloaded tarball content-identical), and the channel's
  dist-tag pointing at it. Only a recognised `E404`, or a valid dist-tag not
  yet pointing at the version, counts as pending; any other registry error,
  malformed metadata, a payload mismatch, or a non-`release` version owning
  `latest` fails immediately. Evidence that arrives after the deadline fails.
- **dist-tags** (`npm-release-state.mjs --verify`): the channel tag resolves
  to the version and — for `snapshot`/`rc` — `latest` is unchanged from the
  pre-publish snapshot.
- **registry-test** (`test-release-package-consumers.mjs --registry`):
  resolves the exact `dist.tarball` URL with `--prefer-online`, installs it
  in a clean project with a run-private pnpm store and cache (dependencies
  from npmjs), and runs the issuance/presentation/verification round-trip —
  up to 3 attempts, 10 seconds apart.

A Verified run already proved all of this. To spot-check by hand:

```sh
npm view @midnight-ntwrk/midnight-vc-passport dist-tags
npm view @midnight-ntwrk/midnight-vc-passport@<version> dist.integrity dist.attestations
```

Confirm the version is public, the dist-tag matches the channel, the
provenance attestation is present, and the release-evidence artifact
(tarballs, SBOMs, contract report, dist-tag snapshot) is attached to the run.
Consumers resolving `name@version` through their own package-manager
metadata may need a few more minutes after a Verified run: rc4's install
packument lagged its version metadata by about two minutes.

### The `latest` dist-tag before the first stable release

npmjs assigns `latest` to a package's **first-ever version**, whatever
dist-tag it was published under. This package's first npmjs version was
`0.1.0-rc3`, so **`latest` resolves to `0.1.0-rc3`** and stays there through
every later `rc` and `snapshot` publication (the dist-tag check requires it
to stay unchanged) until the first `release` dispatch of `0.1.0` moves it.
Do not "repair" it before then: it is the expected state, and moving it
requires registry authority the pipeline does not have.

## Retry and rollback

Before any retry: **versions are immutable** — once the registry has accepted
a version it can never be replaced — so **inspect the registry before
re-dispatching**:

```sh
npm view @midnight-ntwrk/midnight-vc-passport@<version> --json
```

A re-dispatch never republishes an existing version; it starts from a fresh
preflight.

- **Rejected:** if the registry has no such version, fix the cause (for a
  403/404 at the publish step, re-check the four Trusted Publisher mapping
  fields) and re-dispatch with the same inputs. If the version does exist
  (e.g. after a cancelled publish step), treat it as Accepted.
- **Accepted, propagation timed out:** wait a few minutes, confirm with
  `npm view` that the version and its dist-tag are served, then re-dispatch
  with the **same inputs**. Re-dispatching a Visible version is a no-op that
  completes verification (convergence, dist-tags, registry consumer test).
  Any budget change must cite recorded timings.
- **Visible, verification failed:** read the failing step. A registry
  consumer failure that clears with time can be re-dispatched with the same
  inputs (a no-op that re-runs verification); a genuine consumer or dist-tag
  problem is an incident — see below.
- **Drifted dist-tag:** the pipeline **cannot repair dist-tags** (trusted
  publishing authorizes publication only) — a drift fails the run. Escalate
  to an npm organization owner (`@midnightntwrk/mn-sre`) to repair manually:
  `npm dist-tag add @midnight-ntwrk/midnight-vc-passport@<version> <tag>`,
  then re-dispatch (which verifies the repair as a no-op). Never repair a tag
  onto a version the pipeline did not publish and verify.
- **Payload mismatch:** the registry holds a different payload under the
  version than the run packed. Do not retry; treat it as an incident.
- **A bad version is live:** within 72 hours of publication, `npm unpublish`
  the exact version (org policy permitting); otherwise deprecate it
  (`npm deprecate <name>@<version> "message"`) and cut the next rc/stable.
  Never move `latest` onto an untested version.

## v0.1.0-rc4 record

The v0.1.0-rc4 run
([run 36700635993](https://github.com/midnightntwrk/midnight-vc-passport/actions/runs/36700635993),
2026-09-30, `develop` at `cb916ad`) was the first run of this workflow whose
npmjs publication succeeded through the Trusted Publishing path (issue #17). `npm publish` was **Accepted** at about
10:10:21Z; the version and its dist-tags were seen at about 10:14:43Z (the
registry records 10:14:29Z), and the install packument caught up at about
10:16:56Z. The publish script's 60-second read-back timed out first, and the
then-best-effort guard reported the attempt as a tolerated failure — it was
**not** an authentication rejection. The version is **Visible** on npmjs
(`rc=0.1.0-rc4`, `latest=0.1.0-rc3`). These timings motivated the 300s/30s
convergence gate and the mandatory publication model.

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
