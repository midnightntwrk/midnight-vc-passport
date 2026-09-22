## MODIFIED Requirements

### Requirement: Registry-resolvable dependencies

The **publishable manifest** SHALL depend only on packages resolvable from the npm registry at pinned semantic versions — the published contract layer `@midnight-ntwrk/credential-compact` (pinned to `0.2.0-rc1`, the RC built against the same Compact 0.31.1 toolchain and `compact-runtime@0.16.0` the family pins) and `@midnight-ntwrk/compact-runtime` pinned to `0.16.0`. The publishable manifest SHALL contain no `workspace:`, `file:`, git, URL, or sibling-path dependencies, and no dependency on the monorepo's openid package.

The runtime-version guard contract SHALL hold for both code paths that load generated contract code:

- The family's own managed artifacts SHALL carry the compiler-emitted guard for 0.16.0 (see `repository-toolchain`: Native runtime-version guard).
- The published `credential-compact` prebuilt JavaScript SHALL carry its own published guard for `0.16.0`. Because core and family now pin the same runtime, the dependency graph SHALL resolve a single `compact-runtime@0.16.0` instance shared by both packages — no private duplicate runtime instance is staged for the core, and no values cross a runtime-instance boundary.

The family SHALL consume the core's managed contract API through the package specifier the core exports it at (the root export `@midnight-ntwrk/credential-compact`); the core's former `./contract`, `./jubjub`, and `./holder-binding/*` subpath exports no longer exist and SHALL NOT be imported.

#### Scenario: Publishable manifest is registry-clean

- **WHEN** the publishable (family) package manifest is inspected
- **THEN** it declares only registry-resolvable semver dependencies (`credential-compact@0.2.0-rc1`, `compact-runtime@0.16.0`), with no `workspace:`/`file:`/git/URL/sibling-path entries

#### Scenario: Registry resolution confirmed

- **WHEN** the consumer smoke runs in an isolated project with no local-path override
- **THEN** the packed family tarball installs and every dependency (family + core + runtime) resolves from the npm registry

#### Scenario: Single shared runtime instance

- **WHEN** the resolved dependency graph of the family package is inspected
- **THEN** exactly one `compact-runtime` version (0.16.0) is resolved for both the family's managed artifacts and the core's prebuilt JavaScript, and importing both in one process loads them against that shared instance without a version-mismatch error

#### Scenario: Prebuilt core JavaScript imports cleanly

- **WHEN** the `credential-compact` prebuilt JavaScript entry points are imported in a workspace that also depends on compact-runtime 0.16.0
- **THEN** the imports load without a runtime version-mismatch error, against the single shared runtime instance

#### Scenario: Core consumed through its published export surface

- **WHEN** family code imports the core's managed contract API (`Proof`, `VerificationMethodRef`, pure circuits)
- **THEN** the import specifier is the core package root export, and no import references the removed `./contract` or `./jubjub` subpaths

#### Scenario: Family artifacts guard the pinned runtime

- **WHEN** the family's generated managed artifacts are loaded against compact-runtime 0.16.0
- **THEN** the compiler-emitted guard passes without post-build rewriting
