## Purpose

Defines the npm package contract of the digital-passport credential family: its identity, public export surface, dependency policy, inlined wire-format codec, tarball completeness, and the evidence that an external consumer can install and use it as a normal npm package.

## Requirements

### Requirement: Package identity

The package SHALL be named `@midnight-ntwrk/midnight-verifiable-credential-digital-passport` and SHALL live in the workspace under `packages/midnight-verifiable-credential-digital-passport`. On-chain identifiers of the credential family SHALL remain `midnight:vc:digital-passport` and `digital-passport:v1`, unaffected by package naming.

#### Scenario: Manifest identity

- **WHEN** the package manifest is inspected
- **THEN** the package name is `@midnight-ntwrk/midnight-verifiable-credential-digital-passport` and no on-chain schema identifier references the npm package name

### Requirement: Public export surface

The package SHALL expose exactly these entry points: the root entry (family contract types, codecs, and contract module — excluding fixtures), `./codecs`, `./contract`, and `./testing`. Every documented entry point SHALL resolve through the manifest exports map. Fixtures SHALL NOT be re-exported from the root entry.

#### Scenario: Every advertised subpath resolves

- **WHEN** a consumer imports the root entry, `./codecs`, `./contract`, or `./testing` of the packed package
- **THEN** each import resolves and loads

#### Scenario: Root stays fixture-free

- **WHEN** a consumer imports only the root entry
- **THEN** no fixture module is loaded or required

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

### Requirement: Inlined compact-value codec

The generic compact-value codec (encoding `compact-value-v1.base64url`, `MCV1` framing) SHALL be inlined into the package together with its ported conformance test, replacing the monorepo openid package import. The inlined codec SHALL produce and consume payloads byte-identical to the monorepo core implementation.

#### Scenario: Wire-format compatibility

- **WHEN** a value is encoded with the inlined codec
- **THEN** the payload is decodable by the monorepo core codec, and payloads produced by the core codec decode to the same value via the inlined codec

#### Scenario: Codec conformance suite ported

- **WHEN** the package tests run
- **THEN** the ported codec conformance test passes

### Requirement: Complete, publishable tarball

The package SHALL carry everything needed to consume or rebuild it: compiled distribution output, generated contract exports, the compact contract sources, and the build helper scripts declared in the manifest files list. It SHALL NOT ship source maps of managed generated code or any secret material. The tarball SHALL be producible both by the smoke lane's `pnpm pack` and by the flake's hermetic `npm-artifacts` build; the flake-built tarball SHALL satisfy the same completeness invariants, enforced by a flake check that inspects tarball contents and version consistency.

#### Scenario: Tarball contents sufficient

- **WHEN** the tarball is produced from a clean build, whether by the smoke lane or by the flake `npm-artifacts` output
- **THEN** it contains the dist output, compact sources, and declared scripts, and contains no managed-code source maps

#### Scenario: Flake check rejects an incomplete tarball

- **WHEN** the flake tarball-content check runs against a tarball missing the compiled distribution output or carrying a managed-code source map
- **THEN** the check fails, naming the offending tarball and the violation

### Requirement: Consumer consumability evidence

The repository SHALL include a private consumer workspace and a smoke run that: pack the built package, install the tarball into a clean environment, import every public entry point, and execute a credential fixture round-trip. The publishable manifest resolves its dependencies strictly from the npm registry — `@midnight-ntwrk/credential-compact` and `@midnight-ntwrk/compact-runtime` are both published, so the smoke is a genuine registry-resolution proof (no tarball staging, no overrides). This evidence establishes that the family is consumable as a normal npm package; authorizing deletion of the monorepo duplicate is a separate change in `midnight-verifiable-credentials`.

#### Scenario: Smoke round-trip

- **WHEN** the smoke runs against the built tarball in an isolated project with every dependency resolved from the npm registry
- **THEN** installation succeeds, every public entry point imports, and an issuance/presentation fixture round-trip validates

### Requirement: Provenance headers

Every ported source file SHALL carry an SPDX header block naming this repository. Existing headers naming other repositories SHALL be corrected during the port. Header changes SHALL be comment-only.

#### Scenario: Headers name this repository

- **WHEN** any source file of the ported package is inspected
- **THEN** its SPDX header names `midnight-verifiable-credential-digital-passport` and no source file carries a header naming another repository
