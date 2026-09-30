# Spec Delta

## REMOVED Requirements

### Requirement: Continuous integration and publication self-check lanes

**Reason**: Its GitHub-Release window clause and window-shape scenario no longer apply once the window exits; the requirement is restated for the registry-only mandatory publication shape.
**Migration**: Replaced by "Continuous integration and registry-only publication self-check lanes" in this capability.

## ADDED Requirements

### Requirement: Continuous integration and registry-only publication self-check lanes

The repository SHALL run, on pull requests and pushes to the integration branches (`develop` and `main`), a lane that typechecks, lints, builds, and tests all workspaces, and the same lane SHALL exercise the release tooling test suite. The repository SHALL additionally carry dependency-review, scorecard, and template scan lanes. The scan lane SHALL fail on high-severity findings (fail-closed) and SHALL NOT duplicate the Scorecard pass owned by the dedicated scorecard lane. The security-relevant workflow definitions SHALL be verified by a CI-enforced self-check that asserts every external action is pinned to a full commit SHA, every checkout disables credential persistence, the scan, scorecard, and dependency-review workflows declare the repository's branch policy, and the publication workflow keeps its dispatch-only trigger, branch/channel gate, pinned public npmjs registry, provenance-enabled trusted-publishing publish step, protected `npm-release` environment, absence of npm token secret references, and least-privilege permissions (exactly `contents: read` and `id-token: write`). The self-check SHALL additionally assert that the publication is mandatory: no publication or registry-verification step carries `continue-on-error`, no registry-verification step is conditioned on the publish step's outcome, and the workflow carries no `tag` input and no GitHub-Release creation, upload, or attestation step.

#### Scenario: PR lane exercises the full contract

- **WHEN** a pull request changes any workspace
- **THEN** CI runs typecheck, lint, build, and test and fails on any regression

#### Scenario: Develop pushes run the contract lane

- **WHEN** a commit is pushed to `develop`
- **THEN** the CI lane runs the same typecheck, lint, build, and test contract as on `main`, giving pre-dispatch signal for release candidates

#### Scenario: Release tooling regressions fail CI

- **WHEN** the release tooling test suite runs in the CI lane
- **THEN** version computation, catalog, and release-script contract tests fail the lane on any regression

#### Scenario: Security hygiene lanes present

- **WHEN** the repository workflows are inspected
- **THEN** dependency-review, scorecard, and scan workflows exist and are active

#### Scenario: Scan gates on high-severity findings

- **WHEN** the scan lane completes with findings at or above high severity
- **THEN** the scan workflow fails

#### Scenario: Workflow tampering fails CI

- **WHEN** a workflow or composite action references an external action without a full commit SHA, or a checkout step omits `persist-credentials: false`
- **THEN** the security-workflow self-check fails the CI lane

#### Scenario: Publication workflow drift fails CI

- **WHEN** the publication workflow gains a push-event trigger, loses its branch/channel gate, points at a non-npmjs registry, disables provenance, or grants any permission beyond `contents: read` and `id-token: write`
- **THEN** the security-workflow self-check fails the CI lane

#### Scenario: Token reference or missing environment fails the self-check

- **WHEN** the publication workflow references an npm token secret or omits the `npm-release` environment
- **THEN** the security-workflow self-check fails the CI lane

#### Scenario: Best-effort publication fails the self-check

- **WHEN** the publish step or any registry-verification step carries `continue-on-error`, or a registry-verification step is conditioned on the publish step's outcome
- **THEN** the security-workflow self-check fails the CI lane

#### Scenario: Reintroduced GitHub-Release path fails the self-check

- **WHEN** the publication workflow gains a `tag` input or a GitHub-Release creation, upload, or attestation step
- **THEN** the security-workflow self-check fails the CI lane
