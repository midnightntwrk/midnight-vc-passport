## Context

See proposal.md — Why. The relevant environment facts: both siblings (`midnight-did`, `midnight-verifiable-credentials`) already operate the controls being adopted; the Renovate app is installed on this repository but dormant (a `renovate/configure` branch exists on origin); the repository has a single publishable package but no release pipeline (out of scope); `CODEOWNERS` routes `*` to `@midnightntwrk/mn-security`, so every hardening PR routes through security review regardless of slicing. The pnpm supply-chain settings were verified against the current lockfile: a clean `pnpm install --frozen-lockfile` under pnpm 10.34.1 with `blockExoticSubdeps`, `minimumReleaseAge: 10080`, and `trustPolicy: no-downgrade` enabled completes without policy rejections.

## Goals / Non-Goals

**Goals:**

- Make the security posture match the siblings with the smallest reviewable diffs, landing unblocked hardening first.
- Turn silently-skipped behavior (pnpm build scripts, scan findings, workflow pin drift) into declared, machine-checked policy.

**Non-Goals:**

- Release enablement of any kind (publish pipeline, SBOM, provenance, manifest hygiene).
- Authoring changes to `SECURITY.md` itself — the threat model lands as a proposal document under `docs/security/` for `@midnightntwrk/mn-security` to adopt or rewrite.
- Org-level GitHub settings (branch protection, secret scanning, default token permissions) — outside the repository.

## Decisions

**D1 — Three PR slices ordered config → workflows → docs.** Slice 1 (`pnpm-workspace.yaml`, `.npmrc`, `renovate.json`, `dependabot.yml`) touches no CODEOWNERS-hot paths beyond the default owner and lands immediately. Slice 2 (scan gating, guard scripts, CODEOWNERS) is the security-reviewed batch. Slice 3 (threat model) is pure documentation. Alternative: one PR — rejected; it couples the fastest-value changes to the slowest review.

**D2 — pnpm hardening values copied from midnight-did, not invented.** `minimumReleaseAge: 10080` (7 days), `blockExoticSubdeps: true`, `trustPolicy: no-downgrade`, exclusion lists starting empty. `.npmrc` gains `min-release-age=7` for parity with the workspace setting. Alternatives considered: a shorter floor (weaker against fresh-package supply-chain attacks; the org already accepted 7 days in a sibling), no trust policy (loses the attestation downgrade guard).

**D3 — Build-script allowance pinned explicitly.** The install test surfaced pnpm silently ignoring build scripts for `esbuild` and `unrs-resolver`. Both siblings leave this implicit; this repo declares `ignoredBuiltDependencies` for those two so the skip is reviewed policy rather than silent behavior, and any future dependency joining that list is a visible diff. (None of the three repos uses `onlyBuiltDependencies`.)

**D4 — Scanner pin `9da05ae8…` (midnight-verifiable-credentials' pin).** Upstream lineage check: midnight-did's `4bbe849` (2026-07-10) is an ancestor of `9da05ae` (2026-07-11, "caller-workspace scan fix"), so `9da05ae` is the newest fix and the one adopted. Scan becomes fail-closed (`fail_severity: "high"`) with `skip_scorecard_scan: "true"` (the dedicated scorecard lane owns that pass), `persist-credentials: false`, and `ubuntu-24.04`.

  *Implementation-time correction:* the landed pin is `e90808c…`, not `9da05ae8…`. During the implementation window the already-active Dependabot github-actions lane merged #15, bumping the action from `07dad71` to `e90808c` (2026-08-17); slice 2 (#14) kept that pin instead of downgrading to the planning-time value. Verified via the upstream compare API that `e90808c` is a direct descendant of `9da05ae` (57 commits ahead, zero behind), so it remains the newest fix and D4's intent holds; future bumps are the github-actions update lane's job.

**D5 — Fail-closed scan activated immediately, with pre-flight.** Advisory mode tends to become permanent. Before merging slice 2, the updated Scan workflow is pre-flighted via `workflow_dispatch` on the PR branch; if a latent high finding exists it is triaged then (fix forward or a governed, documented ignore via the new exception process) rather than turning main red.

**D6 — Guard script ported from midnight-verifiable-credentials, adapted for this repo's shape.** Kept verbatim: full-SHA pinning for all workflow and composite-action steps, `persist-credentials: false` on every checkout, scan/scorecard/dependency-review/dependabot structural assertions. Adapted: required branch policy is `["main"]` (this repo has no `develop`/`release/**` branches), the `publish.yml` assertion block is dropped (no publish workflow, out of scope), and the dependabot assertion checks the npm and github-actions ecosystems without a `develop` target-branch requirement. The vulnerability-exception check ports unchanged (empty ignore list passes).

  *Implementation-time correction:* the premise "this repo has no develop branch" was wrong — `origin/develop` is the active integration branch (PRs #4–#7 merged there) while the default branch `main` is still the untouched Midnight template skeleton. The three PRs therefore target `develop`. The main-only branch policy stays as the declared workflow content (matching what the workflows already declare, so the self-check passes as designed): PRs into `develop` exercise the CI lanes (verify + smoke) through `ci.yml`'s unfiltered `pull_request` trigger, and push-triggered lanes plus GitHub bot config pickup (Dependabot and Renovate read the default branch) become fully effective once `develop` is promoted to `main`. Promotion itself is out of scope (see D7 note) and is an operator action. Until it happens, the push- and schedule-triggered lanes (CI, Scan, Scorecard) remain dormant for `develop`, and the scan and dependency-review lanes — whose `pull_request` triggers filter to `main` — do not run on PRs into `develop` either (the scan lane's `workflow_dispatch` trigger remains available for manual pre-flight on any branch), nor do the dependency-update bots read the new configs (D7). This staged activation is deliberately accepted (verification-review decision): temporarily widening the triggers to `develop` was rejected because it would need reverting at promotion.

**D7 — Renovate + Dependabot both active, sibling-style.** `renovate.json` extends `local>midnightntwrk/renovate-config` with a main-only base branch; the Dependabot npm lane is re-enabled (daily, 7-day cooldown) alongside github-actions. Alternatives: Renovate only (loses the second bot's coverage the siblings keep), Dependabot only (leaves the installed Renovate dormant and forgoes org-preset grouping). Known overlap (duplicate PRs occasionally) is accepted by the org precedent.

  *Implementation-time note:* because the configs land on `develop` while `main` remains the default branch (see D6 correction), bot activation is staged: the config files land with slice 1, and both bots pick them up once `develop` is promoted to `main` (the closed PR #11 review established GitHub reads both bots' configuration from the default branch). Task 1.3's "app picks the config up" confirmation is therefore expected at promotion time, not at merge time.

**D8 — Threat model as a proposal document, not a SECURITY.md edit.** `docs/security/digital-passport-threat-model.md` is written from this package's actual source (claims set, selective disclosure, age predicate circuit, presentation-request validation, proof-server interaction, status/revocation assumptions). Promotion into `SECURITY.md` happens only on `@midnightntwrk/mn-security`'s blessing — and per the current CODEOWNERS, they review that PR either way.

## Risks / Trade-offs

- [Release-age floor can block an urgent security bump] → the exclusion list is the explicit escape hatch, and additions are visible, reviewable diffs.
- [Fail-closed scan turns main red on a latent finding] → pre-flight dispatch before merge (D5); if triage is non-trivial, a governed ignore entry is the interim path.
- [Guard script is a ported copy; siblings may evolve theirs] → the deltas are deliberate adaptations (D6), documented here; future sibling improvements are adopted consciously, not by blind sync.
- [Renovate/Dependabot overlap produces duplicate PRs] → accepted per org precedent; grouping rules in the shared preset already mitigate.
- [`ignoredBuiltDependencies` list can rot as deps change] → deviations are visible at install time (pnpm warns about newly ignored scripts), and the list is trivially reviewable.
- [CODEOWNERS dependabot guard entry is dangling (`/.github/workflows/dependabot.yml` — no such file exists), leaving the real config at `/.github/dependabot.yml` covered only by `*` today] → the fix re-points the entry in a single-line edit within the same PR; no new unowned window is created.

## Migration Plan

1. Land slice 1 (config): install hardening + update automation activate on merge; `pnpm-lock.yaml` regenerates without resolution changes.
2. Land slice 2 (workflows): pre-flight Scan via `workflow_dispatch` on the PR, then merge; the new CI checks run from the next PR onward.
3. Land slice 3 (docs): no runtime effect.

Rollback is `git revert` per slice; none of the slices carries persistent state (no published artifacts, no org settings).

## Open Questions

- Whether `@midnightntwrk/mn-security` wants the threat model promoted into `SECURITY.md`, rewritten, or kept as standalone docs — decided by them during slice 3 review; does not affect slices 1–2.
