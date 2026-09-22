# Monorepo deletion criteria — digital-passport credential family

This document records the criteria that authorize **deletion of the digital-passport
credential family from the `midnight-verifiable-credentials` monorepo** (the
prototype at `packages/prototypes/credential-families/digital-passport`,
`@midnight-ntwrk/midnight-did-credentials-digital-passport`). The monorepo
duplicate is **frozen migration evidence** and is intentionally left in place
during the transition; deletion is performed by a **separate change in the
`midnight-verifiable-credentials` repository**, not by this repository.

This repository is the sole source of truth for the family. The criteria below
are the handoff contract for the monorepo-side deletion change.

## All of the following must hold before the monorepo duplicate is deleted

1. **Core contract layer published.** `@midnight-ntwrk/credential-compact` is
   published to the npm registry at the version this repository pins
   (`0.1.0-rc3`), so the family's registry-clean dependency declaration is
   satisfiable. **SATISFIED** — `credential-compact@0.1.0-rc3` is published.

2. **Registry-resolution consumer smoke is green.** This repository's CI smoke
   lane — with no local-path override — packs the family
   tarball, installs it into a clean project with every dependency resolved from
   the npm registry, imports all public entry points (`.`, `./codecs`,
   `./contract`, `./testing`), and the issuance/presentation/verification +
   codec round-trip passes. (This is the strict form of the boundary proof; see
   `specs/package-distribution/spec.md`, scenario "Registry resolution confirmed
   at core publication".)

3. **No local-path overrides.** This repository's manifest is strictly
   registry-clean — there is no `pnpm.overrides`, no `.core-rc/`, and no `file:`
   override anywhere — and `pnpm install --frozen-lockfile` resolves entirely
   from the registry. **SATISFIED** — the manifest carries no overrides.

4. **Behavioral equivalence during the overlap.** The monorepo prototype's own
   tests still pass at the moment of deletion (no divergence was introduced
   during the transition window), so the graduation is observed to be
   behavior-preserving on both sides.

## What does **not**, by itself, authorize deletion

This repository's consumer smoke is a **registry-resolution** proof: because
`credential-compact@0.1.0-rc3` and `compact-runtime@0.15.0` are published, the
isolated project resolves every dependency from the npm registry (there is no
tarball-staged form, no `CORE_RC_TARBALL`, and no override). The
registry-resolution smoke (criterion 2) is the deletion-authorizing proof, and
it is green from day one.

## Rollback safety

Until every criterion above holds, the monorepo duplicate stays in place, so any
failure of the graduation leaves the status quo intact. The deletion change is
additive in the opposite direction: it removes only the frozen prototype once
this repository has fully and independently proven consumability from the
registry.
