# @midnight-ntwrk/midnight-verifiable-credential-digital-passport

> Maturity: `reference`
> Package class: `dist`

Digital-passport credential family for the generic Midnight VC/VP core.

This package was extracted from the `midnight-verifiable-credentials` monorepo
(prototype `@midnight-ntwrk/midnight-did-credentials-digital-passport`) into this
independent repository as the single source of truth for the digital-passport
credential family. On-chain identifiers are unchanged by the rename.

Status:

- reference implementation

Tier:

- credential-family package

Dependency direction:

- depends on reusable core packages (`@midnight-ntwrk/compact-runtime@0.16.0` and
  the published `@midnight-ntwrk/credential-compact` contract layer)
- may be composed by Layer 3 contracts and Layer 4 adapters
- does not depend on protocol/orchestration packages, demos, or standalone
  integration harnesses

Reusable outside this repo:

- yes (consumed as a normal npm package; see the [consumer evidence](#consumer-evidence) note below)

Surface classification:

- `On-chain + off-chain`
- `src/digital-passport-credential.compact` is the authoritative contract-authoring surface
- generated/runtime TypeScript exports are off-chain mirrors only
- `./testing` is an `Off-chain only` fixture surface for integration tests
- example:
  `import { createDigitalPassportFixtureForParticipants } from "@midnight-ntwrk/midnight-verifiable-credential-digital-passport/testing";`

## Purpose

This package defines the digital-passport credential family on top of the
generic
[`credentials`](https://github.com/midnightntwrk/midnight-verifiable-credentials/blob/develop-history-2026-08-06/packages/core/primitives/credentials/README.md)
core package.

It owns the schema-specific parts that should not live in the generic core:

- digital-passport claim commitments (five committed claims)
- digital-passport schema validation
- typed digital-passport presentation requests
- first-name, last-name, document-number, and issuing-state selective disclosure
- age-over-threshold predicate validation

## Claim Schema

The family defines exactly five claims, all stored exclusively as commitments
(`NoPublicClaims` — no raw claim bytes ever appear in the credential body):

| Field | Compact Type | Representation | Notes |
|---|---|---|---|
| `firstName` | `Bytes<64>` | committed | Text-padded to 64 bytes; revealed on request via `revealFirstName` |
| `lastName` | `Bytes<64>` | committed | Text-padded to 64 bytes; revealed on request via `revealLastName` |
| `dateOfBirth` | `Uint<32>` | committed + predicate-only | Days since Unix epoch; supports the age-over-threshold predicate without revealing the date |
| `documentNumber` | `Bytes<32>` | committed (nullable) | Revealed on request via `revealDocumentNumber`; may be absent, represented by a sentinel null commitment |
| `issuingState` | `Bytes<32>` | committed | Revealed on request via `revealIssuingState` |

Schema identifiers (unaffected by the npm package name):

- `packageId = "midnight:vc:digital-passport"`
- `schemaId = "digital-passport:v1"`
- `majorVersion = 1`

The claim root is a domain-separated persistent hash over the schema tag and all
five claim commitments:

```
persistentHash<Vector<6, Bytes<32>>>([
  pad(32, "midnight:vc:digital-passport:v1"),
  firstNameCommitment,
  lastNameCommitment,
  dateOfBirthCommitment,
  documentNumberCommitment,
  issuingStateCommitment,
])
```

Any altered commitment yields a different root.

### Absent document number (null commitment)

`documentNumber` may be absent. When it is, the credential carries
`documentNumberNullCommitment()` — a hash-domain-separated sentinel that is not
in the range of `persistentCommit`, so no valid `(value, opening)` pair can ever
open it. Validation guards ensure `revealDocumentNumber` is never asserted while
the sentinel is present, and private-parts validation requires the document
number value and opening to be zero-filled.

## Holder Binding

This family uses `ExplicitHolderBinding`: the holder binds their DID
verification method reference directly into the credential and presentation.
The generic core validates the holder binding proof, and the family asserts the
credential and presentation holder bindings match. A presentation produced by a
key different from the bound holder verification method fails validation.

## Status Binding

This family uses `NoStatusBinding`: credentials have no on-chain revocation or
suspension status. Status checking, if needed, is an off-chain concern.

## Disclosures

`DigitalPassportDisclosures` supports five disclosure modes:

| Disclosure | Fields | Description |
|---|---|---|
| `revealFirstName` | `firstNameValuePadded` + `firstNameOpening` | Opens the first-name commitment to reveal the padded text value |
| `revealLastName` | `lastNameValuePadded` + `lastNameOpening` | Opens the last-name commitment to reveal the padded text value |
| `proveAgeOverThreshold` | `ageThresholdYears` | Proves the holder is at least `ageThresholdYears` years old without revealing `dateOfBirth` (requires a current-day witness) |
| `revealDocumentNumber` | `documentNumberValue` + `documentNumberOpening` | Opens the document-number commitment to reveal the value; rejected when the credential carries the null commitment |
| `revealIssuingState` | `issuingStateValue` + `issuingStateOpening` | Opens the issuing-state commitment to reveal the value |

## Presentation Requests

`DigitalPassportPresentationRequest` allows a verifier to request any
combination of the five disclosures:

| Field | Description |
|---|---|
| `requireFirstNameDisclosure` | Require the holder to reveal their first name |
| `requireLastNameDisclosure` | Require the holder to reveal their last name |
| `requireAgeOverThreshold` | Require the holder to prove age over `requestedAgeThresholdYears` |
| `requestedAgeThresholdYears` | Minimum age in years (must be > 0 when `requireAgeOverThreshold` is true, 0 otherwise) |
| `requireDocumentNumberDisclosure` | Require the holder to reveal their document number |
| `requireIssuingStateDisclosure` | Require the holder to reveal their issuing state |
| `verifierChallengeHash` | Anti-replay challenge from the verifier (must be non-empty) |

Request validation enforces that the age threshold is positive exactly when the
age predicate is requested (zero otherwise) and that the verifier challenge is
set. A satisfaction check verifies that a presentation's disclosures match the
request, and that the presentation proof's challenge matches the request
challenge.

## Validation Circuits

Commitment and root circuits:

| Circuit | Purpose |
|---|---|
| `digitalPassportClaimRoot` | Domain-separated claim root from all five commitments |
| `firstNameCommitment` / `lastNameCommitment` / `dateOfBirthCommitment` / `documentNumberCommitment` / `issuingStateCommitment` | Individual commitment circuits |
| `documentNumberNullCommitment` | Deterministic sentinel commitment for an absent document number |

Envelope, request, and presentation circuits:

| Circuit | Purpose |
|---|---|
| `assertValidDigitalPassportSchemaRef` | Validates schema identifiers (`packageId`, `schemaId`, `majorVersion`) |
| `assertValidDigitalPassportPresentationRequest` | Validates request structure and constraints |
| `digitalPassportPresentationRequestFromProtocol` | Normalizes a protocol verification request into the concrete request shape |
| `assertValidDigitalPassportCredential` | Validates the full credential envelope (schema, claim root, no-status binding, holder binding, proof) |
| `assertValidDigitalPassportPresentation` | Validates a presentation and its disclosures against the credential |
| `assertDigitalPassportPresentationSatisfiesRequest` | Checks that a presentation satisfies a verifier-defined request |
| `assertValidDigitalPassportAgePredicate` | Validates the age-over-threshold predicate with a current-day witness |
| `assertValidDigitalPassportCredentialPrivateParts` | Validates private parts (claim values + openings) against the committed claims and root |

Issuance and verification protocol circuits:

| Circuit | Purpose |
|---|---|
| `assertValidDigitalPassportIssuanceOffer` / `assertValidDigitalPassportIssuanceRequest` / `assertDigitalPassportIssuanceRequestMatchesOffer` | Issuance offer/request validation and alignment |
| `assertValidDigitalPassportIssuanceResult` / `assertDigitalPassportIssuanceResultMatchesRequest` | Issuance result validation and request alignment (including private-parts and challenge consistency) |
| `assertValidDigitalPassportVerificationRequestMessage` / `assertValidDigitalPassportVerificationSubmissionMessage` | Verification request/submission message validation |
| `assertDigitalPassportVerificationSubmissionMatchesRequest` | Submission/request alignment (presentation must satisfy the request) |
| `assertValidDigitalPassportVerificationResultMessage` / `assertDigitalPassportVerificationResultMatchesSubmission` | Verification result validation and submission alignment |

## Protocol Model

This family follows the thin-core protocol model (VC/VP types + claim root + the
generic issuance/verification protocol threads):

- `DigitalPassportIssuanceOffer`, `DigitalPassportIssuanceRequest`, `DigitalPassportIssuanceResult`
- `DigitalPassportVerificationRequest`, `DigitalPassportVerificationSubmission`, `DigitalPassportVerificationResult`

The family pins `HolderBindingProfile.explicitDid` for all protocol messages.

## Compact-value codec (inlined)

The package inlines the generic compact-value transport codec
(`compact-value-v1.base64url`, `MCV1` framing) in
`src/internal/compact-value-codec.ts` instead of importing it from a protocol
transport package. The `codecs` surface exposes
`encodeDigitalPassportCredential` / `decodeDigitalPassportCredential` and the
matching proof helpers built on it.

**Bit-compatibility obligation (permanent).** Wallets and verifiers encode and
decode on opposite sides of the wire, so this inlined codec must remain
byte-for-byte compatible with the core implementation's wire format. The ported
conformance test (`src/test/compact-value-codec.test.ts`) is the guard. If the
codec ever diverges from core's wire format, interop breaks silently — any
change here must be validated against the core codec.

## Consumer evidence

This repository ships a private `packages/smoke-consumer` workspace and CI lane
that packs the built tarball, installs it into a clean registry-resolved
environment, imports every public entry point (`.`, `./codecs`, `./contract`,
`./testing`), and runs an issuance/presentation fixture round-trip. Because
`@midnight-ntwrk/credential-compact@0.1.0-rc3` and `@midnight-ntwrk/compact-runtime@0.16.0`
are published, the isolated project resolves every dependency from the npm
registry — a genuine registry-resolution proof. That lane is the boundary proof
that authorizes deletion of the monorepo prototype, and it runs green on every
push/PR.

## Build and test

This repository is a pnpm + turbo workspace with a Nix flake that pins the
Compact compiler (**0.31.1**) and the Midnight circuit parameters, both
sourced from the `MediaNoxLabs/flake-collection` flake input and
pre-populated for offline compilation.

```sh
# one-time: enter the reproducible dev shell (provides node, pnpm, compact toolchain)
nix develop

# from the repository root
pnpm install
pnpm typecheck   # compact compile + tsc --noEmit
pnpm lint
pnpm build       # compact compile + tsc -b + stage dist
pnpm test        # vitest run

# or, scoped to this package
pnpm --filter @midnight-ntwrk/midnight-verifiable-credential-digital-passport build
pnpm --filter @midnight-ntwrk/midnight-verifiable-credential-digital-passport test
```

The core compact contract is consumed through the published
`@midnight-ntwrk/credential-compact` package: `scripts/stage-core-compact.mjs`
resolves its `./credentials.compact` subpath and stages the compact sources into
a local include path before `compact compile`, so the family contract has no
source-level coupling to the monorepo.

## Distribution

The publishable tarball can be produced two ways, and both run the same
`prepack` build pipeline (compact compile + TypeScript build + artifact
copies):

```sh
pnpm --filter @midnight-ntwrk/midnight-verifiable-credential-digital-passport pack
nix build .#npm-artifacts   # hermetic: offline deps, pinned toolchain, flake-supplied circuit params
```

The nix output is a flat directory of `.tgz` tarballs (one per publishable
workspace package); downstream repositories can consume it directly as a
flake input (`nix build github:midnightntwrk/midnight-verifiable-credential-digital-passport#npm-artifacts`),
with the `npm-artifacts-contents` flake check guarding the tarball contents
(dist output, compact sources, scripts, no managed source maps, version
consistency).

## Related docs

The generic VC/VP core this family builds on, and the broader credential
program documentation, live in the
[`midnight-verifiable-credentials`](https://github.com/midnightntwrk/midnight-verifiable-credentials)
monorepo:

- core credentials package: [`packages/core/primitives/credentials/README.md`](https://github.com/midnightntwrk/midnight-verifiable-credentials/blob/develop-history-2026-08-06/packages/core/primitives/credentials/README.md)
- credential specs, profiles, conformance, and the integration surface map are
  maintained in that repository's `docs/` tree.

> Note: the monorepo prototype's README carried relative links into a `docs/`
> tree that is not present at the migration commit (`develop-history-2026-08-06`);
> they are intentionally not reproduced as broken absolute links here. Use the
> monorepo as the authoritative source for those documents.
