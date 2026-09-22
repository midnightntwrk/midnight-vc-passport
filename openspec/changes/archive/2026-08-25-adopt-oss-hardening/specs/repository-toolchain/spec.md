## MODIFIED Requirements

### Requirement: Continuous integration lanes

The repository SHALL run, on pull requests and pushes to the integration branch, a lane that typechecks, lints, builds, and tests all workspaces. The repository SHALL additionally carry dependency-review, scorecard, and template scan lanes. The scan lane SHALL fail on high-severity findings (fail-closed) and SHALL NOT duplicate the Scorecard pass owned by the dedicated scorecard lane. The security-relevant workflow definitions SHALL be verified by a CI-enforced self-check that asserts every external action is pinned to a full commit SHA, every checkout disables credential persistence, and the scan, scorecard, and dependency-review workflows declare the repository's branch policy.

#### Scenario: PR lane exercises the full contract

- **WHEN** a pull request changes any workspace
- **THEN** CI runs typecheck, lint, build, and test and fails on any regression

#### Scenario: Security hygiene lanes present

- **WHEN** the repository workflows are inspected
- **THEN** dependency-review, scorecard, and scan workflows exist and are active

#### Scenario: Scan gates on high-severity findings

- **WHEN** the scan lane completes with findings at or above high severity
- **THEN** the scan workflow fails

#### Scenario: Workflow tampering fails CI

- **WHEN** a workflow or composite action references an external action without a full commit SHA, or a checkout step omits `persist-credentials: false`
- **THEN** the security-workflow self-check fails the CI lane

## ADDED Requirements

### Requirement: Supply-chain hardened dependency installation

The repository's package installation SHALL enforce a release-age floor for registry packages (minimum seven days before a published version is installable), SHALL block exotic-URL subdependencies, and SHALL apply a no-downgrade trust policy, all declared in the workspace configuration. Dependencies whose build scripts are not on the declared allowance list SHALL NOT execute installation scripts. Exceptions to the release-age floor or trust policy SHALL be enumerated explicitly in the workspace configuration so every exemption is visible in review.

#### Scenario: Freshly published dependency is rejected

- **WHEN** an install resolves a registry package version published less than the release-age floor ago and that version is not on the exclusion list
- **THEN** the installation fails

#### Scenario: Frozen install remains reproducible

- **WHEN** `pnpm install --frozen-lockfile` runs with the hardened settings enabled on the current lockfile
- **THEN** the installation succeeds without policy rejections

#### Scenario: Undeclared build scripts do not run

- **WHEN** a dependency ships an installation build script and is not on the declared build-script allowance list
- **THEN** its build script is skipped during installation

### Requirement: Dependency update automation

The repository SHALL carry automated dependency update lanes for both the npm and github-actions ecosystems, active on the default branch, each applying a release-age cooldown before proposing a newly published version. The repository SHALL additionally declare a Renovate configuration extending the organization's shared preset so grouped Midnight-stack updates follow org-wide policy. Where the repository integrates on a branch other than the default branch, these update-lane and Renovate configurations SHALL be complete on the integration branch so both bots adopt them at default-branch promotion without further configuration changes.

#### Scenario: Runtime dependency updates are proposed

- **WHEN** a newer version of an npm dependency satisfying the cooldown is available
- **THEN** the update automation opens a pull request proposing the bump against the default branch

#### Scenario: Workflow action updates are proposed

- **WHEN** a newer version of a pinned GitHub Action is available
- **THEN** the update automation opens a pull request proposing the SHA-pinned bump

### Requirement: Vulnerability exception governance

Every vulnerability ignored by the scanner SHALL be recorded in the tracked scanner configuration with an expiry date and a reason linking to a documentation entry that names an accountable owner. A CI check SHALL fail when the scanner configuration contains an ignored vulnerability that is undocumented, unowned, expired, or whose documentation and configuration disagree. An empty ignore list SHALL pass the check.

#### Scenario: Ignored finding is documented and owned

- **WHEN** the scanner configuration ignores a vulnerability
- **THEN** the documentation contains a matching section with an accountable owner and an expiry date on or after the configuration's expiry, and the CI check passes

#### Scenario: Undocumented ignore fails CI

- **WHEN** the scanner configuration ignores a vulnerability with no matching documentation section, or with an expiry date in the past
- **THEN** the vulnerability-exception check fails the CI lane
