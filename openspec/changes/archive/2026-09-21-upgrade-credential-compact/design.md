# Design

## Context

The family consumes the core contract layer (`@midnight-ntwrk/credential-compact`)
through two channels:

1. **Compile time** — `scripts/stage-core-compact.mjs` stages the exported
   `./credentials.compact` plus its `credentials/` source tree into
   `core-compact-staging/`; `src/digital-passport-credential.compact` does
   `include "../core-compact-staging/credentials"` and imports the core
   modules `VC`, `VP`, `CredentialPresentationRelations`, `Issue`, and
   `Present`.
2. **Runtime/test time** — `src/testing/credential-fixtures.ts` imports
   `Proof`, `VerificationMethodRef`, and `pureCircuits` from the
   `./contract` subpath export.

Diffing the published tarballs (`0.1.0-rc3` vs `0.2.0-rc1`) shows the new RC:

- re-pins `compact-runtime` to `0.16.0` (was `0.15.0`) and is compiled by
  Compact `0.31.1` (was `0.30.0`) — both match this repo's pinned toolchain;
- **removes** the `./contract`, `./jubjub`, and `./holder-binding/*` exports;
  the managed contract API is now re-exported from the package root
  (`dist/index.js` = codec + managed credentials contract);
- **removes** the protocol choreography from the core source surface:
  `protocols.compact`, `issue.compact`, `present.compact`,
  `bindings.compact`, `vc-support.compact`, `protocol-support.compact`, and
  the experimental holder-binding circuits — together with the types/helpers
  `ProtocolMessageEnvelope`, `HolderBindingProfile`,
  `CredentialProtocolFeatures`, `noProtocolResponseReference()`,
  `assertValidProtocolMessageEnvelope`, `assertProtocolResponseEnvelope`, and
  the no-op `assertValidNoStatusBinding`;
- **renames** `VerificationMethodRef.didContractAddress` to
  `controllerAddress` and hardens `assertValidVerificationMethodRef`
  (rejects empty controller address and methodId);
- keeps `NoStatusBinding` and `ExplicitHolderBinding` (the only holder
  binding profile the family uses);
- hardens `assertValidCredentialProof` to recompute the canonical credential
  body root before issuer-proof validation, binds presentations to the exact
  credential schema (`relations.compact`), and adds signer-authorization
  circuits (new `signer-authorization.compact`) the family does not need yet.

Only `credential-fixtures.ts` (root `./contract` import), `codecs.ts`, and
`src/test/codecs.test.ts` touch the renamed field; the family's local
`helpers.compact` and `validation.compact` call removed core symbols.

`src/managed/**` is committed and regenerates on every `compact` run, so the
recompile lands as a reviewed commit. The new managed code emits
`checkRuntimeVersion('0.16.0')`, matching the family manifest pin.

The 7-day `minimumReleaseAge` policy (`pnpm-workspace.yaml`) makes
`0.2.0-rc1` (published 2026-09-18) installable on **2026-09-25**. The change
loop was authorized to start early via a reviewed, time-boxed
`minimumReleaseAgeExclude` entry for the exact version (inert after the window
passes; droppable in cleanup) instead of holding the tree for four days.

## Goals / Non-Goals

**Goals:**

- Consume the core at `0.2.0-rc1` with the repo's registry-clean,
  pinned-semver publication contract intact.
- Retire the dual-runtime residency (rc3's private 0.15.0 instance) and the
  spec language that carried it — the re-evaluation the previous change
  deferred to "the next bump".
- Keep the family's public protocol message shapes (offer/request/result,
  request/submission/result) stable in layout, renaming only the embedded
  `VerificationMethodRef` field the core rename forces.
- Keep the fixture-driven test and smoke-consumer round-trip green.

**Non-Goals:**

- Adopting the new core signer-authorization / authority-descriptor circuits
  (separate future change).
- Switching the build off the `stage-core-compact.mjs` staging fallback
  (package-include syntax confirmation remains a separate spike).
- Restoring or vendoring removed experimental holder bindings (secret,
  blinded, pseudonym, same-holder).
- Any change to the family's circuit semantics beyond what the core rename
  and removed-symbol fixes force.

## Decisions

- **D1 — Vendor the protocol envelope layer locally.** The core dropped the
  generic `Issue`/`Present`/protocol-envelope choreography. The family's
  protocol message types and alignment circuits move into a new local module
  `src/digital-passport-credential/protocol-envelope.compact` (envelope
  struct, `HolderBindingProfile`, `CredentialProtocolFeatures`,
  `noProtocolResponseReference()`, envelope validation, response-alignment
  helpers), adapted from the last published core sources with the
  `controllerAddress` rename applied. `issue`/`present` message structs and
  alignment circuits are folded into the family's existing
  `protocol-model.compact`/`validation.compact` rather than kept as verbatim
  copies of dead upstream code. Rationale: the upstream removed them as
  "family concern"; the family already owns its body types. Alternative
  considered — pinning the old core — rejected (breaks the toolchain/runtim
  alignment goal and keeps the 0.15.0 dual runtime).

- **D2 — Core import specifier moves to the package root.**
  `credential-fixtures.ts` imports `Proof`, `VerificationMethodRef`, and
  `pureCircuits` from `@midnight-ntwrk/credential-compact` (root). The root
  also exports the core's compact-value codec; it is tree-shakeable and
  unused by the family (the family inlines its own codec per the extract
  change). No deep import into `dist/managed/**` (not exported).

- **D3 — `noProtocolResponseReference` becomes a local circuit.** The
  fixtures and `validation.compact` use it as the "no response" sentinel;
  the vendored envelope module keeps the same deterministic padded-constant
  implementation so existing fixtures and codec vectors stay byte-stable.

- **D4 — `assertValidNoStatusBinding` call sites are removed, not
  reimplemented.** The core kept the `NoStatusBinding` unit struct but
  dropped its no-op validator; `helpers.compact` simply stops calling it
  (an empty struct has nothing to validate). The family's status profile
  stays `NoStatusBinding`; no registry-bound adoption in this change.

- **D5 — Fixtures adopt the renamed field without semantic change.**
  `contractAddress(label)` (sha256-derived 32 bytes) moves under
  `controllerAddress`; the non-empty guarantee now also satisfies the new
  core validation. Codec encoders/decoders and their test vectors rename the
  key accordingly; because the codec's Compact-value encoding hashes field
  names structurally (no wire-format change), round-trip vectors change only
  in the TypeScript-level object shape.

- **D6 — Recompile and audit the managed diff.** `src/managed/**` regenerates
  via `pnpm run compact` (0.31.1). The repo git-ignores generated managed code
  (`**/managed/`), so the recompile lands as a locally reviewed working-tree
  diff rather than a commit; CI regenerates it on every build. The audited
  diff is the checkpoint for: new guard `0.16.0`, renamed
  `VerificationMethodRef` shape, schema-match assertions inherited from
  `relations.compact`, and the canonical-body-root validation inherited from
  `vc.compact`. The extra schema-match assertion on presentations is
  behaviorally satisfied by existing fixtures (presentation.schema is copied
  from the credential).

## Risks / Trade-offs

- **Installability window**: `0.2.0-rc1` is inside the 7-day release-age
  window until 2026-09-25. Mitigation: scheduled start; no policy exemption.
- **Silent semantic tightening**: the new core rejects zero/empty
  controller addresses and mismatched presentation schemas, and validates
  the canonical body root. Fixtures are compliant today, but any consumer
  building passports programmatically must respect the new invariants —
  called out in the package CHANGELOG entry.
- **Vendored choreography drift**: the family now owns envelope validation
  logic the core used to maintain. Mitigation: the vendored module is small,
  documented as family-owned, and covered by the existing validation tests;
  a future core re-introduction of choreography can be adopted then.
- **Root-import surface growth**: importing the core root also exposes its
  codec. Accepted: side-effect-free ESM, type-level only where possible.
