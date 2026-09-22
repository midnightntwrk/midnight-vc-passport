## ADDED Requirements

### Requirement: Publication metadata

The publishable package manifest SHALL carry publication metadata: `publishConfig` with public access and the public npmjs registry, a `repository` field pointing at this repository with the package's directory, a `description`, and `keywords`. The package tarball SHALL include a package-level `CHANGELOG.md` alongside the README and manifest.

#### Scenario: Manifest carries publication metadata

- **WHEN** the publishable package manifest is inspected
- **THEN** `publishConfig.access` is `public`, `publishConfig.registry` is the public npmjs registry, `repository.url` points at this repository with `repository.directory` set to the package path, and `description` and `keywords` are present

#### Scenario: Tarball ships its changelog

- **WHEN** the package tarball is packed
- **THEN** a `CHANGELOG.md` is included next to the README and manifest in the tarball root
