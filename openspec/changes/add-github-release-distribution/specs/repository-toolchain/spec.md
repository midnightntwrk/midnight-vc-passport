# Spec Delta

## MODIFIED Requirements

### Requirement: Continuous integration and publication self-check lanes

The repository SHALL run, on pull requests and pushes to the integration branches (`develop` and `main`), a lane that typechecks, lints, builds, and tests all workspaces, and the same lane SHALL exercise the release tooling test suite. The repository SHALL additionally carry dependency-review, scorecard, and template scan lanes. The scan lane SHALL fail on high-severity findings (fail-closed) and SHALL NOT duplicate the Scorecard pass owned by the dedicated scorecard lane. The security-relevant workflow definitions SHALL be verified by a CI-enforced self-check that asserts every external action is pinned to a full commit SHA, every checkout disables credential persistence, the scan, scorecard, and dependency-review workflows declare the repository's branch policy, and the publication workflow keeps its dispatch-only trigger, branch/channel gate, pinned public npmjs registry, provenance-enabled trusted-publishing publish step, protected `npm-release` environment, absence of npm token secret references, and least-privilege permissions (`contents: read` and `id-token: write`). During the GitHub-Release distribution window (see the `github-release-distribution` capability) the self-check SHALL instead pin the window publication shape exactly — dispatch-only trigger, branch/channel gate, pinned public npmjs registry, the operator `tag` input, the GitHub-Release steps, a tokenless best-effort publish through the protected `npm-release` environment, and permissions exactly `contents: write`, `id-token: write`, and `attestations: write` — until the follow-up removal change restores this clause to its registry-only form.

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

- **WHEN** the publication workflow gains a push-event trigger, loses its branch/channel gate, points at a non-npmjs registry, disables provenance, or widens its permissions beyond the shape the self-check pins for the active publication mode
- **THEN** the security-workflow self-check fails the CI lane

#### Scenario: Token reference or missing environment fails the self-check

- **WHEN** the publication workflow references an npm token secret, omits the `npm-release` environment, or grants permissions beyond the shape the self-check pins for the active publication mode
- **THEN** the security-workflow self-check fails the CI lane

#### Scenario: Window publication shape passes the self-check

- **WHEN** the GitHub-Release distribution window is active and the publication workflow carries the window shape (the operator `tag` input, the GitHub-Release steps, and permissions exactly `contents: write`, `id-token: write`, `attestations: write`, with the best-effort tokenless publish through the `npm-release` environment)
- **THEN** the security-workflow self-check passes the CI lane while still failing any drift outside the window shape
