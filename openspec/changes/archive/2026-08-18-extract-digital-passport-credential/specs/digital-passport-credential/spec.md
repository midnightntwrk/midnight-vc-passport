## Purpose

Defines the digital-passport credential family on top of the generic Midnight VC/VP core: commitment-only identity claims, selective disclosures, an age-over-threshold predicate, typed presentation requests, and the validation and protocol surfaces a wallet, issuer, or verifier composes against.

## ADDED Requirements

### Requirement: Commitment-only five-claim schema

The family SHALL define exactly five claims stored exclusively as commitments (`NoPublicClaims`): `firstName` (text padded to 64 bytes), `lastName` (text padded to 64 bytes), `dateOfBirth` (days since Unix epoch, predicate-only), `documentNumber` (with an explicit null-commitment representation), and `issuingState`. The claim root SHALL be a domain-separated persistent hash over the schema tag and the claim commitments.

#### Scenario: Claim root binds all commitments

- **WHEN** a credential's claim commitments are assembled into a claim root
- **THEN** the root equals the domain-separated hash of the schema tag concatenated with each claim commitment, and any altered commitment yields a different root

#### Scenario: No raw claim values in the credential body

- **WHEN** a credential is constructed from private claim values
- **THEN** the credential body contains only commitment digests and no raw claim bytes

### Requirement: Stable schema identifiers

The family SHALL use `packageId = "midnight:vc:digital-passport"`, `schemaId = "digital-passport:v1"`, and `majorVersion = 1`. Schema validation SHALL reject credentials whose identifiers do not match.

#### Scenario: Valid schema reference accepted

- **WHEN** a credential carries the identifiers above
- **THEN** schema validation succeeds

#### Scenario: Foreign schema reference rejected

- **WHEN** a credential carries a different packageId, schemaId, or a mismatched major version
- **THEN** schema validation fails with a schema error

### Requirement: Selective disclosure modes

The family SHALL support three disclosure modes: revealing `firstName`, revealing `lastName`, and proving age over a threshold. Name disclosures SHALL open the corresponding commitment to the padded text value. The age disclosure SHALL prove the holder is at least the requested age in whole years without revealing `dateOfBirth`, using a current-day witness.

#### Scenario: Name disclosure opens the commitment

- **WHEN** a holder produces a first-name or last-name disclosure
- **THEN** the verifier can recover the padded text value and verify it opens the credential's commitment

#### Scenario: Age predicate proves without revealing

- **WHEN** a holder proves age over a threshold for a valid current day
- **THEN** the predicate verifies and the presentation reveals nothing about the date of birth

#### Scenario: Age predicate rejects an underage holder

- **WHEN** the holder's age at the witnessed current day is below the requested threshold
- **THEN** the age predicate validation fails

### Requirement: Typed presentation requests

A verifier SHALL be able to request any combination of the three disclosures. The request SHALL require a non-empty verifier challenge hash. An age request SHALL carry a threshold greater than zero exactly when the age disclosure is requested, and zero otherwise. A satisfaction check SHALL verify that a presentation's disclosures match the request.

#### Scenario: Request validation constraints

- **WHEN** a presentation request omits the challenge hash, or sets an age threshold inconsistently with its age requirement flag
- **THEN** request validation fails

#### Scenario: Presentation satisfies request

- **WHEN** a presentation contains every disclosure the request requires
- **THEN** the satisfaction check passes

#### Scenario: Presentation missing a required disclosure

- **WHEN** a presentation omits a disclosure required by the request
- **THEN** the satisfaction check fails

### Requirement: Holder and status binding

The family SHALL use explicit holder binding: the holder binds a DID verification-method reference directly into the credential and presentation, and the generic core validates the binding proof. The family SHALL use no status binding: credentials carry no on-chain revocation or suspension status.

#### Scenario: Holder binding enforced

- **WHEN** a presentation is produced by a key different from the bound holder verification method
- **THEN** presentation validation fails

### Requirement: Validation circuits accept valid and reject tampered inputs

The family SHALL provide validation circuits for the credential envelope, private parts, presentation request, presentation, issuance and verification protocol messages, and cross-message consistency. Every circuit SHALL accept conforming inputs and SHALL reject tampered inputs.

#### Scenario: Tampered credential rejected

- **WHEN** any field of a valid credential is altered after issuance
- **THEN** credential validation fails

#### Scenario: Protocol consistency enforced

- **WHEN** an issuance result's challenge no longer matches its request, or a verification submission does not match its request
- **THEN** the corresponding consistency assertion fails

### Requirement: Behavioral equivalence with the monorepo prototype

The extracted family SHALL be behaviorally identical to the monorepo prototype at `develop-history-2026-08-06`: the same compact contract sources (modulo license headers and the compact include path), the same circuits, and the full ported test suite passing unchanged in expectations.

#### Scenario: Ported test suite green

- **WHEN** the family package is built and its tests run in this repository
- **THEN** every test ported from the monorepo prototype passes without modified expectations
