## 1. Slice 1 — Supply-chain hardened installation (PR 1)

- [x] 1.1 Add install hardening to `pnpm-workspace.yaml`: `blockExoticSubdeps: true`, `minimumReleaseAge: 10080`, `trustPolicy: no-downgrade`, empty `minimumReleaseAgeExclude`/`trustPolicyExclude` lists, and `ignoredBuiltDependencies: [esbuild, unrs-resolver]`; verify with a clean `pnpm install --frozen-lockfile` (must succeed with no policy rejections)
- [x] 1.2 Add `min-release-age=7` to `.npmrc` and confirm a fresh install still resolves the full workspace
- [x] 1.3 Create `renovate.json` extending `local>midnightntwrk/renovate-config` with `baseBranchPatterns: ["main"]`; verify the schema against the Renovate docs and confirm the app picks the config up on the next run of the `renovate/configure` flow
- [x] 1.4 Re-enable the `npm` ecosystem lane in `.github/dependabot.yml` (daily, `cooldown.default-days: 7`, target `main`) next to the existing `github-actions` lane; verify with `openspec`-independent YAML lint or `actionlint`/equivalent if available, else by inspection against sibling configs
- [x] 1.5 Open PR 1 and confirm CI passes end to end

## 2. Slice 2 — Gating scan and self-guarding workflows (PR 2)

- [x] 2.1 Update `.github/workflows/scan.yaml`: pin `midnightntwrk/upload-sarif-github-action` to `9da05ae8b0dc1b97a0a25f809deb586c06b7ad3e`, add `fail_severity: "high"` and `skip_scorecard_scan: "true"` to the scan step, `persist-credentials: false` on checkout, and `runs-on: ubuntu-24.04`
- [x] 2.2 Port `tooling/scripts/check-security-workflows.mjs` from `midnight-verifiable-credentials` with the adaptations from design D6 (`requiredBranches: ["main"]`, no `publish.yml` block, dependabot assertion without develop target-branch); verify it passes on the current tree and fails when fed a deliberately unpinned workflow in a scratch copy
- [x] 2.3 Port `tooling/scripts/check-vulnerability-exceptions.mjs`, create the empty `osv-scanner.toml` and the `docs/security/vulnerability-exceptions.md` scaffold; verify the check passes with an empty ignore list and fails when a fake undocumented `IgnoredVulns` entry is added to a scratch copy
- [x] 2.4 Add the `yaml` devDependency to the root `package.json`, wire `check:security-workflows` and `check:vulnerability-exceptions` into the CI `verify` lane (either via `pnpm run all` root script or a direct step in `ci.yml`, following the repo's turbo/task conventions), and regenerate the lockfile
- [x] 2.5 Update `CODEOWNERS`: add `/.github/workflows/scorecard.yml` and `/.github/workflows/dependency-review.yml` to the mn-security/mn-sre guard list, and fix the CODEOWNERS dependabot entry to point at the actual config location (`/.github/workflows/dependabot.yml` → `/.github/dependabot.yml`); verify each guarded path resolves to a real file
- [x] 2.6 Pin tidy-up rider: normalize mixed `actions/checkout` v5/v7 pins and outdated `setup-node`/`upload-sarif` pins across `ci.yml`, `scorecard.yml`, `dependency-review.yml` to current sibling-pinned SHAs
- [x] 2.7 Add the OpenSSF Scorecard badge to `README.md` (repo slug `midnightntwrk/midnight-verifiable-credential-digital-passport`)
- [x] 2.8 Open PR 2, pre-flight the updated Scan workflow via `workflow_dispatch` on the PR branch, triage any high finding (fix forward or a documented governed ignore), and confirm CI passes end to end

## 3. Slice 3 — Threat model proposal (PR 3)

- [x] 3.1 Write `docs/security/digital-passport-threat-model.md` from the actual package source: claims set and privacy, selective-disclosure boundaries, age-over-threshold predicate circuit, presentation-request validation, proof-server trust, status/revocation assumptions; verify every named boundary corresponds to code that exists in `packages/midnight-verifiable-credential-digital-passport/`
- [x] 3.2 Open PR 3 flagged for `@midnightntwrk/mn-security` review, explicitly noting that promotion into `SECURITY.md` is their decision (design D8)

## 4. Change hygiene

- [x] 4.1 Update `CHANGELOG.md` under Unreleased with the hardening adoption summary
- [x] 4.2 Validate the change (`openspec validate adopt-oss-hardening --strict`) and confirm every task above is checked with its verification noted
