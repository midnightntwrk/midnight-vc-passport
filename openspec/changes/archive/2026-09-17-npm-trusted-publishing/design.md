# Design: npm trusted publishing as the registry authentication path

## Context

The publication workflow (`.github/workflows/publish.yml`) is in the bridge state: GitHub-Release distribution with the npm path suspended (commented) pending the `MIDNIGHTCI_NPMJS_TOKEN` grant. The two sibling repositories just migrated to npm Trusted Publishing — `midnight-verifiable-credentials` PR #646 (merged, minimal) and `midnight-did` PR #478 (draft, deep job-splitting for a five-package family). This repository publishes one package, so the design follows the #646 pattern.

Key facts that shape the design:

- `publish.yml` already grants `id-token: write` (used for attestations during the bridge) — the same permission activates npm's OIDC exchange.
- The suspended steps already contain the npm ≥ 11.5.1 trusted-publishing CLI gate; the bridge was designed to exit onto this path.
- `tooling/scripts/publish-npm-packages.sh` hard-fails without `NODE_AUTH_TOKEN`, applies the dist-tag via the publish command, and *repairs* a drifted dist-tag post-publish — repair is impossible under OIDC.
- `tooling/scripts/check-security-workflows.mjs` asserts the exact bridge permission shape (`contents: write`, `id-token: write`, `attestations: write`); `release-tooling.test.mjs` encodes the token contract.
- The npmjs Trusted Publisher mapping and the `npm-release` environment configuration are **owner actions outside the repository** — code cannot create them.

## Goals / Non-Goals

**Goals**

1. Publish to npmjs with no npm token secret anywhere — OIDC identity only.
2. Exit the bridge in the same change (per the bridge's own single-change exit requirement): remove bridge steps, the `tag` input, and the bridge permission shape.
3. Keep every existing safety property: dispatch-only trigger, channel/branch gate, registry lock, stateless versioning, full in-run gate, tested-bytes-only publishing, provenance, dist-tag safety, idempotent reruns, release evidence.
4. Fail closed while the trusted-publisher mapping is absent.

**Non-Goals**

- midnight-did's job-splitting and artifact-boundary verification (build/pack/sign/publish isolation) — unnecessary for a single package; the in-run gate and pack/contract-check flow is unchanged.
- Registry administration from CI (`npm access`, dist-tag repair) — the trusted-publishing identity cannot do it, by design.
- Publishing anything other than `@midnight-ntwrk/midnight-verifiable-credential-digital-passport` (the smoke consumer stays private and unpublished).

## Decisions

### D1: Authentication — OIDC trusted publishing, no token

The publish job keeps `id-token: write`, adds `environment: npm-release`, and references **no secret**. npm ≥ 11.5.1 exchanges the GitHub OIDC token for a short-lived publish token when the npmjs-side Trusted Publisher mapping matches (org `midnightntwrk`, repo `midnight-verifiable-credential-digital-passport`, workflow `publish.yml`, environment `npm-release`). The commented `NODE_AUTH_TOKEN` env block is deleted, not restored. Consequence: the workflow filename `publish.yml` must never be renamed.

### D2: Tag and access ride on the publish command

`npm publish --access public --tag <channel-tag> --provenance --ignore-scripts` on the prepacked tarball. `--ignore-scripts` preserves the existing pack-then-publish flow (the tarball was already built and contract-checked; publish never runs lifecycle scripts). The post-publish `npm dist-tag`/`npm access` repair path is removed.

### D3: Dist-tag handling — snapshot read-only, verify fail-closed, rerun tokenless

- **Snapshot before publish**: `npm-release-state.mjs --snapshot` keeps working — dist-tag reads of a public package need no credential.
- **Verify after publish**: unchanged expectations (`latest` protected; first-publication tolerance). Drift now **fails** the run instead of being repaired; the runbook documents the escalation path (an npm organization owner repairs the tag manually).
- **Idempotent rerun**: if the exact version already exists with the requested tag, the run verifies that from the registry and succeeds without publishing (republishing an immutable version fails under OIDC). This replaces the repair-based rerun semantics.

### D4: Bridge removal in the same change

Per the bridge-exit requirement, one change removes: the tag-input and reconciliation step, GitHub-Release creation/attestation/URL-consumer-test steps, `publish-github-release.mjs` wiring, the bridge permission shape, and the snapshot fail-closed gate. Permissions return to `contents: read` + `id-token: write` (no `attestations: write` — artifact attestations were bridge-only; npm provenance uses `id-token`). The `snapshot` channel resumes.

The `npm-release` environment (required reviewers, no self-review, branch allow-list `main`/`develop`) is the human gate that replaced the bridge's operator tag — keep it even though the workflow itself no longer needs a tag input.

### D5: Hold discipline

Mirroring `midnight-did` PR #478: this change must not be merged (or, once merged, a publication must not be dispatched) until the npm owner attests the Trusted Publisher mapping and the repo owner attests the environment configuration. The runbook records the attestation checklist; a dispatch before configuration fails closed at the publish step with a message naming the missing prerequisite — acceptable, not harmful (nothing is half-published; npm rejects the PUT).

### D6: Policy and tests updated in lockstep

`check-security-workflows.mjs` asserts the new publication shape (dispatch-only, channel gate, registry lock, provenance, `npm-release` environment, no token references, permissions exactly `contents: read` + `id-token: write`). `release-tooling.test.mjs` drops the `NODE_AUTH_TOKEN` mocks and gains trusted-publishing cases: missing mapping (fail), drift (fail, no mutation), idempotent rerun (tokenless no-op). The npm CLI version gate stays as a prerequisite check in the run.

## Risks / Trade-offs

- **Owner-action dependency**: until the npm-side mapping exists, publications fail. Mitigation: the change lands as the documented bridge exit; the first dispatch after attestation is the first registry publication; the runbook carries the checklist.
- **No repair from CI**: a drifted `latest` tag needs a human with registry authority. Accepted — repair-by-CI was a token-path luxury; fail-closed is the honest behavior.
- **Rerun semantics change**: an operator who previously re-dispatched to "repair" now gets a failure + escalation instructions. Documented in the runbook.
- **Precedent risk**: `midnight-did` #478 (the deep variant) is still on hold. This design tracks the merged `midnight-vc` #646 instead, which shares our single-package shape.

## Migration Plan

1. Owners: create the npmjs Trusted Publisher mapping; configure the `npm-release` environment (required reviewers, no self-review, branch allow-list `main`/`develop`).
2. Merge this change (bridge steps removed, trusted-publishing path active, snapshot channel restored).
3. Dispatch a `snapshot` publication to `develop` as the smoke test of the mapping; then `rc`/`release` per the normal train.
4. The first successful registry publication is recorded in the runbook; the bridge is closed (GitHub Releases remain available to existing URL-pinned consumers).
