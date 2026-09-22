## Context

This repository is currently an empty Midnight template (governance files, template CI scan, OpenSpec scaffolding). The extraction source is `midnight-verifiable-credentials` at branch `develop-history-2026-08-06`, specifically `packages/prototypes/credential-families/digital-passport` (`@midnight-ntwrk/midnight-did-credentials-digital-passport`), a private prototype with zero workspace dependants. The graduation rationale (recorded in proposal.md) is that concrete credential families live in independent repositories as the sole source of truth for the family, consumed via registry packages with no source-level coupling to the monorepo. See proposal.md for motivation and scope; specs for the behavior contract.

Key technical constraints discovered in exploration:

- The family's generated managed code imports **only** `@midnight-ntwrk/compact-runtime` (published, 0.15.0). Generic VC envelope types are compiled into the family contract via compact `include`.
- The compact contract today includes the core contract by monorepo-relative path: `include "../../../../../packages/core/primitives/credentials/src/credentials"`. The core package already publishes `src/**/*.compact` and exports `./credentials.compact` / `./credentials/*.compact`.
- Two source files import unpublished monorepo packages: `codecs.ts` imports the generic compact-value codec (134 lines, depends only on `node:buffer` + `compact-runtime`) from the openid package; `testing/credential-fixtures.ts` imports `Proof`, `VerificationMethodRef`, and proof-challenge circuits from the generic credentials package.
- `index.ts` re-exports fixtures into the root surface; the advertised `./testing` subpath does not exist in the exports map.
- The monorepo build uses `scripts/ensure-compact-package-aliases.mjs`, which delegates to a monorepo-root tooling helper that materializes repo-root symlink aliases — a monorepo-local mechanism.
- CI precedent: `COMPACT_COMPILER_VERSION: 0.30.0`, `midnightntwrk/setup-compact-action` pinned by SHA. Nix precedent: the monorepo flake consumes the midnight-did flake for `compact-toolchain` + `midnight-circuit-params` and pre-populates zkir params for offline compilation (explicitly for digital-passport's build).
- Repo precedent: `midnight-did` (pnpm+turbo workspace, `packages/*`, flake with devshells, engines node ≥ 24 / pnpm ≥ 10, ratcheted actions, published-tarball smoke lanes).

## Goals / Non-Goals

**Goals:**

- A self-contained workspace that builds, tests, and proves consumability of the family package with zero source-level coupling to the monorepo.
- Behavioral-equivalence evidence: ported test suite green on unchanged logic.
- A recorded, verifiable boundary (consumer smoke) proving the family is installable and usable as a normal npm package.

**Non-Goals:**

- Release/publish workflows, versioning scheme, registry publication of this package (deferred change).
- Any behavior change to circuits, claims, encodings, or predicates (P1-3 cleanups become later changes here).
- Deletion or modification of the monorepo copy (change in `midnight-verifiable-credentials`).
- Porting monorepo-scale governance tooling (boundary checks, catalogs, build cones, docs lanes).

## Decisions

### D1. Core dependency consumed from the published `credential-*` core split

The family's core contract dependency is `@midnight-ntwrk/credential-compact` — the published contract layer from the `midnight-verifiable-credentials` monorepo's `credential-*` core split (credential-compact, credential-proofs, credential-status, credential-did-midnight, credential-model). It is published on npm as `@midnight-ntwrk/credential-compact@0.1.0-rc3` and pinned as a normal dependency alongside `@midnight-ntwrk/compact-runtime@0.15.0`.

- Why: the family's **publishable manifest** must declare only registry-resolvable semver dependencies (no `workspace:`/`file:`/git/sibling coupling), so any consumer can install it as a normal npm package. The fixtures' use of generic proof-challenge circuits is legitimate core logic, not something to re-implement.
- Alternatives rejected: vendoring the generic envelope contract (creates a competing core implementation, repeated by every future family repo); git dependencies (not a normal npm install).
- Boundary evidence: the publishable manifest is registry-clean from day one and `credential-compact@0.1.0-rc3` is published, so the consumer smoke is a **genuine registry-resolution proof** — every dependency (family + core + runtime) resolves from npm in a clean isolated project. There is no `.core-rc/`, no root `pnpm.overrides`, and no `file:` override anywhere.

### D2. Compact-value codec inlined, not imported

`encodeCompactPayload`/`decodeCompactPayload` (+ types) are copied into this package with the ported `compact-value-codec.test.ts`, removing the openid dependency entirely.

- Why: 134 lines, protocol-neutral, stateless; publishing the openid package just for it violates the "family must not depend on protocol transport" boundary, and moving it down in core first would block extraction.
- Obligation: bit-compatibility with core's wire format (`compact-value-v1.base64url`, `MCV1` framing) is permanent — wallets and verifiers encode on opposite sides. The ported conformance test is the guard; while the monorepo copy still exists, a cross-check against it is cheap additional evidence.
- Alternatives rejected: moving the codec into `credential-compact` now (reasonable long-term home, but expands the core-side prerequisite slice); into `credential-model` (violates the catalog's dependency edge table).

### D3. Fixtures behind a first-class `./testing` subpath

Root entry stops re-exporting fixtures; exports map gains `./testing` (and keeps `.`, `./codecs`, `./contract`, and the managed contract subpath). `credential-compact` remains a normal dependency, imported only via `./testing`.

- Why: matches the README's own surface classification ("Off-chain only fixture surface"), keeps the root minimal, and fixes a broken advertised subpath.

### D4. Package named after the repository

`@midnight-ntwrk/midnight-verifiable-credential-digital-passport`, mirroring the midnight-did precedent (repo name == head package name). On-chain identifiers unchanged.

- Why: never published, so the rename is free now and costly later; sets the product-repo naming precedent. Alternatives considered: legacy name (carries doomed `midnight-did-credentials-` prefix), `credential-digital-passport` (capability-first catalog style; rejected for product identity).

### D5. pnpm + turbo workspace from day one

Private root manifest, `pnpm-workspace.yaml`, `turbo.json`, `packages/*` — mirroring midnight-did. Two workspaces initially: the family package (publishable-ready, `private: true` until the release change) and `packages/smoke-consumer` (private evidence).

### D6. Mechanical migration + docs truthfulness only

Sources port byte-for-byte except: SPDX headers (D9), the compact `include` path (D7), the codec import (D2), the exports/fixture surface (D3), and dependency pins. README reconciled to the actual five-claim schema. All P1-3 behavior cleanups deferred to follow-up changes in this repo.

### D7. Compact include from the installed core package

The contract's core `include` is rewritten from the monorepo-relative path to resolve from the installed `@midnight-ntwrk/credential-compact` package (the published package ships the compact sources; exports exist). Exact include syntax (package specifier vs node_modules-relative path) is a build-time spike — the first task, since everything downstream depends on it resolving under compact 0.30.0.

### D8. Standalone rework of the alias/build scripts

`ensure-compact-package-aliases.mjs` and friends assume the monorepo-root helper and symlink aliases. In this repo, pnpm resolves the core package in `node_modules` directly; the scripts are reduced to what the standalone build actually needs (likely alias removal, keep `align-runtime-version.mjs` and `strip-managed-sourcemaps.mjs`, adapt `find-repo-root.mjs`). If the include resolves without aliases, the alias script is dropped rather than ported.

### D9. SPDX headers fixed in-port

TS sources gain the SPDX block naming this repository; compact headers re-named from `midnightntwrk/midnight-did` lineage. Comment-only; template mandate.

### D10. Flake mirrors the monorepo's proven inputs

`flake.nix` with `nixpkgs` + `flake-parts` + the midnight-did flake input providing `compact-toolchain` and `midnight-circuit-params`, plus a devshell. This is the exact mechanism the monorepo nix build uses to compile digital-passport offline. CI uses the org's `setup-compact-action` (SHA-pinned) with `COMPACT_COMPILER_VERSION: 0.30.0`; the flake pins the same version.

### D11. Smoke consumer as the boundary proof

`packages/smoke-consumer` (private): packs the built family tarball, installs it into a clean project, imports every public entry point, and runs an issuance/presentation/verification + codec round-trip. It is a **genuine registry-resolution proof**: `@midnight-ntwrk/credential-compact` and `@midnight-ntwrk/compact-runtime` are both published, so every dependency (family + core + runtime) resolves from npm in the isolated project — not a tarball-staged workaround. Wired as a CI lane that runs on every push/PR (un-gated).

## Risks / Trade-offs

- ~~[Core RC not yet published to npm]~~ → **RESOLVED:** `@midnight-ntwrk/credential-compact@0.1.0-rc3` is published to npm. Every CI lane (`verify` and `smoke`) installs from the registry and runs on every push/PR — un-gated, with no `rc-gate` job. The consumer smoke is a genuine registry-resolution proof.
- [Inlined codec drifts from core] → Ported conformance test + cross-check against the monorepo copy while it exists; document the bit-compatibility obligation in the package README.
- [Compact include syntax from node_modules unproven] → Spike first (task order); fallback is a build-time copy step that stages the core compact sources from node_modules into a local include path.
- [Compiler version drift changes generated code] → Pin 0.30.0 identically in CI env and flake; cache keys include the version (monorepo precedent).
- ~~[The `midnight-did-credentials` RC shape predates the planned `credential-*` core split; future re-point needed]~~ → **RESOLVED:** the `credential-*` core split has landed and the family consumes `credential-compact` directly today. No further re-point is needed.
- [Name length (57 chars scoped)] → Accepted; precedent consistency valued over brevity.

## Migration Plan

1. Spike: resolve the compact include from the installed core package under compact 0.30.0.
2. Scaffold workspace root (manifests, turbo, pnpm-workspace), flake, CI workflows.
3. Port the family package: sources, compact contract (include rewritten), tests, scripts (reworked), exports/fixture surface, codec inlined, headers fixed, dependency pins, README reconciled.
4. Ported suite green in CI → behavioral-equivalence evidence recorded.
5. Smoke consumer workspace + lane; boundary evidence recorded as a genuine registry-resolution smoke (credential-compact is published), running on every push/PR.
6. Record deletion criteria for the monorepo-side follow-up change.

Rollback: this repo is additive — nothing here mutates the monorepo. The monorepo copy stays "frozen migration evidence" until its own deletion change, so any failure simply leaves the status quo intact.

## Spike Outcome (Task Group 1)

**1.1 — Core contract layer published (RESOLVED):** the family's core contract dependency is published as `@midnight-ntwrk/credential-compact@0.1.0-rc3` on npm (part of the `midnight-verifiable-credentials` monorepo's `credential-*` core split). `@midnight-ntwrk/compact-runtime@0.15.0` is published (the runtime dependency is available; `credential-compact` hard-requires `0.15.0` via `checkRuntimeVersion('0.15.0')`, so the family aligns its managed code to `0.15.0` to share one runtime). The consumer smoke is therefore a **genuine registry-resolution proof** — every dependency (family + core + runtime) resolves from npm in a clean isolated project.

**1.2 — Include-syntax determination (RESOLVED via selected fallback):** Task 1.2 prescribes two outcomes: (a) determine a direct compact 0.30.0 `include` syntax from the installed core package (package specifier vs node_modules-relative path), or (b) "if none works, adopt the fallback: build-time staging of core compact sources from node_modules into a local include path." The **build-time staging fallback is SELECTED as the working include resolution** for this change: `scripts/stage-core-compact.mjs` resolves the published `@midnight-ntwrk/credential-compact/credentials.compact` subpath and stages it into a local include path. This selection satisfies task 1.2's deliverable — a working include resolution is determined and recorded — and is independent of compact 0.30.0's package-include syntax. The empirical confirmation of a cleaner direct-include syntax (package-specifier or node_modules-relative path) remains a **deferred optimization** tracked in Open Questions; it does not block the change.

**1.3 — Working include resolution (RECORDED):** the implementation path for group 4's contract include uses the D7/D8 staging fallback — `scripts/stage-core-compact.mjs` copies the core compact sources from the **published** `@midnight-ntwrk/credential-compact` package (resolving `./credentials.compact` + the `credentials/` tree) into a local include path, then `include`s them via a repo-relative path. This approach is **independent of compact 0.30.0's package-include syntax** and therefore removes the include question from the critical path. Candidate syntaxes to confirm empirically (and to adopt in preference to the staging step if they resolve cleanly): (a) package-specifier include against the package's exported compact subpath; (b) node_modules-relative path include. A clean confirmation of either downgrades the build to a direct include and drops the staging step; until then, the staging fallback is the selected working resolution.

## Open Questions

- Exact compact `include` specifier syntax accepted by 0.30.0 for package-installed sources — **deferred** (see Spike Outcome 1.2/1.3 above); the build-time staging fallback is the working resolution, independent of compact 0.30.0's package-include syntax, so this does not block.
- Whether the smoke lane lives in `ci.yml` or a dedicated workflow file — cosmetic. **Resolved (group 5/6):** the smoke run is a `smoke` job in `ci.yml`, not a separate workflow file; it runs on every push/PR (un-gated — there is no `rc-gate` job).
- DevDependency style at the workspace root (direct pins vs pnpm catalog) — follow midnight-did's style during scaffolding. **Resolved (group 2):** direct pins at the root manifest (no pnpm catalog), matching the midnight-did precedent.

**Group 4 realization (dependency wiring, contract include, build):**

- *Family manifest pin (D1 realized):* the family package manifest now declares `@midnight-ntwrk/credential-compact: "0.1.0-rc3"` (registry-clean semver — the published contract layer) alongside `@midnight-ntwrk/compact-runtime: "0.15.0"`. The manifest is **strictly registry-clean** — no `workspace:`/`file:`/git entries and **no overrides anywhere** — so the publishable contract (package-distribution spec) is intact from day one. `@midnight-ntwrk/midnight-js-network-id` (used directly by the ported tests) and `vitest` are declared as family devDependencies.
- *Compact include (D7/D8 realized):* `scripts/stage-core-compact.mjs` resolves the **published** `@midnight-ntwrk/credential-compact/credentials.compact` subpath and stages `credentials.compact` + the `credentials/` tree into a git-ignored local include path (`core-compact-staging/`); the contract `include`s it via `"../core-compact-staging/credentials"`. Fresh `compact compile` (0.30.0) reproduces managed code **byte-identical** to the prototype's canonical output (modulo the stripped `sourceMappingURL` and the aligned runtime version). `ensure-compact-package-aliases.mjs` was dropped (D8); `find-repo-root.mjs`, `align-runtime-version.mjs`, and `strip-managed-sourcemaps.mjs` were adapted/ported. (`strip-managed-sourcemaps.mjs` was hardened beyond the monorepo original: it now deletes the managed `.js.map` files, not just the `sourceMappingURL` comment, so the build's `cp -R src/managed dist` cannot carry a managed source map into the published tarball — required by the package-distribution spec's "Complete, publishable tarball" requirement; verified in group 7.)
- *Turbo + nix devshell:* turbo 2.10.7 filters non-declared env from task subprocesses, so `turbo.json` declares `globalEnv: ["COMPACT_DIRECTORY", "COREPACK_HOME"]` so the flake-provided compact toolchain and corepack reach the `compact`/`tsc`/`vitest` tasks.

**Group 5/6 realization (CI lanes + consumer smoke):**

- *CI shape (`repository-toolchain`):* `.github/workflows/ci.yml` runs the full contract — typecheck + lint + build + test (`pnpm run all`, the root turbo pipeline) plus the consumer smoke round-trip. It is **un-gated**: the `verify` and `smoke` jobs run on every push/PR (there is no `rc-gate` job). A reusable composite action (`.github/actions/setup-node-pnpm/action.yml`, mirroring the midnight-did precedent) enables Corepack, installs Node 24 (`.nvmrc`) with the pnpm store cache, installs the Compact compiler via `midnightntwrk/setup-compact-action@43f89f9…` (SHA-pinned, `COMPACT_COMPILER_VERSION: 0.30.0`, identical to the flake pin), verifies it (`compact compile --version`), and runs `pnpm install --frozen-lockfile`. The compiler version is declared in workflow `env` and flows into the compact setup; the pnpm store is cached by `actions/setup-node` keyed on `pnpm-lock.yaml`. The security-hygiene lanes (`dependency-review.yml`, `scorecard.yml`, template `scan.yaml`) run regardless.
- *Consumer smoke (`package-distribution: Consumer consumability evidence`):* `packages/smoke-consumer/scripts/smoke.mjs` packs the built family tarball (`pnpm --filter <family> pack --pack-destination <isolated>`, which runs `prepack`/build), creates a clean project, installs the tarball with registry-only transitive resolution (`pnpm add <tarball> @midnight-ntwrk/midnight-js-network-id`), and runs `round-trip.mjs` which imports **all four** public entry points and exercises issuance→presentation→verification via the pure circuits plus both compact-value codec round-trips. Because `@midnight-ntwrk/credential-compact` and `@midnight-ntwrk/compact-runtime` are both published, every dependency (family + core + runtime) resolves from the npm registry in the isolated project — this is a **genuine registry-resolution proof**, **not** a tarball-staged workaround; there is no `CORE_RC_TARBALL`/`pnpm.overrides` machinery. The smoke tarball and isolated project are created under the system temp dir and removed in a `finally`, leaving no artifacts.
