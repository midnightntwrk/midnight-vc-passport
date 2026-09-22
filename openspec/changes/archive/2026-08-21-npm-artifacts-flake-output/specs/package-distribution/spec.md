## MODIFIED Requirements

### Requirement: Complete, publishable tarball

The package SHALL carry everything needed to consume or rebuild it: compiled distribution output, generated contract exports, the compact contract sources, and the build helper scripts declared in the manifest files list. It SHALL NOT ship source maps of managed generated code or any secret material. The tarball SHALL be producible both by the smoke lane's `pnpm pack` and by the flake's hermetic `npm-artifacts` build; the flake-built tarball SHALL satisfy the same completeness invariants, enforced by a flake check that inspects tarball contents and version consistency.

#### Scenario: Tarball contents sufficient

- **WHEN** the tarball is produced from a clean build, whether by the smoke lane or by the flake `npm-artifacts` output
- **THEN** it contains the dist output, compact sources, and declared scripts, and contains no managed-code source maps

#### Scenario: Flake check rejects an incomplete tarball

- **WHEN** the flake tarball-content check runs against a tarball missing the compiled distribution output or carrying a managed-code source map
- **THEN** the check fails, naming the offending tarball and the violation
