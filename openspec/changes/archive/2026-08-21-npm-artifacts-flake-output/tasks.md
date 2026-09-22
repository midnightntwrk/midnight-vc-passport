## 1. Lock bump and circuit-param migration

- [x] 1.1 Update `flake-collection` input lock to latest `main` (`nix flake lock --update-input flake-collection`) and confirm `midnight-circuit-params` is exported for both systems while the `pinned-compact-compiler-version` check still passes
- [x] 1.2 Replace the dev shell's `midnight-circuit-params` binding (currently `pkgs.callPackage ./nix/midnight-circuit-params.nix { }`) with `inputs'.flake-collection.packages.midnight-circuit-params` in `flake.nix`
- [x] 1.3 Delete `nix/midnight-circuit-params.nix` and update the `repository-toolchain` spec references (see specs/repository-toolchain delta) in the same change

## 2. Npm tarball derivation

- [x] 2.1 Add eval-time auto-discovery in `flake.nix`: read `packages/*/package.json`, select non-private ones, exposing name/version/workspace-relative path
- [x] 2.2 Add the fixed-output dependency fetch derivation: `pnpm fetch` against `pnpm-lock.yaml` with corepack-provisioned pnpm@10.34.1 and nodejs_24, producing an offline store (record its output hash once fixed)
- [x] 2.3 Add `nix/npm-tarball.nix` (or inline in `flake.nix`): `stdenv.mkDerivation` per discovered package taking the filtered source (root manifests + `packages/<name>`, excluding `dist`, `node_modules`, `src/managed`, `coverage`, `reports`), the offline store, `compact-toolchain`, and `midnight-circuit-params`; sets `COMPACT_DIRECTORY` and serves the circuit params via `MIDNIGHT_PP` pointing at the linkFarm (supersedes the originally planned `$HOME/.cache/midnight/zk-params` deref-copy seeding — see D3), runs offline frozen install, then `pnpm pack --pack-destination $out` (real `prepack` pipeline)
- [x] 2.4 Expose `perSystem.packages.npm-artifacts` as a linkFarm over the per-package tarball derivations, and alias it as `perSystem.packages.default`, for both systems

## 3. Content check

- [x] 3.1 Add `checks.npm-artifacts-contents` (`runCommand`, style of `pinned-compact-compiler-version`): build the tarballs, untar each, assert `package/dist/` non-empty with the managed contract index present, `package/src/**/*.compact` present, `package/scripts/*.mjs` present, no `*.map` under `package/dist/managed/`, and tarball filename version equals the manifest `version` from eval-time discovery; fail with an error naming the offending tarball and violation

## 4. Verification and docs

- [x] 4.1 Run `nix flake check` (both systems where possible) and `nix build .#npm-artifacts`; confirm exactly one `.tgz` for the family package with the `package/` prefix layout
- [x] 4.2 Compare the flake-built tarball's file set against the smoke lane artifact (`pnpm --filter ... pack` in a temp dir) — same file list, no managed source maps
- [x] 4.3 Update root `README.md` (and package README if it mentions distribution) with the `nix build .#npm-artifacts` consumption path for downstream repos
- [x] 4.4 Validate the change (`openspec validate npm-artifacts-flake-output --strict`) and review all tasks complete
