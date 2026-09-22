## MODIFIED Requirements

### Requirement: Registry-resolvable dependencies

The **publishable manifest** SHALL depend only on packages resolvable from the npm registry at pinned semantic versions — the published contract layer `@midnight-ntwrk/credential-compact` and `@midnight-ntwrk/compact-runtime` pinned to `0.16.0`, the runtime version the pinned Compact compiler targets natively. The publishable manifest SHALL contain no `workspace:`, `file:`, git, URL, or sibling-path dependencies, and no dependency on the monorepo's openid package.

The runtime-version guard contract SHALL hold for both code paths that load generated contract code:

- The family's own managed artifacts SHALL carry the compiler-emitted guard for 0.16.0 (see `repository-toolchain`: Native runtime-version guard).
- The published `credential-compact` prebuilt JavaScript SHALL keep its own published guard (`0.15.0` for `0.1.0-rc3`). Because `credential-compact` pins its exact runtime, isolated dependency resolution SHALL provide it its own 0.15.0 runtime instance, so importing that prebuilt JavaScript SHALL NOT throw a version-mismatch error in install, build, test, or consumer-smoke contexts. Values crossing between the two runtime instances (proofs, witnesses, fixture data) SHALL be plain data shapes, not nominal classes shared by reference across the boundary.

#### Scenario: Publishable manifest is registry-clean

- **WHEN** the publishable (family) package manifest is inspected
- **THEN** it declares only registry-resolvable semver dependencies (`credential-compact@0.1.0-rc3`, `compact-runtime@0.16.0`), with no `workspace:`/`file:`/git/URL/sibling-path entries

#### Scenario: Registry resolution confirmed

- **WHEN** the consumer smoke runs in an isolated project with no local-path override
- **THEN** the packed family tarball installs and every dependency (family + core + runtime) resolves from the npm registry

#### Scenario: Prebuilt core JavaScript imports cleanly

- **WHEN** the `credential-compact` prebuilt JavaScript entry points are imported in a workspace that also depends on compact-runtime 0.16.0
- **THEN** the imports load without a runtime version-mismatch error, via the isolated resolution of the core package's own runtime pin

#### Scenario: Family artifacts guard the pinned runtime

- **WHEN** the family's generated managed artifacts are loaded against compact-runtime 0.16.0
- **THEN** the compiler-emitted guard passes without post-build rewriting
