# Design

## Context

See proposal.md — Why. Today `publish.yml` is a single job. After the gate, pack, and SBOM, it creates a GitHub Release on an operator-supplied tag. It then runs `publish-npm-packages.sh` under `continue-on-error: true`. That script polls `npm view` for 60 seconds (12 × 5s) after each publish. The propagation wait (`wait-for-npm-packages.mjs`, 300s at a 10s interval), `npm-release-state.mjs --verify`, and the registry consumer test are all guarded by `if: steps.publish.outcome == 'success'`. The registry consumer test runs `pnpm add name@version` against the runner's default pnpm store and metadata cache. `check-security-workflows.mjs` currently *requires* this window shape.

midnight-did hit the same read-after-write lag (midnight-did#443, `docs/retrospectives/issue-443-npm-registry-convergence.md`). Its fix is the model here:
- one bounded 300s / 30s convergence gate after a successful publish;
- only a recognised E404 counts as pending;
- payload identity checked by integrity, falling back to a content comparison;
- `npm publish` never retried;
- a registry smoke test that installs the exact `dist.tarball` URL with `--prefer-online`, retried 3 times, 10s apart.

We publish one package, not five in dependency order, so the gate does not need to live inside the publisher.

## Goals / Non-Goals

**Goals:**
- A step's outcome maps one-to-one onto the Rejected / Accepted / Visible / Verified vocabulary (`CONTEXT.md`), so the summary is derived rather than guessed.
- All convergence tests run against injected time and mocked `npm view`, with no real sleeps.

**Non-Goals:**
- Job split, artifact-by-ID handoff, `env -i` npm sandbox, cosign/SLSA (#18).
- Deleting or editing the rc2–rc4 GitHub Releases or their tags.
- Repairing `latest=0.1.0-rc3`.

## Decisions

### D1 — Step layout encodes the outcome states

```
publish (id: publish)        ─ fail → Rejected
wait    (id: converge)       ─ fail → Accepted, propagation timed out
verify  (id: dist-tags)      ┐
consumer(id: registry-test)  ┘ fail → Visible, verification failed
all success                     → Verified
summary (if: always())       — classifies from steps.<id>.outcome
```

Every step after `publish` runs only when the previous steps succeeded, which is GitHub's default. No step has an `if:` on the publish outcome, and nothing uses `continue-on-error`. The summary step alone uses `if: always()`, reads the four outcomes through `env`, and picks the first failing stage. If `publish` never ran (the gate failed earlier), the outcome is Rejected with a "not attempted" detail.
*Alternative:* one combined script that reports its own state. Rejected because it hides the stage from the Actions UI and duplicates what the step graph already records.

### D2 — The publisher only preflights and publishes

`publish-npm-packages.sh` keeps its read-only preflight: if the version is present, it checks payload identity (D4) and that the dist-tag matches, then treats the rerun as a no-op; if anything differs it fails before publishing. It invokes `npm publish` once per absent tarball and removes `NPM_VIEW_RETRIES`, `NPM_VIEW_INTERVAL` and `view_json_until`. Exit 0 means Accepted or no-op, and nothing more.
*Alternative:* DID's in-publisher gate. That design is justified there by ordered multi-package publishes. We have one package, and a separate step is what makes D1's Accepted-but-timed-out state observable.

### D3 — `wait-for-npm-packages.mjs` is the single convergence gate

- Defaults: `--timeout 300`, `--interval 30`, plus a per-request timeout (`spawnSync` `timeout`, e.g. 30s).
- The deadline is measured from the wait step's start, which in practice is the moment of acceptance.
- Each poll reads `npm view name@version --json` for the exact version. On success the result is parsed strictly. Malformed JSON, or a missing `version`, `dist.integrity` or `dist.tarball`, fails immediately. A non-zero exit whose output matches `E404` means pending. Any other non-zero exit or a timeout fails immediately.
- When exact-version metadata is present, D4's payload identity must pass, or the gate fails immediately. Then it reads `dist-tags`: `latest === version` on a non-`release` channel fails immediately (first-publication tolerance stays in `npm-release-state.mjs`); `tags[npmTag] === version` means converged; any other valid value means pending.
- Time (`now`, `sleep`) and the view command are injectable so tests can advance a fake clock. Evidence observed after the deadline fails, matching DID's "arrived after the deadline" rule.
- Budget arithmetic: at most 300s plus about one 30s request. The job's `timeout-minutes: 60` has ample headroom beyond the gate plus about 40 minutes of build, so it stays unchanged.
*Alternative:* the issue's 15-minute budget. The user chose DID's numbers. The install-packument lag that rc4 showed (about 6.5 minutes) is handled in D5, not by a bigger budget.

### D4 — Payload identity: integrity first, then content

Compute the packed tarball's `sha512-<base64>` and compare it with the registry's `dist.integrity`. On a mismatch, download `dist.tarball` (bounded with `curl --max-time` / `--max-filesize`, or `fetch` with an AbortSignal) and compare the two archives entry by entry: the same set of paths, the same bytes per path, ignoring tar header metadata (mtime, uid/gid, mode normalisation). Implement this in one shared module (e.g. `tooling/scripts/npm-package-identity.mjs`, modelled on midnight-did's `verify-npm-package-identity.mjs`) used by both the publisher preflight and the wait gate.
*Alternative:* integrity only. Rejected because reproducible packing is unproven, and a rerun after a timeout would fail closed when it should be a no-op.

### D5 — Registry consumer installs the exact tarball URL

`test-release-package-consumers.mjs --registry`:
1. resolves the URL with `npm view name@version dist.tarball --registry … --prefer-online`;
2. in the clean project, runs `pnpm add <tarball-url> <network-id-pkg>`, with the project's `.npmrc`/env pointing `store-dir` and `cache-dir` at run-private temp directories and `--prefer-offline=false`;
3. retries up to 3 attempts, 10s apart (injectable sleep);
4. removes the temp store/cache in `finally`.

Dependencies still resolve by name from npmjs, and the release-age policy mirrors what's already there. This removes the release-URL mode.
*Alternative:* keep `name@version` with a longer retry. Rejected in grilling (Q7), because the wait gate already proves name/version resolution.

### D6 — Remove the window

- Delete `verify-release-tag.mjs`, `publish-github-release.mjs` and their tests.
- Remove from `publish.yml`: the `tag` input, the reconcile step, the checksums/body, create, attest and release-URL steps, `fetch-depth: 0` (it only served tag resolution), and the `contents: write` / `attestations: write` permissions.
- Remove the snapshot window guard in `release-resolve-context.sh`. The `snapshot:develop` case remains.
- The release-evidence artifact upload stays. `SHA256SUMS` generation moves out with `publish-github-release.mjs` unless the evidence artifact needs it; the spec's evidence requirement doesn't require it.

### D7 — The self-check inverts its window assertions

`check-security-workflows.mjs`:
- asserts permissions are exactly `{contents: read, id-token: write}` at workflow and job level;
- asserts no step in `publish.yml` has `continue-on-error`;
- asserts no step after `publish` has an `if:` referencing `steps.publish.outcome`;
- asserts no `inputs.tag`, and no step uses `actions/attest-build-provenance` or calls `gh release` / `publish-github-release`.

Each new assertion gets a negative fixture in `release-tooling.test.mjs`.

## Risks / Trade-offs

- [The install packument lags beyond the gate, so real `name@version` installs briefly fail for consumers while the run is green] → Accepted in Q7. The runbook notes that consumers may need a few minutes after a Verified run.
- [300s is exceeded on a slow day (rc4's tags were about 4m20s)] → The run fails as Accepted-but-timed-out. A re-dispatch is a safe no-op that re-verifies. Any budget change should cite recorded timings (DID's rule).
- [The content comparison accepts a tarball whose metadata differs, e.g. file modes] → Compare the normalised executable bit alongside bytes; ignore only mtime and ownership.
- [The E404 regex misclassifies a new npm error format] → Unknown output fails closed rather than polling. That's the safe direction, and tests pin the recognised shapes.
- [Removing `fetch-depth: 0` breaks something that relied on tags] → Grep for `git describe` / tag use during implementation; keep the default shallow clone only if nothing does.

## Migration Plan

1. Merge to `develop`. CI enforces the new self-check.
2. Dispatch `rc` with `rc_index: 5` from `develop` (no `tag` input). It must report **Verified**, with `latest` still `0.1.0-rc3`.
3. Record the rc5 run link and outcome in the changelog/runbook, then archive this change.

Rollback: revert the merge commit. The window workflow comes back unchanged, and no registry or ref state depends on this change.
