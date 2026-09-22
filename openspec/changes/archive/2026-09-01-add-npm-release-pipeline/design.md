## Context

The repository publishes exactly one package (`packages/midnight-verifiable-credential-digital-passport`) and has an established sibling precedent: `midnight-verifiable-credentials` (VC) operates an npm-only release train whose scripts and workflow are proven in production, and this repository's culture is sibling-mirroring (see the "matches midnight-did" hardening comments and the `adopt-oss-hardening` change). Existing infrastructure constrains the design: the `setup-node-pnpm` composite action (Node from `.nvmrc` = 24, pnpm via Corepack, Compact via `setup-compact-action` pinned by workflow env at `0.31.1`), the `smoke-consumer` round-trip (packs the tarball, installs it in `/tmp` isolation with registry-only transitive resolution), the self-guarding `check-security-workflows.mjs`, the PR-title gate (scopes include `release`), and the pending `adopt-oss-hardening` deltas over `repository-toolchain`, which this change's deltas build on.

## Goals / Non-Goals

**Goals:**

- Port the VC publication model so its scripts can be diffed against upstream and re-synced cheaply.
- Make the pipeline fully verifiable offline (dry-run version prep, pack, contract check, tarball consumer test) so implementation lands green without touching npmjs.
- Keep `latest` safe while the pipeline is young: no automated publications, fail-closed tag verification, idempotent reruns.
- Fit the repo's existing guards: publish workflow must satisfy full-SHA pinning, `persist-credentials: false`, and the new dedicated self-check assertions.

**Non-Goals:**

- DID-model machinery (GitHub Releases, Cosign, SLSA generic generator, GHCR ZK artifacts, change-classified auto-snapshots on push) — this family ships no ZK artifacts.
- npm OIDC-only authentication (token removal is a future org-policy step; the npm-version check keeps that door open).
- Stricter consumer lanes (strict-TS, legacy-TS resolution, browser bundling) — the node round-trip remains the evidence bar.
- Branch-model changes — `main`/`develop` reconciliation and the eventual `0.1.0` promotion are the operator's call.

## Decisions

- **Copy the VC workflow/scripts, adapt minimally.** The port list: `workspace-catalog.mjs`, `release-resolve-context.sh`, `prepare-release-version.mjs`, `pack-artifacts.sh`, `check-release-package-contract.mjs`, `test-release-package-consumers.mjs`, `publish-npm-packages.sh`, `wait-for-npm-packages.mjs`, `npm-release-state.mjs`, `generate-release-sbom.mjs`, and `release-tooling.test.mjs`. Adaptations: catalog reduced to one supported row (the family package) plus the private smoke consumer as non-packable; drop VC's multi-package publication-dependency wiring, fixture-based consumer checks (replaced by the existing smoke round-trip), and `run.sh` invocation (replaced by `pnpm run all` + `pnpm run smoke`); runner pinned to `ubuntu-24.04` (matches the hardened scan lane; VC uses `ubuntu-latest`). *Alternative:* write a minimal single-package pipeline from scratch — rejected: sibling-consistency is this repo's convention and proven scripts beat new ones on the publish path.
- **Version stamping stays stateless.** `prepare-release-version.mjs` stamps the computed version into manifests in the ephemeral checkout only; nothing is committed back. The base version lives in root + package manifests and must match. *Alternative:* release-PR/changeset model with committed versions — rejected: diverges from both siblings and adds process this single-package repo doesn't need yet.
- **Reuse `setup-node-pnpm` in `publish.yml`** instead of VC's inline `pnpm/action-setup` + `actions/setup-node` pair, with `COMPACT_COMPILER_VERSION: 0.31.1` matching CI. The action already handles registry-url for npm auth and Compact pinning. Keep VC's npm trusted-publishing version check step (guards the future OIDC path).
- **Registry-mode consumer testing extends `smoke-consumer`, not VC's fixture matrix.** `test-release-package-consumers.mjs` gets `--registry <url> --version <version>` mode that runs the existing round-trip against the published version instead of a local tarball. *Alternative:* port VC's consumer fixtures (node/TS/legacy-TS/browser) — deferred as out of scope; the spec'd evidence bar is the round-trip.
- **Self-check assertions for `publish.yml`** go into `check-security-workflows.mjs` next to the existing scan/scorecard/dependency-review assertions: `workflow_dispatch`-only `on:`, the resolve-context step present, registry env locked to the npmjs URL, `--provenance` in the publish script invocation (asserted via the ported `publish-npm-packages.sh` contract test rather than YAML grepping), and job permissions limited to `contents: read` + `id-token: write`. This mirrors the guard style already shipped by `adopt-oss-hardening` slice 2.
- **Deltas compose on the pending `adopt-oss-hardening` text.** The `repository-toolchain` delta modifies "Continuous integration lanes" as it will read *after* that change archives (develop branch, self-check sentence, plus this change's additions). Archive order: `adopt-oss-hardening` first, then this change. If this change lands first, its delta already contains the full superset text and the hardening archive step must reconcile manually.
- **Package metadata** (`publishConfig`, `repository`, `description`, `keywords`, package-level `CHANGELOG.md`) is added in the same change as the contract check that enforces it (`check-release-package-contract.mjs` asserts manifest metadata and changelog presence, as VC's does), so the requirement and its enforcement ship together.
- **Runbook adapted from VC's `docs/guides/npmjs-publication.md`**: same section skeleton (ownership, authentication, release gates, first release, verification, retry/rollback, incident response), single-package branch flow, ownership per Q16 = `ex-identus` (technical) + `mn-sre` (credentials/incidents) + `mn-security` (escalation), CODEOWNERS entries to match.

## Risks / Trade-offs

- [Archive-order coupling with `adopt-oss-hardening`] → The delta text is the full superset; whichever archives second wins, and both orders converge to the same requirement. Flag in the tasks: archive `adopt-oss-hardening` first.
- [First publication needs org-side facts] (secret present, token may create new packages in `@midnight-ntwrk`) → Cannot be verified from git; the runbook's pre-dispatch gate makes the operator verify both before firing `0.1.0-rc1`, and the workflow fails before publishing if the token is absent.
- [Ported scripts rot from upstream VC drift] → Keep adaptation deltas minimal and localized (catalog contents, gate invocation) so re-syncing is a small diff; `release-tooling.test.mjs` pins the ported behavior.
- [Token-based auth is a standing secret exposure] → Same exposure as both siblings today; mitigations: secret never in inputs/args/logs (spec requirement), publish-only registry locked to npmjs, and the trusted-publishing version check keeps the OIDC migration a config change.
- [Manual-only publication means slower releases] → Accepted deliberately: no automation misfires on a young pipeline; snapshots via dispatch are one click when needed.

## Migration Plan

1. Land the change on `develop` (PR titled e.g. `feat(release): add npm publication pipeline (add-npm-release-pipeline)` — passes the title gate).
2. Offline verification in CI and locally: release-tooling tests, self-check assertions, dry-run version prep (`--dry-run`), `artifacts:pack` with contract check and tarball consumer test.
3. Operator confirms `MIDNIGHTCI_NPMJS_TOKEN` exists on the repo (runbook gate) and dispatches `channel=rc, version=0.1.0, rc_index=1` from `develop` → expect `0.1.0-rc1` under the `rc` dist-tag.
4. Verify registry outcome (runbook verification section), add README npm install instructions.
5. Later: operator merges `develop` → `main`, dispatches `channel=release, version=0.1.0` → `0.1.0` under `latest`.
6. Rollback for a bad publication is registry-side (`npm dist-tag` repair per runbook; versions are immutable) — the workflow's no-op rerun covers retry-after-success.

## Open Questions

- Exact `keywords` list for the manifest — cosmetic, decide at implementation.
