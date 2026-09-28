# Design

## Context

See `proposal.md` — Why. The npmjs release train from `add-npm-release-pipeline` is implemented but has never published: the npmjs Trusted Publisher mapping is absent, so the publish step fails closed with npm `E404`, and this repository holds zero git tags and zero GitHub Releases (the `v0.1.0-rc1` release lives on the prior repository). The pack path (`artifacts:pack` → contract check → clean-consumer tarball test) and SBOM generation are battle-tested and reused verbatim. `check-security-workflows.mjs` is CI-enforced and currently pins the npm-only publication shape (`contents: read` + `id-token: write`, no Release step); release-tooling unit tests exercise mutated copies of the workflow. The temporary bridge that previously attached tarballs to GitHub Releases was removed when trusted publishing landed; this change reintroduces that distribution in a **coexisting** form.

## Goals / Non-Goals

**Goals:**

- Distribute the gated tarball through GitHub Releases while npmjs is unconfigured, with npm attempted best-effort on every run.
- Keep one dispatch surface (`publish.yml`), one gate, one trust chain, and one human approval gate.
- Preserve every security property the self-check enforces today, re-asserted for the window shape.
- Fail closed on tag/version/commit drift before any expensive step.
- Make the window legibly temporary and removable by a single follow-up change.

**Non-Goals:**

- Implementing the removal change (explicitly out of scope; only recorded).
- Supporting the `snapshot` channel during the window (incompatible with pre-created tags).
- Any second registry target (GitHub Packages rejected).
- A `releases/latest/download` unversioned convenience URL (silent jumps; nondeterministic CI).
- Consumer-side enforcement of verification (documented, not mandated).
- Changes to the package contract, flake output, or pack/contract-check semantics.

## Decisions

### D1: Coexist inline in `publish.yml`, not suspend (bridge) or split jobs

The Release steps and the npm steps live in the same job, in that order. The npm publish step is marked `continue-on-error: true` and the downstream registry steps are guarded by `if: steps.publish.outcome == 'success'`, so a failed npm attempt leaves the job green and the Release intact. Alternatives rejected: (a) *suspend npm* (the prior bridge) — contradicts the chosen coexist behavior and discards the npm signal entirely; (b) a *separate best-effort npm job* (`needs: release`, `continue-on-error: true`) — cleaner isolation but needs artifact handoff and a second checkout/setup for a single-package repository. Because the job stays in the `npm-release` environment, the human approval gate covers both the Release creation and the npm attempt.

### D2: Tag reconciliation runs first, as its own step, sharing the version scheme module

A step immediately after `release-resolve-context.sh`, before setup and the expensive gate, reconciles the operator tag: the `tag` input must (a) exist, (b) point at `github.sha` of the dispatch ref, and (c) equal `v<resolved-full-version>` with the scheme (`<base>`, `<base>-rc<N>`) imported from a helper exported by `prepare-release-version.mjs` — never duplicated. Failing here is deliberate: failing at the version step would burn the gate first. The `snapshot` channel is rejected in `release-resolve-context.sh` with a window-specific message; the `channel` input keeps offering exactly `snapshot|rc|release`. `GITHUB_SHA`, the tag, and context outputs flow through step `env:` only (template-injection hygiene). The workflow still never creates, moves, or deletes refs.

### D3: Release creation via the `gh` CLI in `run:`, env-indirected — no third-party release action

`gh release create`/`gh release upload` run in `run:` steps with `GH_TOKEN: ${{ github.token }}` passed through the step env map (the checker forbids `${{ }}` inside `run:` but the env map is the established pattern). The `gh` CLI is preinstalled on the runner and avoids vendoring an external release action into a security-reviewed workflow. Rerun semantics mirror the npm path's idempotency: if the release already exists, the run verifies each existing asset's digest against the locally packed artifact — identical assets make the rerun a successful no-op; any drift fails closed (`--clobber` is never used blindly).

### D4: Asset pipeline order — pack → sums → contract report → create with assets → verify digests → attest → URL consumer test

The contract check emits a machine-readable report at `tooling/artifacts/contract-report.json` (per-tarball results plus the resolved version, deterministic content) without changing its exit semantics; landing inside `tooling/artifacts/` means the unchanged evidence-artifact upload picks it up. `SHA256SUMS` is generated over the tarball, SBOM, and report before the release exists; the release is created in one shot with all assets and the generated body (channel, version, versioned install URL, checksums, `sha256sum`/`gh attestation verify` one-liners, changelog link). After upload, a verification step compares the release-reported asset digests (`gh release view --json assets`) against the local digests and fails on mismatch. A pinned `actions/attest-build-provenance` step attests each uploaded asset by sha256 digest. The 90-day evidence artifact upload is unchanged.

### D5: npm is best-effort, gated on its own outcome — the Release never depends on it

The npm publish step is `continue-on-error: true`; the propagation wait, dist-tag verification, and registry-mode consumer test carry `if: steps.publish.outcome == 'success'`. The run summary states whether the npm attempt succeeded or was tolerated. This is the mechanism that makes the Release the guaranteed channel while keeping the npm path live for the day the mapping is configured.

### D6: The self-check is re-pinned unconditionally to the window shape

`assertPublishWorkflow` changes only its permission/shape assertion: every publication job must grant exactly `contents: write`, `id-token: write`, `attestations: write`, the `tag` input must exist, and the Release steps must be present. Dispatch-only, channel options, gate presence, registry lock, template-injection hygiene, SHA pinning, and checkout hygiene assertions are untouched. The release-tooling mutation tests gain mutations for the new shape (widened/narrowed permissions, a Release step interpolating `${{ }}`, an unpinned action, a removed tag-reconciliation step). Mode-detection (asserting one of two shapes) was rejected as unneeded branching while the window is the only known mode; the follow-up removal change flips the pin back.

### D7: URL-mode consumer test extends the existing multi-mode script

`test-release-package-consumers.mjs` regains `--release-url <url>` alongside its tarball and registry modes, reusing the clean-project harness, the registry-resolved dependency install, the round-trip, and the long-path workaround. The URL is constructed from the release just created, proving the real interim distribution channel end-to-end.

### D8: Documentation is generic and channel-shaped

`docs/guides/npmjs-publication.md` gains a window section: dispatch procedure (create/push tag `v<version>` on the release commit, dispatch channel), tag/`rc_index` reconciliation rules, rerun/rollback, failed round-trip and digest-mismatch handling, and the recorded exit condition. Root and package READMEs gain an "Installing from GitHub Releases (interim)" section pinning the versioned `releases/download/<tag>/<file>.tgz` URL, noting the lockfile freezes it and a direct URL dependency needs no exotic-subdependency exemption and carries no registry release-age floor, with optional verification commands. No consumer repository is named.

### D9: Spec shape — one ADDED capability and two MODIFIED capabilities

`github-release-distribution` is added as a window-scoped capability (new main spec on archive). `npm-publication` is MODIFIED rather than suspended: the trusted-publisher prerequisite and the registry-publication requirement gain the window clause (non-registry Release permitted; best-effort npm), and the dist-tag/post-publication requirements run only when the best-effort publication succeeded. Release evidence is not scoped, because its dist-tag snapshot still runs pre-publish. `repository-toolchain` MODIFIES the CI self-check requirement's publication clause to the window shape. The exit/removal change is recorded but out of scope.

## Risks / Trade-offs

- [Mutable release assets — an admin can replace a pinned URL's bytes] → Accepted; mitigated by build-provenance attestations (replacement is detectable by `gh attestation verify`), a documented residual risk in the runbook, and `v*` tag-deletion/force-push rulesets recommended as an owner action.
- [A green run with a failed npm step masks npm becoming healthy] → The outcome is reported in the run summary and the step shows as failed; a later green publish is itself the signal the window can exit.
- [Operator dispatches from a commit the tag doesn't mark] → Reconciliation fails closed within seconds, before setup or the gate, with a message naming the mismatch.
- [gh CLI version drift on the runner image] → The digest-compare and no-op paths use stable `gh release` JSON fields; acceptable for a temporary window.
- [Window quietly becomes permanent] → The exit condition is a spec requirement and a runbook section; the follow-up removal change is named and scoped.
- [URL consumer test or digest check fails after upload — a bad release is briefly public] → The run fails closed; the runbook directs the operator to delete the failed release or re-dispatch the correction.
- [Two distribution channels in one workflow confuse the release story] → The Release is explicitly interim, npm is explicitly the durable target, and both are described in one runbook.

## Migration Plan

1. Implement; offline verification: `pnpm run all` (including the updated self-check and release-tooling mutations) and `pnpm run artifacts:pack` green.
2. Dry-run reconciliation locally: create a scratch tag, exercise `verify-release-tag.mjs` against match/mismatch cases, delete the scratch tag.
3. First window dispatch (operator, after merge): create and push `v0.1.0-rc2` on the release commit, dispatch `channel=rc` with `rc_index=2` from the permitted branch; verify the prerelease assets, checksums, attestations, the URL consumer test, and the recorded npm outcome.
4. Rollback (any time): the change is additive to git history — reverting its commits restores the registry-only path verbatim; existing releases remain as inert artifacts until deleted by an admin.
5. Exit (out of scope): once the mapping is configured and a publication succeeds, a single follow-up change removes the Release steps and the `github-release-distribution` requirements and restores the scoped requirements.

## Open Questions

None blocking. The release-notes template wording and the exact `gh` JSON field selection are safely deferrable to implementation review.
