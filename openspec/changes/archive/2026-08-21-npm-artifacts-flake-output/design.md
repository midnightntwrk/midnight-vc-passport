## Context

The flake (flake-parts, systems `x86_64-linux` + `aarch64-darwin`) exports only `devShells.default` and `checks.pinned-compact-compiler-version`. Circuit parameters are consumed by the dev shell from `nix/midnight-circuit-params.nix` (vendored 18-entry linkFarm, `bls_midnight_2p1`–`2p18`). The workspace is pnpm@10.34.1 (corepack) + turbo with one publishable package under `packages/`; its `prepack` runs the full build including `compact compile`, which reads params from `$HOME/.cache/midnight/zk-params` and the compiler from `COMPACT_DIRECTORY`. `MediaNoxLabs/flake-collection` is already a locked input providing `compact-midnight` and `compact-toolchain` (0.31.1, guarded by the existing check); latest `main` additionally exports `midnight-circuit-params` (19-entry linkFarm, superset of the vendored one — adds `bls_midnight_2p19`, identical hashes for the shared 18). The locked rev predates that export, so the migration requires a lock bump. The GH Actions smoke lane is nix-less and stays untouched (see proposal — temporary distribution means, downstream consumption only).

## Goals / Non-Goals

**Goals:**
- `nix build .#npm-artifacts` (and bare `nix build` via `packages.default`) yields the `pnpm pack` tarball of every publishable workspace package, hermetically.
- One source of truth for circuit parameters: `flake-collection`'s `midnight-circuit-params`, used by both the dev shell and the tarball build.
- A flake check that fails loudly on tarball content violations (missing dist/compact sources/scripts, managed source maps, version mismatch).
- Eval-time auto-discovery of publishable packages so new packages flow into `npm-artifacts` with no flake edits.

**Non-Goals:**
- Publishing to npm (no `npm publish` anywhere), CI lanes for nix, or replacing the existing smoke lane.
- Packaging private workspaces (`smoke-consumer`) — they are excluded from packing.
- Replacing `prepack` with a bespoke in-nix build script; the derivation shells out to the real pipeline.
- Per-package flake outputs (`packages.<system>.digital-passport`) — aggregate only, added later if a second publishable package needs direct selection.

## Decisions

### D1 — One derivation per publishable package, aggregated by a linkFarm

For each discovered package, a `stdenv.mkDerivation` runs the full build and `pnpm pack --pack-destination $out`; `npm-artifacts` is a `linkFarm` over those store paths (plus the `default` alias). Alternative: a single derivation packing all packages into one `$out` — rejected because per-package derivations parallelize and cache independently, and the linkFarm keeps `$out` a flat directory of tarballs for easy downstream consumption.

### D2 — Hermeticity strategy: fixed-output `pnpm fetch` + offline install

A separate fixed-output derivation runs `pnpm fetch` on the lockfile producing a content-addressed offline store; the build derivation installs from it with `pnpm install --offline --frozen-lockfile` (plus `--ignore-scripts` at install — lifecycle scripts run under our controlled env, not through postinstall hooks). Alternatives: `dream2nix`/`pnpm2nix` machinery — rejected as a heavy new dependency for a one-package family tarball; network-enabled `pnpm install` in the build — rejected, breaks sandbox hermeticity. Trade-off: the fetch derivation must be kept lockfile-driven (its hash changes exactly when `pnpm-lock.yaml` changes), which is acceptable because the lockfile is already the repo's pinning mechanism.

### D3 — Circuit params and toolchain wiring inside the build

The build sets `COMPACT_DIRECTORY = ${compact-toolchain}` and `MIDNIGHT_PP = ${midnight-circuit-params}`, pointing at the flake input's linkFarm directly; the params provider resolves `MIDNIGHT_PP` before `~/.cache/midnight/zk-params`, so neither the dev shell nor the build sandbox seeds `$HOME` at all — one known-good, read-only invocation pattern across shell and derivation. Alternative (original plan): seed a writable `$HOME/.cache/midnight/zk-params` by deref-copying the linkFarm contents — superseded during implementation: it worked, but polluted `$HOME` and duplicated the ~200 MB params per build environment. (`MIDNIGHT_PARAM_SOURCE` was also passed over: `MIDNIGHT_PP` is the provider's first-resolution path and needs no cache seeding.)

### D4 — Source filtering: workspace root + `packages/*`, minus gitignored artifacts

`src = lib.cleanSourceWith` filters: root manifests (`package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `.npmrc`, `tsconfig*`, turbo config) and `packages/<name>` trees excluding `dist`, `node_modules`, `src/managed`, `coverage`, `reports`, and other build outputs. Rationale: `prepack` regenerates managed code and dist itself (spec requires a clean build), so shipping stale generated output into the sandbox both bloats the source and risks staleness. Alternative: `self` (whole flake source) — rejected as non-minimal and lockfile-unfriendly for caching. The managed-code exclusion relies on `compact compile` regenerating it from the `.compact` sources, which the existing build pipeline guarantees.

### D5 — Auto-discovery at eval time

A small nix function reads `packages/*/package.json` (via `builtins.readFile` + `fromJSON`) and selects those without `"private": true`. This is pure (reads of the flake's own source) and keeps "all npm tarballs" literal. Manifest-less directories under `packages/` are skipped, mirroring pnpm's workspace semantics, rather than crashing evaluation. Alternative: an explicit package list in `flake.nix` — rejected per the proposal: silently misses new publishable packages.

### D6 — Node/pnpm pinned like the dev shell

The derivation uses `nodejs_24` and corepack-provisioned `pnpm@10.34.1` (via `COREPACK_ENABLE_STRICT`/`corepack pnpm`), matching the dev shell's mechanism and the root `packageManager` field, so the tarball is built by the same tool versions the repo declares. Alternative: nixpkgs `pnpm` package — rejected: version drift from `packageManager` pin.

### D7 — Lock update to latest `main`

`nix flake lock --update-input flake-collection` (flake-collection follows this repo's nixpkgs). The `pinned-compact-compiler-version` check (0.31.1) guards the toolchain across the bump; latest `main`'s toolchain still satisfies it. Rollback is reverting `flake.lock`.

### D8 — Check implementation: `runCommand` tarball audit

`checks.npm-artifacts-contents` untars each `.tgz` and asserts: `package/dist/` non-empty and contains the managed contract index, `package/src/**/*.compact` present, `package/scripts/*.mjs` present, no `*.map` under `package/dist/managed/`, and the tarball filename's version equals the manifest's `version` (read at eval time). Style follows the existing `pinned-compact-compiler-version` check. Alternative: reuse `smoke.mjs` inside nix — rejected: the smoke is an install-and-run round-trip, heavier than the content audit this change needs. Compact-specific assertions (managed contract index, `.compact` sources, helper scripts, no managed source maps) are scoped at eval time to packages whose `src/` tree contains `.compact` files, so non-Compact publishable packages discovered per D5 pass the audit without flake edits.

## Risks / Trade-offs

- [Heavy builds: ~200 MB params + full workspace install + compact compile per package] → Params/toolchain come from cached flake inputs; per-package derivations (D1) keep rebuilds scoped to the affected package; this output is built on demand by downstream, not in CI.
- [`pnpm fetch` fixed-output hash churn on every lockfile change] → Accepted: lockfile changes are deliberate pin moves; hash is recorded in flake-adjacent code and updated mechanically.
- [Eval-time `builtins.readFile` of `packages/*/package.json` couples flake evaluation to workspace layout] → `pnpm-workspace.yaml` already fixes that layout; a malformed manifest fails evaluation loudly rather than silently skipping a package.
- [flake-collection `main` moves (new toolchain ≠ 0.31.1, param set changes)] → The version check fails loudly on toolchain drift; param hash changes are absorbed by the lock pin until an explicit `nix flake update`.
- [Corepack in sandbox needs network to download pnpm unless pre-provisioned] → Seed corepack's pnpm from nixpkgs' corepack cache or vendor via `corepack prepare` in the fetch derivation; verify during implementation and prefer whatever the dev shell already exercises.
- [Stricter `prepack` under `--ignore-scripts` installs] → `prepack` runs via the explicit `pnpm pack` call, not install hooks; `compact`/`tsc` execute with the derivation's controlled `PATH` (toolchain from `COMPACT_DIRECTORY`).

## Migration Plan

1. Bump `flake-collection` lock to latest `main`; confirm `midnight-circuit-params` evaluates (existing version check still green).
2. Swap dev-shell param source to the flake input; delete `nix/midnight-circuit-params.nix`.
3. Add the fetch derivation, per-package tarball derivation, `npm-artifacts` linkFarm + `default`, and the content check; wire `perSystem.packages`/`checks`.
4. Verify: `nix flake check` passes; `nix build .#npm-artifacts` produces the family tarball; untar and compare file set against the smoke lane's artifact.
5. Rollback: revert the branch/commits; no persisted state outside `flake.lock` and the flake.

## Open Questions

None — all decisions were resolved during the design interview (aggregate-only output, latest-main lock target, hermetic build, no CI lane).
