## Why

The published package name `@midnight-ntwrk/midnight-verifiable-credential-digital-passport` (63 characters) makes import specifiers unwieldy for consumers (e.g. `@midnight-ntwrk/midnight-verifiable-credential-digital-passport/codecs`) and is error-prone to type and read in docs, scripts, and runbooks.

The cost of renaming is currently zero: the name has never been published to the npm registry (verified: `npm view` returns E404, no versions, no downloads), so there is no deprecation cycle, no consumer breakage, and no version-history to preserve. Renaming later — after a public release exists — would be strictly more expensive.

## What Changes

- The package is renamed to `@midnight-ntwrk/midnight-vc-passport` (verified available on npm).
- The package directory moves from `packages/midnight-verifiable-credential-digital-passport` to `packages/midnight-vc-passport`.
- All references to the old package name are updated across consumer scripts, publish tooling, docs, and specs.
- The npmjs Trusted Publisher mapping prerequisite is restated for the new package name (the mapping is name-bound; it must be created for `@midnight-ntwrk/midnight-vc-passport` before first release).
- The package version remains `0.1.0` — the first release simply publishes under the new name.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `package-distribution`: the "Package identity" requirement changes — new package name and workspace directory; on-chain identifiers remain unaffected (as the requirement already guarantees).
- `npm-publication`: the "Trusted-publisher configuration prerequisite" requirement changes — the npmjs Trusted Publisher mapping names the new package. This delta applies against the post-archive base of the `npm-trusted-publishing` change, which must be archived first (see design.md sequencing).

## Impact

- `packages/midnight-vc-passport/package.json` (name, repository.directory)
- `packages/smoke-consumer/scripts/round-trip.mjs` (import specifiers), `packages/smoke-consumer/scripts/smoke.mjs` (`FAMILY` constant)
- `tooling/scripts/test-release-package-consumers.mjs` (`FAMILY` constant), `tooling/scripts/publish-npm-packages.sh`, `tooling/scripts/wait-for-npm-packages.mjs`
- Docs: root README, package README, `docs/guides/npmjs-publication.md`, `docs/security/digital-passport-threat-model.md`, CHANGELOG prose
- Owner action outside the repository: npm organization owners create the Trusted Publisher mapping for the new package name
- Not affected: root workspace `name`, GitHub repository name, SPDX headers (they name the repository, not the package), on-chain identifiers `midnight:vc:digital-passport` / `digital-passport:v1`

Tracked in GitHub issue #47.
