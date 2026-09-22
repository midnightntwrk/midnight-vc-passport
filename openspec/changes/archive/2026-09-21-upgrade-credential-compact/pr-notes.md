# PR notes — upgrade-credential-compact

Lift directly into the PR description. Covers the two PR-description
requirements in tasks 4.1 and 5.5.

## Upstream `credential-compact@0.2.0-rc1` changelog highlights relevant to consumers

- **Toolchain alignment**: compiled with Compact 0.31.1 against
  `compact-runtime@0.16.0` — exactly the toolchain/runtime this repo pins.
  The core's prebuilt JavaScript now carries a `0.16.0` runtime guard (rc3's
  carried `0.15.0`, which was the dual-runtime residency this change retires).
- **BREAKING — export surface**: the `./contract`, `./jubjub`, and
  `./holder-binding/*` subpath exports are removed; the managed contract API
  (codec + contract) is re-exported from the package root.
- **BREAKING — rename**: `VerificationMethodRef.didContractAddress` →
  `controllerAddress`.
- **BREAKING — choreography removed from the core**: `ProtocolMessageEnvelope`,
  `HolderBindingProfile`, `CredentialProtocolFeatures`,
  `noProtocolResponseReference()`, the generic `Issue`/`Present` modules, and
  `assertValidNoStatusBinding` no longer exist upstream. The family vendors
  the envelope layer locally (`src/digital-passport-credential/protocol-envelope.compact`)
  and folds the message choreography into its own modules; `NoStatusBinding`
  remains a core type and stays the family's status profile.
- **Fail-closed validation invariants consumers must respect**:
  - `assertValidVerificationMethodRef` rejects an empty `controllerAddress`
    and an empty `methodId`;
  - presentations must reference the exact credential schema (enforced by the
    core's `relations.compact`);
  - `assertValidCredentialProof` recomputes the canonical credential body
    root before issuer-proof validation.
- New upstream signer-authorization / authority-descriptor circuits exist but
  are **not adopted** by the family in this change (separate future change);
  they enter the family's managed compilation only through the core's include
  graph.

## Circuit-size / artifact drift (task 4.1)

Measured by recompiling the pre-change family sources against rc3 in a
throwaway directory (same compiler, 0.31.1) and comparing with the committed
working-tree regeneration:

| Artifact (managed, `contract/`) | rc3-era | 0.2.0-rc1-era | Δ |
|---|---|---|---|
| `index.js` | 457,083 B | 594,331 B | +137,248 B (~+30%) |
| `index.d.ts` | 45,286 B | 45,231 B | −55 B |

- Growth source: the new core's include graph (`credentials.compact` →
  `composable.compact`) now pulls the `signer-authorization.compact` module
  into the family's managed compilation, and the hardened core validation
  (canonical body-root recomputation, schema-match assertions) inlines more
  core circuit logic. The family's folded choreography replaces the former
  generic `Issue`/`Present` instantiations at roughly constant size.
- Runtime guard: the family's managed guard was and remains
  `checkRuntimeVersion('0.16.0')`; the change is that the core's prebuilt
  JavaScript now guards the same version (previously `0.15.0`).
- Behavior: no family circuit semantics changed beyond the core rename and
  removed-symbol fixes; the full suite (67 tests) and the isolated-consumer
  smoke round-trip pass unchanged at the semantic level.

## package-distribution delta evidence (task 4.2)

- **Registry-clean manifest**: `packages/midnight-vc-passport/package.json`
  declares exactly `@midnight-ntwrk/compact-runtime@0.16.0` and
  `@midnight-ntwrk/credential-compact@0.2.0-rc1`; no `workspace:`/`file:`/
  git/URL/sibling-path entries (task 1.2).
- **Single shared runtime instance**: `pnpm why @midnight-ntwrk/compact-runtime`
  reports one version (0.16.0) shared by the family and the core (task 1.3);
  no `compact-runtime@0.15.0` remains in `pnpm-lock.yaml` (task 4.3).
- **Root-export import only**: fixtures import `Proof`/`VerificationMethodRef`/
  `pureCircuits` from the `@midnight-ntwrk/credential-compact` root; the
  straggler grep (task 3.3) finds no `./contract` subpath or
  `didContractAddress` references (task 3.1).
- **Consumer install + round trip**: the isolated smoke installed the packed
  family tarball with registry-only transitive resolution and ran the
  issuance/presentation/verification + codec round-trips green (task 3.4).
- **Family guard passes**: family managed artifacts load against
  compact-runtime 0.16.0 without post-build rewriting (task 2.4 audit;
  exercised by every test/smoke import).

## Addendum (PR review follow-up): the smoke lane enforces the release-age floor

The isolated consumer smoke originally stripped every
`npm_config_*release*age*` variable from the child install environment, which
silently disabled the repository's seven-day release-age floor
(`repository-toolchain` — "Supply-chain hardened dependency installation")
for every package the smoke resolved from the registry. As of this PR the
smoke lane instead enforces the floor in the child install:

- leaked lifecycle-env policy variables are still stripped (an env var would
  override the child's own policy, and pnpm cannot carry the exclusion list
  through the environment), and
- the workspace's `minimumReleaseAge` + `minimumReleaseAgeExclude` are read
  live via `pnpm config get` and written into the isolated project's own
  `pnpm-workspace.yaml`, so the child install applies the same floor with the
  same reviewed, time-boxed exemptions (including
  `@midnight-ntwrk/credential-compact@0.2.0-rc1`, inside the seven-day window
  until 2026-09-25).

Verified against a freshly published package: the isolated install accepts a
version on the mirrored exclusion list and rejects an equally fresh version
without it — the floor is real in the child, not stripped.
