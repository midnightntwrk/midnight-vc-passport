# Changelog

All notable changes to the
`@midnight-ntwrk/midnight-verifiable-credential-digital-passport` package will
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
[npmjs publication pipeline](../../docs/guides/npmjs-publication.md): the
first release candidate is `0.1.0-rc1` under the `rc` dist-tag.
