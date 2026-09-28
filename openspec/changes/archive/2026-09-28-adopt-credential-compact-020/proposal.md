# Proposal

## Why

`midnight-verifiable-credentials` published **VC Core 0.2.0** on 2026-09-25,
promoting `@midnight-ntwrk/credential-compact` from `0.2.0-rc1` (pinned here
since `upgrade-credential-compact`) to the stable `0.2.0` (npm `latest`).
The published tarballs of `0.2.0-rc1` and `0.2.0` were diffed file-by-file:
the only difference is the `version` field in `package.json`. The stable
release keeps `compactCompilerVersion: 0.31.1` and
`compactRuntimeVersion: 0.16.0`, i.e. exactly the toolchain and runtime this
repository pins. Tracking the stable release removes the family's dependency
on a pre-release core ahead of the family's own first stable publication.

Sibling releases reviewed and found to require no change here:

- `midnight-did` 0.7.0 (breaking Jubjub JWK coordinate endianness): this
  repository does not depend on any `midnight-did*` package, directly or
  transitively.
- `credential-model@0.2.0` and `credential-did-midnight@0.2.0` (published
  alongside VC Core 0.2.0): not consumed; the family uses
  `ExplicitHolderBinding`, not the optional Midnight DID binding.
- `compact-runtime@0.19.0`: not adoptable; the runtime must match the pinned
  Compact 0.31.1 compiler, and the core itself pins `0.16.0`.

## What Changes

- Bump the publishable manifest dependency
  `@midnight-ntwrk/credential-compact` from `0.2.0-rc1` to `0.2.0`
  (registry-pinned; lockfile refreshed; single shared
  `compact-runtime@0.16.0` instance preserved).
- Replace the now-inert `0.2.0-rc1` `minimumReleaseAgeExclude` entry with a
  reviewed, time-boxed entry for `@midnight-ntwrk/credential-compact@0.2.0`.
  `0.2.0` clears the 7-day window on 2026-10-02; the entry is justified by the
  byte-identical contents and npm provenance, and is droppable after that
  date.
- Refresh version references in READMEs, the package CHANGELOG,
  `docs/monorepo-deletion-criteria.md`, and the `package-distribution` spec.
  Historical comments that describe what `0.2.0-rc1` removed are left as-is
  (still accurate). Fix a stale comment in
  `src/digital-passport-credential.compact` that named the old
  `midnight-did-credentials` staging source.

No Compact source, TypeScript, or managed-code changes: the staged core
sources are identical.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `package-distribution`: the "Registry-resolvable dependencies" requirement
  re-pins `credential-compact` to the stable `0.2.0`.

## Impact

- `packages/midnight-vc-passport/package.json`, `pnpm-lock.yaml`
- `pnpm-workspace.yaml` (release-age exemption swap)
- Docs: root `README.md`, package `README.md`/`CHANGELOG.md`,
  `docs/monorepo-deletion-criteria.md`
- Spec: `openspec/specs/package-distribution/spec.md`
