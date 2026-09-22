## 1. Spike: compact include from installed core

- [x] 1.1 Verify the core contract layer is published to npm; record the version. **YES** — `@midnight-ntwrk/credential-compact@0.1.0-rc3` is published; the family pins it as a normal dependency.
- [x] 1.2 Determine the compact 0.30.0 `include` syntax that resolves the core contract sources from the installed package (package specifier vs node_modules-relative path); adopt the selected fallback: build-time staging of core compact sources from the installed `@midnight-ntwrk/credential-compact` package into a local include path
- [x] 1.3 Record the working include resolution in design.md (Open Questions) before touching the contract

## 2. Workspace scaffold

- [x] 2.1 Create private root manifest (name, engines node >= 24 / pnpm >= 10, workspace scripts), `pnpm-workspace.yaml` listing `packages/*`, and `turbo.json` with typecheck/lint/build/test pipeline
- [x] 2.2 Create `packages/midnight-verifiable-credential-digital-passport` manifest: renamed package, `private: true` (until release change), exports map with `.`, `./codecs`, `./contract`, `./testing` and the managed contract subpath, `files` list (dist, compact sources, scripts, README), pinned registry dependencies (`@midnight-ntwrk/credential-compact@0.1.0-rc3`, `@midnight-ntwrk/compact-runtime@0.15.0`) and zero `workspace:`/`file:`/git entries with no overrides anywhere
- [x] 2.3 Create `packages/smoke-consumer` manifest (private) that consumes the family package by tarball install
- [x] 2.4 Port/adapt eslint config, prettier config, and TypeScript configs (base + build) for the workspace; verify `pnpm install`, typecheck, and lint run clean on the empty scaffold

## 3. Nix flake and compact toolchain

- [x] 3.1 Create `flake.nix` mirroring the monorepo inputs (nixpkgs, flake-parts, midnight-did flake) exposing a devshell with node, pnpm, compact toolchain, and circuit parameters
- [x] 3.2 Verify offline contract compilation inside the devshell (pre-populated circuit params), matching the monorepo's mechanism
- [x] 3.3 Pin the same compact compiler version (0.30.0) in the flake and in the CI env

## 4. Port the family package

- [x] 4.1 Port compact contract sources (`digital-passport-credential.compact` + split files); rewrite the core `include` per spike 1.2; fix SPDX headers to name this repository
- [x] 4.2 Port build scripts: adapt `find-repo-root.mjs`, `align-runtime-version.mjs`, `strip-managed-sourcemaps.mjs`; drop or replace `ensure-compact-package-aliases.mjs` with the standalone equivalent (per design D8); verify `compact compile` produces managed code and `build` produces dist
- [x] 4.3 Port TypeScript sources (`index.ts`, `contract.ts`, `codecs.ts`, testing modules, tests) byte-for-byte except the decided surface changes: inline the compact-value codec in `codecs.ts` (replacing the openid import) with its ported conformance test; move fixture exports out of the root entry behind `./testing`; fix SPDX headers on all sources
- [x] 4.4 Port the vitest setup and confirm the full ported suite (codecs, claim-root, age-predicate, private-parts, presentation-request, protocol, package-surfaces) passes with unchanged expectations
- [x] 4.5 Reconcile the package README: document all five claims, disclosures, validation circuits, protocol model; replace monorepo-relative doc links with absolute GitHub links; document the inlined codec's bit-compatibility obligation

## 5. CI lanes

- [x] 5.1 Add `ci.yml`: SHA-pinned `setup-compact-action` at 0.30.0, Node 24, pnpm 10, turbo typecheck + lint + build + test across workspaces, cache keys including compiler version
- [x] 5.2 Add `dependency-review.yml` and `scorecard.yml`; keep template `scan.yaml`; verify all lanes run on a pull request

## 6. Consumer evidence (smoke lane)

- [x] 6.1 Implement the smoke consumer: pack the built family tarball, install it into a clean environment with registry-only resolution, import every public entry point (`.`, `./codecs`, `./contract`, `./testing`), and run an issuance/presentation fixture round-trip
- [x] 6.2 Wire the smoke run as a CI lane that runs on every push/PR (un-gated — `credential-compact` is published, so the smoke resolves everything from the registry)
- [x] 6.3 Record the consumer boundary evidence — the smoke round-trip (every public entry point imports; issuance/presentation/verification align; both compact-value codec round-trips succeed) is **green** as a genuine registry-resolution proof: `credential-compact@0.1.0-rc3` and `compact-runtime@0.15.0` are both published, so the isolated project resolves every dependency from npm (no `CORE_RC_TARBALL`, no `pnpm.overrides`, no `.core-rc`). CI `verify`/`smoke` lanes are un-gated and run on every push/PR.

## 7. Repository docs and boundary handoff

- [x] 7.1 Replace the root README (template boilerplate) with this repository's purpose, package pointer, development setup (flake), and links to the core repo's specs — root `README.md` rewritten: repo purpose, repository layout, `nix develop` + `pnpm all` workflow, CI lanes, boundary-handoff pointer, and links to the `midnight-verifiable-credentials` core credentials package + the `midnight-did` precedent
- [x] 7.2 Record the monorepo-side deletion criteria in a doc or this change's archive notes: core contract layer published + registry-resolution smoke green + monorepo prototype tests passing during transition; deletion itself is a change in `midnight-verifiable-credentials` — recorded in [`docs/monorepo-deletion-criteria.md`](../../../docs/monorepo-deletion-criteria.md). The deletion-authorizing criterion is the **registry-resolution** smoke (criterion 2); because `credential-compact@0.1.0-rc3` is published, that smoke is green from day one and the monorepo-side deletion is unblocked from the boundary-evidence perspective (there are no pre-RC overrides to remove).
- [x] 7.3 Run full local verification (flake shell: install, typecheck, lint, build, test, pack, smoke) and CI verification on a branch; confirm specs via `openspec validate` — **local verification green**: `pnpm install` → `pnpm run all` (lint+typecheck+build+test:ci, 60 tests) → pack → consumer smoke round-trip all pass; tarball is spec-compliant (dist + compact sources + scripts present; **0 managed-code source maps** after hardening `strip-managed-sourcemaps.mjs`); `openspec validate` passes. CI-on-branch: workflows are YAML-valid and SHA-pinned; the `verify` and `smoke` jobs run on every push/PR (un-gated — `credential-compact` is published), and the live run is green.
