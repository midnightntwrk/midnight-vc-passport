## Purpose

Scopes the publication-workflow clause of the CI-lane self-check requirement to the period when the npmjs-registry publication path is active: during the temporary GitHub-Release bridge window (see the `github-release-distribution` capability) the publish step is suspended and the least-privilege publication permissions change shape, so the self-check instead pins the bridge publication shape exactly. Every other CI-lane obligation — lanes, fail-closed scanning, action pinning, checkout hygiene — is untouched, and the bridge-exit change restores the clause to its unconditional form.

## MODIFIED Requirements

### Requirement: Continuous integration lanes

The repository SHALL run, on pull requests and pushes to the integration branches (`develop` and `main`), a lane that typechecks, lints, builds, and tests all workspaces, and the same lane SHALL exercise the release tooling test suite. The repository SHALL additionally carry dependency-review, scorecard, and template scan lanes. The scan lane SHALL fail on high-severity findings (fail-closed) and SHALL NOT duplicate the Scorecard pass owned by the dedicated scorecard lane. The security-relevant workflow definitions SHALL be verified by a CI-enforced self-check that asserts every external action is pinned to a full commit SHA, every checkout disables credential persistence, the scan, scorecard, and dependency-review workflows declare the repository's branch policy, and — when the npmjs-registry publication path is active — the publication workflow keeps its dispatch-only trigger, branch/channel gate, pinned public npmjs registry, provenance-enabled publish, and least-privilege permissions (`contents: read` and `id-token: write`). During the GitHub-Release bridge window (see the `github-release-distribution` capability) the publish step is suspended and the self-check SHALL instead assert the bridge publication shape exactly — dispatch-only trigger, branch/channel gate, pinned public npmjs registry, and the permissions `contents: write`, `id-token: write`, and `attestations: write` — until the bridge-exit change restores this clause to its unconditional form.

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

- **WHEN** the npmjs-registry publication path is active and the publication workflow gains a push-event trigger, loses its branch/channel gate, points at a non-npmjs registry, disables provenance, or widens its permissions beyond the publication needs
- **THEN** the security-workflow self-check fails the CI lane

#### Scenario: Bridge publication shape passes the self-check

- **WHEN** the GitHub-Release bridge is active and the publication workflow carries the bridge shape (no publish step; permissions exactly `contents: write`, `id-token: write`, `attestations: write`)
- **THEN** the security-workflow self-check passes the CI lane while still failing any drift outside the bridge shape
