## Why

The digital-passport credential family currently lives inside the `midnight-verifiable-credentials` monorepo as a private prototype (`@midnight-ntwrk/midnight-did-credentials-digital-passport`). Concrete credential families are graduating to independent repositories with independent ownership, versioning, and release trains, while the monorepo retains only reusable, schema-neutral core packages. Digital passport is the first family to graduate, and this repository is its designated home. Consumers (dapp developers) must be able to install the credential family as a normal npm package.

## What Changes

- Establish a pnpm + turbo workspace repository (midnight-did style): private root manifest, `pnpm-workspace.yaml`, `turbo.json`, `flake.nix` dev shell.
- Port the digital-passport credential family from the monorepo state at `develop-history-2026-08-06` into `packages/midnight-verifiable-credential-digital-passport` as a **mechanical migration**: compact contract, generated-code build pipeline, TypeScript sources, tests, and build scripts — with zero behavior changes.
- **BREAKING** (relative to the monorepo prototype identity): the package is renamed to `@midnight-ntwrk/midnight-verifiable-credential-digital-passport` (repo name == head package name, following the midnight-did precedent). On-chain identifiers (`midnight:vc:digital-passport`, `digital-passport:v1`) are unchanged.
- Consume core only through published npm semver: depends on the published `@midnight-ntwrk/credential-compact` contract layer (`credential-compact@0.1.0-rc3`, from the `credential-*` core split) and published `@midnight-ntwrk/compact-runtime@0.15.0`. The generic Compact value codec (currently hosted in the monorepo's openid package) is inlined into this package with its conformance test; no dependency on the openid package.
- Rework the public surface: root entry exports only types/codecs/contract; fixtures move to a first-class `./testing` subpath; the exports map is fixed (today's advertised `./testing` subpath does not exist).
- Fix SPDX headers on all ported sources to name this repository (comments only).
- Reconcile documentation with reality: package README documents all five claims (firstName, lastName, dateOfBirth, documentNumber, issuingState); monorepo doc links become absolute GitHub links. Root README is rewritten for this repository.
- Add consumer evidence: private `packages/smoke-consumer` workspace plus a CI lane that packs the built tarball, installs it cleanly, imports every public subpath, and runs a fixture round-trip. The publishable manifest is **strictly registry-clean** (no overrides anywhere); the smoke is a **genuine registry-resolution proof** — `credential-compact` and `compact-runtime` are both published, so every dependency resolves from npm in the isolated project.
- Add CI: `ci.yml` (pinned compact compiler 0.30.0 via `setup-compact-action`, Node ≥ 24, pnpm ≥ 10, turbo typecheck/lint/build/test), `dependency-review.yml`, `scorecard.yml`; keep template `scan.yaml`.
- Out of scope: release/publish workflows and versioning scheme; behavior cleanups from the monorepo's P1-3 backlog (calendar age model, normalization-aware text encoding, status profile declaration, ICAO/transliteration semantics) — these become follow-up changes here; deletion of the monorepo copy — that is a change in `midnight-verifiable-credentials`, gated on this change's consumer evidence.

## Capabilities

### New Capabilities

- `digital-passport-credential`: the credential family semantics — five committed claims, selective disclosures, age-over-threshold predicate, presentation requests, validation circuits, explicit holder binding, no-status binding, protocol model. Migrated unchanged.
- `package-distribution`: the npm package contract — public surface (root, `./codecs`, `./contract`, `./testing`), dependency policy (published semver only), inlined codec bit-compatibility, tarball completeness, and consumer consumability evidence.
- `repository-toolchain`: reproducible development and CI contract — nix dev shell with pinned compact toolchain, pinned compiler version in CI, engine requirements, and required CI lanes including security hygiene.

### Modified Capabilities

None (this repository has no existing specs).

## Impact

- **New code**: pnpm workspace root, family package under `packages/`, smoke-consumer workspace, nix flake, CI workflows.
- **External prerequisite**: **SATISFIED** — `@midnight-ntwrk/credential-compact@0.1.0-rc3` is published to npm (the `credential-*` core split). The family pins it as a normal dependency alongside published `compact-runtime@0.15.0`; the consumer smoke resolves every dependency from the registry.
- **Cross-repo contract recorded here**: core-side deletion criteria (RC published, registry-resolution smoke green, monorepo prototype tests still passing during transition) are documented for the follow-up monorepo change.
- **Docs**: root README replaced; package README ported and reconciled; SPDX headers on all sources.
