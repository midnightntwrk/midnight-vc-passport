# Design — adopt-compact-toolchain-0311

## Context

- Upstream migration: `midnight-did#409` (merged) and `midnight-verifiable-credentials#432` (merged) upgraded compactc **0.30.0 → 0.31.1**. compactc 0.31.1 natively targets `compact-runtime` 0.16.0 and emits a `checkRuntimeVersion` guard that matches the *installed* runtime, so both dropped their `align-runtime-version` post-build rewrites.
- This repository already depends on `compact-runtime@0.16.0` (bumped in `8795d3e`) but compiles with compactc 0.30.0, whose emitted guard says 0.15.0; `scripts/align-runtime-version.mjs` rewrites it to 0.16.0 after every compile.
- Guard semantics (verified in runtime 0.15.0 and 0.16.0 source): while major is 0, an expected/actual minor mismatch throws `CompactError` at import time. Exact expected 0.15.0 + actual 0.16.0 → throw.
- Nix foundation rot: `flake.nix` inherits `compact-toolchain`, `compact-midnight`, and `midnight-circuit-params` from `github:midnightntwrk/midnight-did`. Post-#409, that flake sources its toolchain from `MediaNoxLabs/flake-collection` (0.31.1) and **no longer exports `midnight-circuit-params` anywhere** (repo-wide code search: zero hits). Our `flake.lock` is pinned to the pre-#409 rev `d3d7920`, which works but is a dead input: any `nix flake update` breaks `inherit (inputs.midnight-did.packages.${system}) midnight-circuit-params`. `midnight-verifiable-credentials` hit exactly this ("whose pinned branch was deleted upstream") in #432.
- Spec drift: the `package-distribution` spec (from the unarchived extraction change) still says runtime is "pinned to `0.15.0`, matching `credential-compact`'s hard-required runtime version" — stale since `8795d3e`.
- Managed artifacts (`src/managed/**`) are build output, not committed; there is no artifact-regen commit burden, only test-assertion reconciliation.

## Goals / Non-Goals

- Goals: pin compactc 0.31.1 everywhere with a single source of truth; drop the align-runtime-version workaround; un-dead the nix toolchain sourcing; keep offline compilation; reconcile specs with reality; regenerate artifacts with zero behavior change.
- Non-Goals: bumping `credential-compact` (rc3 is the newest published RC; its prebuilt-JS 0.15.0 guard is resolved by pnpm's isolated layout, not by the compiler version); dropping the `stage-core-compact.mjs` include-staging fallback (0.31.1 package-include syntax not re-evaluated — separate evaluation, see Spike below); changing `compact-runtime@0.16.0` or on-chain behavior; touching `midnight-circuit-params` content (byte-identical vendoring).

## Decisions

### D1 — Adopt 0.31.1 and drop the workaround (not just re-point the rewrite)

Alternative: keep 0.30.0 and continue rewriting the guard. Rejected: it perpetuates the divergence that both sibling repos removed, and midnight-did#409 showed the rewrite also had a packaging side effect (invalid duplicate `provableCircuits` `.d.ts` declaration it injected). With 0.31.1 the emitted guard is correct natively, so the rewrite — and its failure modes — disappear.

### D2 — Toolchain from `MediaNoxLabs/flake-collection`, circuit params vendored locally

Alternative: keep consuming midnight-did's re-exports (now 0.31.1 via flake-collection). Rejected: it re-introduces the exact coupling that just broke — midnight-did deleted an export we depend on without any contract. Both siblings converged on flake-collection; mirroring them keeps one toolchain packaging across the family of repos. `midnight-circuit-params` is vendored as `nix/midnight-circuit-params.nix` (byte-copy of `midnight-verifiable-credentials`'s derivation — a `linkFarm` of 18 S3-hosted param sets, hash-pinned via `fetchurl`), giving this repo a self-contained offline story with no upstream flake dependency for params.

### D3 — Keep the pin check, update its failure message

`checks.pinned-compact-compiler-version` stays; it now asserts against flake-collection's `compact-toolchain.version` and the error text references flake-collection instead of midnight-did. Single source of truth remains `compactCompilerVersion = "0.31.1"`, agreed with `COMPACT_COMPILER_VERSION` in `ci.yml`.

### D4 — Runtime stays 0.16.0; rc3 stays; dual-runtime is accepted and specified

`8795d3e` already put the manifest on 0.16.0, and 0.31.1 natively targets it. `credential-compact@0.1.0-rc3` pins runtime `0.15.0` exactly, so pnpm gives it a private 0.15.0 instance: its prebuilt-JS guard passes (verified empirically: `/contract` imports OK, `pureCircuits` loads), while the family's locally compiled artifacts guard 0.16.0. The one cross-boundary import in this repo (`src/testing/credential-fixtures.ts`: `ecMulGenerator`/`JubjubPoint` from 0.16.0, `pureCircuits`/`Proof` from rc3) moves plain data shapes only (verified: the two runtimes coexist in one process; even `CompactError` classes differ across the boundary). The updated `package-distribution` delta makes this contract explicit so the next bump of `credential-compact` re-evaluates it consciously rather than accidentally.

### D5 — Spec reconciliation rides along

The `package-distribution` delta fixes the 0.15.0 text stale since `8795d3e`. Doing it in this change (not a separate docs change) is justified because the migration makes the guard story the spec now describes actually true end-to-end.

### D6 — Archive ordering dependency

The extraction change is complete but unarchived, so `openspec/specs/` is still empty; this change's deltas target the capability paths the extraction change created. Archive `extract-digital-passport-credential` first, then this change, so both deltas apply in order.

## Risks / Trade-offs

- **Circuit size drift**: midnight-did#409 saw row counts move (e.g. `rotateControllerKey` 1,840 → 1,930 rows; artifact sizes ±1–3%). If any test here asserts sizes/rows, expect small updates. No structural circuit changes were reported upstream; the contract source is untouched.
- **New external flake input** (`MediaNoxLabs/flake-collection`): same trade-off both siblings accepted; mitigated by the flake.lock rev pin. Pinning an exact rev rather than the moving branch is required for reproducibility.
- **`midnight-did` input removal**: nothing else in this repo consumes it (verified: only `flake.nix` references it).
- **Dual-runtime residency** (rc3's 0.15.0 + our 0.16.0 in one process): accepted today, specified in D4; disappears when a `credential-compact` built against 0.16.0 ships.

## Spike (informational, during implementation)

While regenerating under 0.31.1, opportunistically confirm whether compact 0.31.1's package-include syntax can replace the `stage-core-compact.mjs` staging fallback (the staging script's own header says "a clean confirmation … will downgrade the build to a direct include and drop this staging step"). If confirmed, that downgrade is a **follow-up change** — it is explicitly out of scope here to keep this change a pure toolchain migration.

## Migration Plan

1. Vendor `nix/midnight-circuit-params.nix`; rewrite `flake.nix` inputs (`flake-collection` in, `midnight-did` out), toolchain inheritance, pin `compactCompilerVersion = "0.31.1"`, update the check's error text; `nix flake update` / lock refresh; verify devshell: `compactc --version`, offline compile smoke.
2. `ci.yml`: `COMPACT_COMPILER_VERSION: 0.31.1`.
3. Package: remove `align-runtime-version.mjs` invocation from the `compact` script; delete the script; update `stage-core-compact.mjs` and `src/digital-passport-credential.compact` header comments that reference "compact 0.30.0" include syntax (comment-only).
4. Regenerate: `pnpm install && pnpm all` inside the devshell; confirm emitted guard is `checkRuntimeVersion('0.16.0')` with no rewrite; reconcile any size/row assertions.
5. Docs: root README (0.30.0 → 0.31.1, toolchain source wording), package README (compiler version, nix shell description), CHANGELOG entry.
6. `openspec validate adopt-compact-toolchain-0311 --strict`; archive ordering per D6.

## Open Questions

None blocking. (D4's dual-runtime acceptance is a recorded decision, not an open question; the include-syntax spike is informational and scoped out.)
