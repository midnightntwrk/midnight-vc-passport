## Why

A downstream product repository wants to consume this repo's npm packages as a nix flake input, but the flake currently exports only `devShells` and a `check` — there is no way to `nix build` the publishable tarballs. Meanwhile the circuit parameters the build depends on are vendored as a local derivation, which upstream (`MediaNoxLabs/flake-collection`) now exports directly, making the vendored copy redundant drift-prone duplication.

## What Changes

- Add a `packages.<system>.npm-artifacts` flake output: a directory containing the `pnpm pack` tarball of every publishable (non-private) package in the pnpm workspace, auto-discovered at eval time from `packages/*/package.json`. Today this resolves to the single family tarball.
- The tarball derivation is hermetic: offline dependency resolution via a fixed-output `pnpm fetch` of the lockfile, full `prepack` build (compact compile + tsc + artifact copies) using flake-collection's `compact-toolchain` and circuit parameters, then `pnpm pack --pack-destination $out`.
- Migrate circuit-parameter consumption everywhere from the vendored `nix/midnight-circuit-params.nix` (18 param sets) to `inputs'.flake-collection.packages.midnight-circuit-params` (19 sets, a strict superset with identical hashes for the shared sets), and delete the vendored derivation.
- Update the `flake-collection` input lock to latest `main`.
- Add a `checks.<system>` entry that builds the tarball and validates the distribution invariants: `package/dist/` present, compact sources and helper scripts present, no managed-code source maps, tarball filename version matches the package manifest.
- No CI changes: the nix output is a temporary distribution means consumed by a downstream repository; the existing nix-less GH Actions lanes stay as they are.

## Capabilities

### New Capabilities

- `npm-artifacts-distribution`: hermetic nix flake packaging of the workspace's publishable npm tarballs, including build hermeticity (offline installs, toolchain and circuit parameters from flake inputs), eval-time package discovery, and the tarball content check.

### Modified Capabilities

- `repository-toolchain`: the "Pinned Compact toolchain" requirement changes the circuit-parameter source from "vendored as a self-contained derivation in this repository" to "sourced from the `MediaNoxLabs/flake-collection` flake input"; the offline-compilation guarantee is preserved and now covers both the dev shell and the tarball build derivation.
- `package-distribution`: the "Complete, publishable tarball" requirement gains a nix-built source for the same artifact — the flake-built tarball SHALL satisfy the same completeness invariants as the smoke-produced one, verified by a flake check.

## Impact

- `flake.nix`: new `perSystem.packages.npm-artifacts` (plus `packages.default`), new `checks` entry, dev shell and new derivation consume `midnight-circuit-params` from `flake-collection` instead of the local callPackage.
- `nix/midnight-circuit-params.nix`: deleted.
- `flake.lock`: `flake-collection` bumped to latest `main` (rev that exports `midnight-circuit-params`).
- No changes to package manifests, the smoke lane, or CI workflows.
- Downstream consumers gain `nix build github:<this-repo>#npm-artifacts` (or bare `nix build`) on `x86_64-linux` and `aarch64-darwin`.
