# package-distribution delta — package rename

## MODIFIED Requirements

### Requirement: Package identity

The package SHALL be named `@midnight-ntwrk/midnight-vc-passport` and SHALL live in the workspace under `packages/midnight-vc-passport`. On-chain identifiers of the credential family SHALL remain `midnight:vc:digital-passport` and `digital-passport:v1`, unaffected by package naming.

#### Scenario: Manifest identity

- **WHEN** the package manifest is inspected
- **THEN** the package name is `@midnight-ntwrk/midnight-vc-passport` and no on-chain schema identifier references the npm package name
