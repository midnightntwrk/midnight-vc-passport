## Context

The npmjs release train from `add-npm-release-pipeline` is fully implemented but has never executed a publication: the `MIDNIGHTCI_NPMJS_TOKEN` secret cannot be granted (organizational dependency outside this repository's control), the package 404s on npmjs, and the repository has zero git tags and zero GitHub Releases. The pack path (`artifacts:pack` → contract check → clean-consumer tarball test) and SBOM generation are battle-tested in CI and are reused verbatim. `check-security-workflows.mjs` (CI-enforced) asserts the publication workflow's exact job permission shape `contents: read` + `id-token: write`, dispatch-only triggering, the channel gate, and the npmjs registry lock; release-tooling unit tests exercise mutated copies of the workflow. Work lands on the `release-tgz` branch. See proposal.md for motivation and scope.

## Goals / Non-Goals

**Goals:**

- Distribute the gated tarball through GitHub Releases with a defined, reversible exit back to npmjs.
- Keep one dispatch surface (`publish.yml`), one gate, one trust chain — no second workflow, no input-mode matrix.
- Preserve every security property the self-check enforces today, re-asserted for the bridge shape.
- Fail closed on tag/version/commit drift before any expensive step.

**Non-Goals:**

- Any second registry target (GitHub Packages rejected — confusion with the npmjs target).
- Supporting the `snapshot` channel during the bridge (structurally incompatible with pre-created tags).
- A `releases/latest/download` unversioned convenience URL (silent major jumps; nondeterministic CI).
- Consumer-side enforcement of verification (documented, not mandated).
- Changes to the package contract, flake output, or pack/contract-check semantics.

## Decisions

### D1: Comment out the npmjs steps inside `publish.yml`, not a mode input or a second workflow

Steps 4 (npm CLI trusted-publishing check), 10 (dist-tag snapshot), and 12–15 (publish, propagation wait, dist-tag verify, registry consumer test) are commented out under a single `# BRIDGE (temporary): …` marker block carrying restore instructions; the `NODE_AUTH_TOKEN` job env is commented with them. The bridge steps are added in place. Alternatives rejected: a `registry:` dispatch input (a mode matrix to build, test, and later delete, for a bridge that can only ever do one thing while the token is absent) and a separate `release.yml` workflow (duplicates the gate and checkout/setup scaffolding; splits the trust chain). Because the permission shape changes either way, the self-check must be updated regardless (see D5) — so the minimal-diff argument for a separate file disappears, and comments make the temporary nature legible in review.

### D2: Tag reconciliation runs first, as its own step, sharing the version scheme module

A new early step (right after `release-resolve-context.sh`, before setup and the expensive gate) reconciles the operator tag: the dispatch input `tag` must (a) exist, (b) point at `github.sha` of the dispatch ref, and (c) equal `v<resolved-full-version>` with the scheme (`<base>`, `<base>-rc<N>`) imported from a helper exported by refactoring `prepare-release-version.mjs` — never duplicated. Failing here is deliberate: failing at the version step would burn the ~20-minute gate first. The snapshot channel is rejected in `release-resolve-context.sh` with a bridge-specific message (the checker requires the `channel` input to keep offering exactly `snapshot|rc|release`, so the option stays and fails closed). `GITHUB_SHA` and outputs flow through step `env:` only (template-injection hygiene). The workflow still never creates, moves, or deletes refs.

### D3: Release creation via `gh` CLI in `run:`, env-indirected — no third-party release action

`gh release create`/`gh release upload` run in `run:` steps with `GH_TOKEN: ${{ github.token }}` passed via the step env map (the checker forbids `${{ }}` inside `run:` but the env map is the established pattern). The gh CLI is preinstalled on the runner and avoids vendoring an external release action into a security-reviewed workflow. Rerun semantics mirror the npm path's idempotency: if the release already exists, the run verifies each existing asset's digest against the locally packed artifact — identical assets make the rerun a successful no-op; any drift fails closed (`--clobber` is never used blindly).

### D4: Asset pipeline order — pack → sums → attest → create with assets → verify digests → URL consumer test

The contract check is extended to emit a machine-readable report — `tooling/artifacts/contract-report.json`, per-tarball check results plus the resolved version, deterministic content (no timestamps) — without changing its exit semantics; landing inside `tooling/artifacts/` means the unchanged evidence-artifact upload picks it up automatically. SHA256SUMS is generated over the tarball, SBOM, and that report before the release exists; the release is created in one shot with all assets and the generated body (channel, version, install URL, checksums, `sha256sum`/`gh attestation verify` one-liners, changelog link). After upload, a verification step re-downloads nothing — it compares the registry-reported asset digests (`gh release view --json assets`) against the local digests and fails on mismatch. `actions/attest-build-provenance` (pinned to a full commit SHA, as the checker requires) attests each uploaded asset with its sha256 digest. The 90-day evidence artifact upload is unchanged and still runs.

### D5: Self-check and its tests are updated to assert the bridge contract, exactly

`assertPublishWorkflow` in `check-security-workflows.mjs` changes only its permission assertion: every publication job must grant exactly `contents: write`, `id-token: write`, `attestations: write` (top level and job level). Dispatch-only, channel options, gate-presence, registry lock, template-injection hygiene, SHA pinning, and checkout hygiene assertions are untouched. The release-tooling unit tests that mutate workflow copies gain mutations for the new shape (widened/narrowed permissions, a bridge step interpolating `${{ }}`, an unpinned action) and assert failures. This is the deliberate mechanism the checker exists for — it pins the exact shape, and the bridge updates the pin.

### D6: URL-mode consumer test extends the existing multi-mode script

`test-release-package-consumers.mjs` gains `--release-url <url>` alongside its tarball and registry modes, reusing the clean-project harness, the registry-resolved dependency install, the round-trip, and the long-path workaround from tarball mode. The URL is constructed from the release just created, proving the real distribution channel end-to-end.

### D7: Consumer documentation is generic and channel-shaped

Root README and package README gain a "Installing from GitHub Releases (temporary bridge)" section: pin the versioned `releases/download/<tag>/<file>.tgz` URL in `dependencies`, the lockfile freezes it, upgrades are a one-line URL edit; note that a direct URL dependency is not an exotic *sub*dependency (no `blockExoticSubdeps` exemption) and carries no registry publish date (no `minimumReleaseAge` applicability); include the verification commands as optional. No consumer repository is named anywhere.

### D8: The npmjs suspension is a MODIFIED delta against `npm-publication` and `repository-toolchain`, not prose precedence

`add-npm-release-pipeline` is archived and `openspec/specs/npm-publication/spec.md` exists, so the suspension is expressed where it belongs: this change MODIFIES the four registry-facing `npm-publication` requirements (registry publication with provenance, dist-tag safety and idempotency, post-publication registry verification, and release evidence) to apply only while the npmjs-registry publication path is active, naming the bridge window as the suspension period. Release evidence is scoped with them because its dist-tag state snapshot is written by the suspended step 10 (`npm-release-state.mjs --snapshot`) — leaving it unconditional would contradict the suspension, since the evidence upload would succeed without the state file the requirement demands. During the bridge the evidence artifact carries the tested tarballs and SBOMs, while the SHA256SUMS, contract report, and attestations ride on the release assets. The other four `npm-publication` requirements stay in force unchanged — the bridge only strengthens their guarantees (e.g., `snapshot` fails closed on every branch). The bridge-exit change restores the four requirements to unconditional form when it removes `github-release-distribution`, so the main specs never carry contradictory unconditional claims about the same workflow. `repository-toolchain`'s `Continuous integration lanes` requirement needs the same treatment: its publication-workflow clause demands a provenance-enabled publish and least-privilege permissions, and its drift scenario requires the self-check to fail a workflow that disables provenance — exactly what the bridged workflow does — so that requirement is MODIFIED in this change to scope its publication-workflow clause to the npmjs-path-active period (the self-check asserts the bridge shape instead during the window), and the exit change restores it alongside the four `npm-publication` requirements.

## Risks / Trade-offs

- [Mutable release assets — an admin can replace a pinned URL's bytes] → Accepted (grilling Q7); mitigated by artifact attestations (replacement is detectable by `gh attestation verify`), documented residual risk in the runbook, and tag-deletion rulesets where the org permits.
- [Operator dispatches from a branch HEAD the tag doesn't mark] → Reconciliation fails closed within seconds, before setup or the gate, with a message naming the mismatch.
- [Tag/version drift (e.g. tag `v0.1.0-rc2` with `rc_index` defaulting to 1)] → Same early fail-closed; the runbook's dispatch procedure names the expected tag for each channel.
- [gh CLI version drift on the runner image] → The digest-compare and no-op paths use stable `gh release` JSON fields; acceptable for a temporary bridge.
- [Bridge quietly becomes permanent] → The exit condition is a spec requirement and a runbook section; the bridge marker block in the workflow names the restore procedure.
- [URL consumer test or digest check fails after upload — a bad release is briefly public] → The run fails closed; the runbook directs the operator to delete the failed release or re-dispatch the correction (spec'd in `Release-URL consumer verification`).
- [Commented YAML is not parser-validated] → The restore procedure is exercised by the exit change's own gate run; the self-check still validates the live bridge shape.

## Migration Plan

1. Implement on `release-tgz`; offline verification: `pnpm run all` (including the updated self-check and release-tooling mutations) and `pnpm run artifacts:pack` green.
2. Dry-run reconciliation locally: create a scratch tag, run the new step logic against it for match/mismatch cases; delete the scratch tag.
3. First bridge dispatch (operator, after merge): create and push `v0.1.0-rc1` on the release commit, dispatch `channel=rc` from the permitted branch, verify prerelease assets, checksums, attestations, and the URL consumer test in the run.
4. Rollback (any time): the bridge is additive to git history — reverting the change's commits restores the npm path verbatim; existing releases remain as inert artifacts until deleted by an admin.
5. Exit (token granted): first `release`-channel npmjs publication succeeds → single follow-up change uncomments steps 4/10/12–15, restores the scoped `npm-publication` and `repository-toolchain` requirements to unconditional form, removes bridge steps and the `github-release-distribution` requirements, updates docs.

## Open Questions

None blocking. The release-notes template wording and the exact gh JSON field selection are safely deferrable to implementation review.
