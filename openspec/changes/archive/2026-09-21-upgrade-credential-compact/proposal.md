# Proposal

## Why

The `midnight-verifiable-credentials` monorepo published a new RC of the core
contract layer: `@midnight-ntwrk/credential-compact@0.2.0-rc1` (2026-09-18,
vs. the pinned `0.1.0-rc3` from 2026-08-06). The new RC compiles against
Compact 0.31.1 and `compact-runtime@0.16.0` — exactly the toolchain and runtime
this repository already pins — which retires the dual-runtime residency
(rc3's private 0.15.0 runtime instance) that the `package-distribution` spec
required us to re-evaluate consciously at the next core bump. Staying on rc3
would leave the family on a core built by a compiler generation (0.30.0) the
repo no longer ships.

## What Changes

- Bump the publishable manifest dependency
  `@midnight-ntwrk/credential-compact` from `0.1.0-rc3` to `0.2.0-rc1`
  (both registry-pinned, registry-clean; lockfile refreshed).
- **BREAKING** (upstream): the core's `./contract`, `./jubjub`, and
  `./holder-binding/*` subpath exports are removed; the managed contract API
  moved to the root export (`.`). The single source import in
  `src/testing/credential-fixtures.ts` moves to the root specifier.
- **BREAKING** (upstream): `VerificationMethodRef.didContractAddress` renamed
  to `controllerAddress`; `ProtocolMessageEnvelope`,
  `HolderBindingProfile`, `CredentialProtocolFeatures`,
  `noProtocolResponseReference()`, and the generic `Issue`/`Present`
  choreography modules were removed from the core. The family now vendors its
  own protocol-envelope module locally (adapted to the renamed field and the
  hardened core validation) instead of importing them from the staged core
  tree.
- **BREAKING** (upstream): the core status-binding surface lost the no-op
  `assertValidNoStatusBinding` validator; the family's `helpers.compact`
  stops calling it (`NoStatusBinding` remains a core type and stays the
  family's status profile).
- Recompile the family circuit against the new core (managed code is
  committed, so `src/managed/**` regenerates with the new runtime guard
  `checkRuntimeVersion('0.16.0')` and the new type shapes).
- Update fixtures, codecs, codec tests, and docs for the
  `controllerAddress` rename; refresh README/CHANGELOG references from
  `0.1.0-rc3`/`0.15.0` to `0.2.0-rc1`/`0.16.0`.
- `package-distribution` spec delta: version pin updated, the dual-runtime
  isolation requirement is retired (single shared 0.16.0 runtime), and the
  consumed core entry point is restated as the root export.

Note on scheduling: the 7-day `minimumReleaseAge` supply-chain policy makes
`0.2.0-rc1` installable on 2026-09-25. Implementation originally targeted that
date; the change loop was instead authorized to proceed early via a reviewed,
time-boxed `minimumReleaseAgeExclude` entry for
`@midnight-ntwrk/credential-compact@0.2.0-rc1` (inert once the version is older
than the window; droppable in a follow-up cleanup after 2026-09-25).

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `package-distribution`: the "Registry-resolvable dependencies" requirement
  re-pins `credential-compact` to `0.2.0-rc1`; the dual-runtime resolution
  requirement and its import scenario are retired because the new core is
  built against the same `compact-runtime@0.16.0` the family pins; the
  consumed core entry point changes from the `./contract` subpath export to
  the root export.

## Impact

- `packages/midnight-vc-passport/package.json` (dependency pin)
- `pnpm-lock.yaml` (resolution refresh)
- `src/digital-passport-credential.compact` + new local
  `src/digital-passport-credential/protocol-envelope.compact` (vendored
  choreography), `helpers.compact`, `validation.compact` (removed-symbol fixes)
- `src/managed/**` (regenerated; committed)
- `src/testing/credential-fixtures.ts`, `src/codecs.ts`,
  `src/test/codecs.test.ts` (`controllerAddress` rename, root import,
  `noProtocolResponseReference` replacement)
- `packages/smoke-consumer` (round-trip follows fixture/type changes)
- Docs: root `README.md`, package `README.md`/`CHANGELOG.md`,
  `docs/monorepo-deletion-criteria.md`, threat-model references
- Spec: `openspec/specs/package-distribution/spec.md`
