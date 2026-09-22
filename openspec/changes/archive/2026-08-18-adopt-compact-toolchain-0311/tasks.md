# Tasks — adopt-compact-toolchain-0311

## 1. Nix toolchain migration (flake-collection + vendored circuit params)

- [x] 1.1 Vendor `nix/midnight-circuit-params.nix` as a byte-copy of `midnight-verifiable-credentials`' derivation (`nix/packages/midnight-circuit-params.nix` at blob `382a8784…`, develop), SPDX-headed for this repository
- [x] 1.2 Rewrite `flake.nix`: add `flake-collection` input (`github:MediaNoxLabs/flake-collection`, `nixpkgs.follows = "nixpkgs"`, locked to a pinned rev), remove the `midnight-did` input, inherit `compact-midnight`/`compact-toolchain` from `inputs'.flake-collection.packages`, build `midnight-circuit-params` via the vendored derivation
- [x] 1.3 Bump `compactCompilerVersion` to `"0.31.1"` and update the `pinned-compact-compiler-version` check's error text to name flake-collection
- [x] 1.4 Refresh `flake.lock`; confirm no `midnight-did` node remains
- [x] 1.5 Verify in the devshell: `nix flake check` passes (pin check), `compactc --version` reports 0.31.1, and a contract compile succeeds offline (zkir params pre-populated by the shell hook)

## 2. CI and build script changes

- [x] 2.1 Set `COMPACT_COMPILER_VERSION: 0.31.1` in `.github/workflows/ci.yml`
- [x] 2.2 Remove `node ./scripts/align-runtime-version.mjs` from the package `compact` script in `packages/midnight-verifiable-credential-digital-passport/package.json`
- [x] 2.3 Delete `packages/midnight-verifiable-credential-digital-passport/scripts/align-runtime-version.mjs`
- [x] 2.4 Update comment-only references to "compact 0.30.0" in `scripts/stage-core-compact.mjs` and the `src/digital-passport-credential.compact` header (staging fallback itself stays)

## 3. Regeneration and reconciliation

- [x] 3.1 Run `pnpm install && pnpm all` inside the devshell; confirm clean compile under 0.31.1
- [x] 3.2 Verify the emitted guard: `src/managed/digital-passport-credential/contract/index.js` contains `checkRuntimeVersion('0.16.0')` with no rewrite step having run
- [x] 3.3 Reconcile any test assertions sensitive to circuit size/row drift (upstream evidence: small row/artifact-size changes, no structural changes); record actual drift values in the PR description
- [x] 3.4 Confirm the rc3 dual-runtime path is unaffected: tests and smoke import `@midnight-ntwrk/credential-compact/contract` without a version-mismatch error (`package-distribution` delta scenario)

## 4. Docs and changelog

- [x] 4.1 Root README: compiler version 0.30.0 → 0.31.1; reword the toolchain-sourcing sentence (midnight-did flake → flake-collection + vendored circuit params)
- [x] 4.2 Package README: update the nix devshell description and compiler version at the build section
- [x] 4.3 CHANGELOG: `Changed` (toolchain 0.31.1 via flake-collection, vendored circuit params) and `Removed` (align-runtime-version workaround) entries under Unreleased
- [x] 4.4 Opportunistic spike (informational only): note in the PR whether 0.31.1's package-include syntax could replace `stage-core-compact.mjs` — any downgrade is a follow-up change

## 5. Verification and archive prep

- [x] 5.1 Full local gate: `nix flake check`, `pnpm all` (compact + build + test), lint/typecheck via turbo
- [x] 5.2 CI green on the PR, including the consumer smoke lane
- [x] 5.3 `openspec validate adopt-compact-toolchain-0311 --strict` passes
- [x] 5.4 Archive ordering confirmed: `extract-digital-passport-credential` is archived before this change, so both capability deltas apply in order
