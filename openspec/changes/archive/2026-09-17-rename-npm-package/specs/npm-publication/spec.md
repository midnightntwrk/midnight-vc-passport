# npm-publication delta — trusted-publisher mapping follows the package rename

Applies against the base spec as it exists after the `npm-trusted-publishing` change is archived (its "Trusted-publisher configuration prerequisite" requirement must already be in the base). See design.md sequencing.

## MODIFIED Requirements

### Requirement: Trusted-publisher configuration prerequisite

The publication workflow SHALL fail closed at the publish step — publishing nothing — unless npm Trusted Publishing is available to it: the npmjs Trusted Publisher mapping for `@midnight-ntwrk/midnight-vc-passport` (organization `midnightntwrk`, repository `midnight-verifiable-credential-digital-passport`, workflow filename `publish.yml`, GitHub environment `npm-release`) created by npm organization owners, and the protected `npm-release` GitHub environment configured by repository owners. No npm token secret SHALL be provisioned, referenced, or required. The publication runbook SHALL name both owner actions as prerequisites, and the repository's tooling SHALL NOT attempt registry administration (access grants or dist-tag repair) that the trusted-publishing identity cannot perform.

#### Scenario: Missing trusted-publisher mapping fails closed

- **WHEN** a publication is dispatched before the npmjs Trusted Publisher mapping exists
- **THEN** the publish step fails without publishing anything to the registry

#### Scenario: Protected environment gates the publish job

- **WHEN** the publish job starts
- **THEN** it runs only inside the protected `npm-release` environment, whose configuration requires reviewers, prevents self-review, and allows only the `main` and `develop` branches
