## Why

The sibling repositories migrated to the Compact 0.31.1 toolchain — `midnight-did#409` and `midnight-verifiable-credentials#432` — and compactc 0.31.1 natively targets `compact-runtime` 0.16.0, emitting a `checkRuntimeVersion` guard that matches the installed runtime so their `align-runtime-version` post-build workarounds were dropped. This repository already depends on runtime 0.16.0 but still compiles with compactc 0.30.0 and papers over the guard with `scripts/align-runtime-version.mjs`, diverging from both siblings. The divergence is no longer just hygiene: this repo's nix flake consumes the `midnight-did` flake for `compact-toolchain` and `midnight-circuit-params`, and after `midnight-did#409` that flake no longer exports `midnight-circuit-params` (and now re-exports a 0.31.1 toolchain from `MediaNoxLabs/flake-collection`) — so the next `nix flake update` breaks the devshell against a dead input.

## What Changes

- Upgrade the pinned Compact compiler from 0.30.0 to **0.31.1**: `COMPACT_COMPILER_VERSION` in `ci.yml`, `compactCompilerVersion` in `flake.nix`, and the `compact update` instructions in both READMEs.
- Source the nix toolchain from **`MediaNoxLabs/flake-collection`** instead of the `midnight-did` flake input, mirroring both sibling PRs; vendor a self-contained `midnight-circuit-params` derivation locally (copy of `midnight-verifiable-credentials`'s `nix/packages/midnight-circuit-params.nix`) since no upstream flake exports it anymore. The `pinned-compact-compiler-version` check and the offline circuit-params pre-population are retained.
- **Remove the `align-runtime-version` workaround**: delete `scripts/align-runtime-version.mjs` and its invocation from the package's `compact` build script. compactc 0.31.1 emits the guard against the installed runtime (0.16.0) natively, so no rewriting is required.
- Regenerate the managed contract artifacts under 0.31.1. Sibling evidence (midnight-did#409) shows small circuit row/artifact-size drift (e.g. `rotateControllerKey` 1,840 → 1,930 rows); size- or row-sensitive assertions in this repo's tests are updated if they drift. No contract-source or behavior change.
- Reconcile the `package-distribution` spec with reality: the runtime dependency was bumped to 0.16.0 in `8795d3e` without a spec delta, and the spec still says 0.15.0 "matching credential-compact's hard-required runtime version". The updated requirement states the actual contract: runtime pinned to 0.16.0, the family contract compiled and guarded against 0.16.0, and the published `credential-compact@0.1.0-rc3` prebuilt JS retaining its own 0.15.0 guard under pnpm's isolated resolution (dual-runtime, import-time-safe).
- Update living docs (root README, package README, build-script comments referencing "compact 0.30.0") and the CHANGELOG.
- Out of scope: any `credential-compact` version change (rc3 is the latest published RC; its prebuilt-JS guard is orthogonal to the compiler version), dropping the `stage-core-compact.mjs` include-staging fallback (0.31.1's package-include syntax was not re-evaluated here), and runtime dependency changes (stays 0.16.0).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `repository-toolchain`: the "Pinned Compact toolchain" requirement changes — version 0.31.1, toolchain sourced from `MediaNoxLabs/flake-collection` with locally vendored circuit parameters (no `midnight-did` flake dependency). A new requirement pins the build contract that the compiler-emitted runtime-version guard SHALL match the pinned runtime natively, with no post-build rewriting.
- `package-distribution`: the "Registry-resolvable dependencies" requirement changes — `compact-runtime` pinned to 0.16.0 (reconciling the `8795d3e` drift), with the dual-runtime resolution of the published `credential-compact` prebuilt JS made explicit.

## Impact

- **Build/tooling**: `flake.nix` + `flake.lock` (new `flake-collection` input, dropped `midnight-did` input, new vendored `nix/midnight-circuit-params.nix`), `.github/workflows/ci.yml`, package `compact` script, deleted `scripts/align-runtime-version.mjs`.
- **Generated code**: `src/managed/digital-passport-credential/**` regenerated under compactc 0.31.1 (untracked build output; no committed artifacts). Possible small circuit-size drift absorbed by test assertions.
- **Dependencies**: none. `compact-runtime@0.16.0` and `credential-compact@0.1.0-rc3` manifest pins are unchanged; the lockfile keeps rc3's private 0.15.0 runtime instance.
- **Docs/specs**: root README, package README, script comments, CHANGELOG, two delta specs. The unarchived `extract-digital-passport-credential` change must be archived before this change so both deltas apply to the main specs in order.
- **Upstream evidence**: `midnight-did#409` (merged), `midnight-verifiable-credentials#432` (merged) — this change mirrors their combined migration for the family repository.
