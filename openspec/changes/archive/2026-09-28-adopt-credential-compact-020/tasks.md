# Tasks — adopt-credential-compact-020

## 1. Dependency bump

- [x] 1.1 Diff the published `credential-compact` `0.2.0-rc1` and `0.2.0` tarballs: only `package.json` `version` differs; `compactCompilerVersion` 0.31.1 and `compactRuntimeVersion` 0.16.0 unchanged
- [x] 1.2 Bump `packages/midnight-vc-passport/package.json`: `@midnight-ntwrk/credential-compact` `0.2.0-rc1` → `0.2.0`
- [x] 1.3 Swap the inert `0.2.0-rc1` `minimumReleaseAgeExclude` entry for a reviewed, time-boxed `0.2.0` entry (window lifts 2026-10-02)
- [x] 1.4 Refresh the lockfile (`pnpm install` in the devshell); `pnpm why -r @midnight-ntwrk/compact-runtime` reports a single `0.16.0` instance shared by family and core

## 2. Verification

- [x] 2.1 Devshell: `pnpm run all` green (compact + build + 67 tests)
- [x] 2.2 Devshell: `pnpm --filter smoke-consumer smoke` passes (registry-resolved isolated install, all entry points, round-trips)

## 3. Docs and spec

- [x] 3.1 Root README, package README, package CHANGELOG, `docs/monorepo-deletion-criteria.md`: `0.2.0-rc1` → `0.2.0`
- [x] 3.2 `package-distribution` spec: pin updated to the stable `0.2.0`
- [x] 3.3 Fix the stale `midnight-did-credentials` staging-source comment in `src/digital-passport-credential.compact`
- [x] 3.4 `openspec validate` passes
