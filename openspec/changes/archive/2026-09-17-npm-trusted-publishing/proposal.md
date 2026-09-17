# npm trusted publishing (OIDC) as the registry authentication path

## Why

The publication workflow is stuck in the temporary GitHub-Release bridge because the `MIDNIGHTCI_NPMJS_TOKEN` organization secret has never been granted to this repository. The sibling repositories (`midnight-did` PR #478, `midnight-verifiable-credentials` PR #646) have just migrated their npm publishing to **npm Trusted Publishing via GitHub Actions OIDC**, which requires **no npm token at all** — dissolving the exact dependency the bridge is waiting on, rather than waiting for an SRE grant that sibling experience shows was failing with E404/permission errors anyway. The existing `npm-publication` spec already anticipates this move ("the authentication path can later move to npm OIDC without workflow changes").

## What Changes

- **Authentication**: replace the planned org-automation-token path (`NODE_AUTH_TOKEN` from `MIDNIGHTCI_NPMJS_TOKEN`) with npm Trusted Publishing — OIDC identity from `id-token: write` (already granted for attestations) plus a protected `npm-release` GitHub environment. No npm token secret is referenced anywhere.
- **Bridge exit**: the documented bridge-exit procedure changes from "uncomment the suspended steps and the `NODE_AUTH_TOKEN` env" to a trusted-publishing exit; the suspended token env block is deleted instead of restored. The `snapshot` channel's bridge-time fail-closed restriction ends (trusted publishing needs no pre-known tag).
- **Dist-tag semantics**: access and dist-tag ride on the `npm publish` invocation itself (`--access public --tag <channel> --provenance`); post-publish `npm dist-tag`/`npm access` mutations are not supported under OIDC, so the current drift-repair behavior becomes fail-closed verification. Same-version reruns remain idempotent no-ops (tokenless verification that the existing version and tag already match).
- **Publication job hardening**: the publish job gains `environment: npm-release`; the environment must be configured (owner action) with required reviewers, self-review prevention, and a branch allow-list of exactly `main` and `develop`.
- **Tooling and policy**: `publish-npm-packages.sh` drops its `NODE_AUTH_TOKEN` hard-fail and gains a trusted-publishing mode; `npm-release-state.mjs`, `check-security-workflows.mjs`, and `release-tooling.test.mjs` (which encode the token contract and the bridge permission shape) are updated to the new contract.
- **Runbook**: `docs/guides/npmjs-publication.md` documents the trusted-publisher configuration and the new bridge-exit procedure.
- **External prerequisite (not code)**: npm organization owners must create a Trusted Publisher mapping on npmjs.com for `@midnight-ntwrk/midnight-verifiable-credential-digital-passport` — organization `midnightntwrk`, repository `midnight-verifiable-credential-digital-passport`, workflow filename `publish.yml`, environment `npm-release` — mirroring the sibling repositories' mappings.

Not in scope: midnight-did's deeper job-splitting (build/pack/sign/publish isolation across jobs with artifact-boundary verification) — that exists for a five-package family; this repository publishes one package and follows the minimal `midnight-verifiable-credentials` #646 pattern instead.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `npm-publication`: the token-authenticated "Registry publication with provenance" requirement is replaced by "Registry publication with trusted publishing" (OIDC through the `npm-release` environment, no token, tag/access at publish time); "Dist-tag safety and idempotency" changes drift handling from post-publish repair to fail-closed verification with tokenless idempotent reruns; the bridge-scoped "Release evidence" requirement is replaced by an unconditional "Release evidence and retention"; "Publication runbook" changes token policy to trusted-publisher prerequisites; a new "Trusted-publisher configuration prerequisite" requirement makes the workflow fail closed until owners configure the npmjs mapping and protected environment.
- `github-release-distribution`: the bridge ends — all eight requirements are removed (Reason/Migration recorded) as the bridge's own exit condition prescribes; the exit trigger is the trusted-publisher configuration instead of the never-granted npm token.
- `repository-toolchain`: the CI-lane requirement is replaced by "Continuous integration and publication self-check lanes", restoring the unconditional publication-workflow self-check in the trusted-publishing shape (dispatch-only, channel gate, registry lock, provenance, `npm-release` environment, zero token references, `contents: read` + `id-token: write`) — the bridge shape now fails the check.

## Impact

- `.github/workflows/publish.yml` — restore the npm path under trusted publishing; delete the suspended token env block; add `environment: npm-release`; end the bridge steps and the `tag` input (per the existing restore procedure, adapted).
- `tooling/scripts/publish-npm-packages.sh`, `tooling/scripts/npm-release-state.mjs` — trusted-publishing mode, tag-at-publish, fail-closed drift, tokenless idempotent rerun.
- `tooling/scripts/check-security-workflows.mjs`, `tooling/scripts/release-tooling.test.mjs` — permission-shape and auth-contract assertions updated to the post-bridge, no-token form.
- `docs/guides/npmjs-publication.md` — bridge section replaced by the trusted-publishing exit; npm owner action documented.
- `openspec/specs/npm-publication/spec.md` Purpose and `openspec/specs/repository-toolchain/spec.md` Purpose — bridge-window scoping paragraphs removed (direct edits; deltas carry only requirement changes).
- Blocked-on-owner: npmjs Trusted Publisher mapping and the `npm-release` GitHub environment configuration; until those exist, dispatching a registry publication will fail (fail-closed, as designed).
