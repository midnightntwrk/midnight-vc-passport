# Changelog

All notable changes to the
`@midnight-ntwrk/midnight-vc-passport` package will
be documented in this file. Repository-level changes (CI, tooling, docs) are
tracked in the [root changelog](../../CHANGELOG.md); this file tracks what
ships in the published tarball.

The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this package
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Security

- Hardened install posture inherited from the repository: registry-only,
  semver-pinned dependencies with no `workspace:`/`file:`/git/URL entries.

### Changed

- Bumped the core contract dependency to
  **`@midnight-ntwrk/credential-compact@0.2.0-rc1`** (was `0.1.0-rc3`). The
  new RC is compiled with the same Compact 0.31.1 toolchain and pins the same
  `@midnight-ntwrk/compact-runtime@0.16.0` as this package, so the dependency
  graph resolves a single shared runtime instance (the former private 0.15.0
  runtime residency required by rc3 is gone).

- **BREAKING (upstream rename):** `VerificationMethodRef.didContractAddress`
  is now **`controllerAddress`**. Fixtures, codecs, and codec test vectors
  adopt the new key; the codec's Compact-value byte layout is unchanged
  (field names are structural only), so existing encoded payloads remain
  decodable.

- The core removed the generic issuance/presentation choreography
  (`ProtocolMessageEnvelope`, `HolderBindingProfile`,
  `CredentialProtocolFeatures`, `noProtocolResponseReference()`, and the
  generic `Issue`/`Present` modules). The protocol envelope layer is now
  **locally owned** by this package
  (`src/digital-passport-credential/protocol-envelope.compact`, with the
  message structs and alignment circuits folded into
  `protocol-model.compact`); the managed `DigitalPassportIssuance_*` /
  `DigitalPassportVerification_*` type names are unchanged. The core also
  dropped its no-op `assertValidNoStatusBinding` validator;
  `NoStatusBinding` remains the status profile.

- Consumers must respect the new fail-closed core invariants: an empty
  `controllerAddress` (and empty `methodId`) is rejected by
  `assertValidVerificationMethodRef`; presentations must reference the exact
  credential schema; and issuer proofs are validated against the
  **canonical** credential body root recomputed by the core. Fixtures and
  published message shapes already comply; integrators building passports
  programmatically must ensure the same.

- Renamed the package to **`@midnight-ntwrk/midnight-vc-passport`** (workspace
  directory `packages/midnight-vc-passport`). The package was never published
  under the old name, so no deprecation or migration applies; the version
  remains `0.1.0` and the first npmjs release simply publishes under the new
  name. On-chain identifiers (`midnight:vc:digital-passport`,
  `digital-passport:v1`) are unaffected.

- Pinned the Compact toolchain at **0.31.1** (was 0.30.0). Generated managed
  code is unchanged (byte-identical artifacts); the compiler now natively
  targets `@midnight-ntwrk/compact-runtime@0.16.0`.

### Fixed

- Correctness fixes in the digital-passport Compact circuits: the derived
  presentation request now pins its own format version instead of copying the
  transport-envelope version; schema-reference validation pins the family
  `minorVersion` (1.0) alongside the major version; the age-over-threshold
  predicate counts full calendar years (proleptic Gregorian, leap-day aware)
  instead of `threshold * 365` days, which let proofs pass up to ~16 days
  early.

## [0.1.0-rc1] - 2026-09-02

First release candidate of the `0.1.0` line, published through the temporary
[GitHub-Release distribution bridge](https://github.com/midnightntwrk/midnight-verifiable-credential-digital-passport/releases/tag/v0.1.0-rc1)
while the npmjs automation token is pending: install by the versioned
release URL pinned in the package README. The release carries the tarball,
`SHA256SUMS`, the SPDX SBOM, the contract report, and build-provenance
attestations for every asset. No code changes beyond the `0.1.0` scope
below — the candidate exists to exercise the bridged publication pipeline.

## [0.1.0]

Initial release of the digital-passport credential family as a standalone
package, extracted from the
[`midnight-verifiable-credentials`](https://github.com/midnightntwrk/midnight-verifiable-credentials)
monorepo.

### Added

- Five committed claims, selective disclosures, an age-over-threshold
  predicate, presentation requests, validation circuits, explicit holder
  binding, no-status binding, and the protocol model.
- Public entry points: the root entry (family contract types, codecs, and
  contract module), `./codecs`, `./contract`, and `./testing`.
- The generic compact-value wire codec (`compact-value-v1.base64url`, `MCV1`
  framing) inlined from the monorepo core, with its conformance suite.
- Registry-clean dependencies: `@midnight-ntwrk/credential-compact` and
  `@midnight-ntwrk/compact-runtime`.

The `0.1.0` line is cut through the
[npmjs publication pipeline](../../docs/guides/npmjs-publication.md); while
the npmjs automation token is pending, the first release candidate
`0.1.0-rc1` shipped through the temporary GitHub-Release distribution
bridge (see above).
