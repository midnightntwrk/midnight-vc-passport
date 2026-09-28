# midnight-vc-passport

[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/midnightntwrk/midnight-vc-passport/badge)](https://scorecard.dev/viewer/?uri=github.com/midnightntwrk/midnight-vc-passport)

The standalone home of the **digital-passport verifiable credential family** for
Midnight. This is the first credential family to graduate out of the
[`midnight-verifiable-credentials`](https://github.com/midnightntwrk/midnight-verifiable-credentials)
monorepo into an independent repository with its own ownership, versioning, and
release train. Consumers install it as a normal npm package; there is no
source-level coupling to the monorepo.

- **Head package:** [`@midnight-ntwrk/midnight-vc-passport`](packages/midnight-vc-passport)
  — the credential family: five committed claims, selective disclosures, an
  age-over-threshold predicate, presentation requests, validation circuits,
  explicit holder binding, no-status binding, and the protocol model.
- **On-chain identifiers** (unchanged by the package rename): `midnight:vc:digital-passport`
  and `digital-passport:v1`.
- **Status:** `reference` maturity. The package manifest is publishable; the
  first registry release is cut by a separate release change.

## Installation

> **Interim distribution:** npmjs publication is not yet available (the
> npmjs Trusted Publisher mapping is pending), so releases are currently
> installed from their versioned GitHub Release URL — see
> [Installing from GitHub Releases (interim)](#installing-from-github-releases-interim)
> below. The npmjs install path below applies once the first registry
> publication succeeds.

Install the published release-candidate line (the first stable `0.1.0`
follows from `main` once the rc line is verified):

```sh
npm install @midnight-ntwrk/midnight-vc-passport@rc
```

> **Live version:** nothing is on npmjs yet. The latest release candidate
> is `0.1.0-rc2`, distributed through its
> [GitHub Release](https://github.com/midnightntwrk/midnight-vc-passport/releases/tag/v0.1.0-rc2)
> (see the interim install section below). Once npmjs publication succeeds,
> the rc line is served under the `rc` dist-tag and `latest` stays untouched
> until the stable release — see the
> [publication runbook](docs/guides/npmjs-publication.md) for the release
> train (channels, branch rules, dist-tags, trusted publishing, and
> rollback).

## Installing from GitHub Releases (interim)

While the npmjs Trusted Publisher mapping is not configured (see the
[publication runbook](docs/guides/npmjs-publication.md#github-release-distribution-window)),
every `rc`/`release` publication is also published as a GitHub Release
carrying the packed tarball, a `SHA256SUMS` file, the SPDX SBOM, the
package-contract report, and build-provenance attestations. Any downstream
repository can consume it without waiting for the registry: pin the
**versioned** release-download URL directly in your manifest's
`dependencies`:

```json
{
  "dependencies": {
    "@midnight-ntwrk/midnight-vc-passport": "https://github.com/midnightntwrk/midnight-vc-passport/releases/download/v0.1.0-rc2/midnight-ntwrk-midnight-vc-passport-0.1.0-rc2.tgz"
  }
}
```

The URL pattern is
`https://github.com/midnightntwrk/midnight-vc-passport/releases/download/v<version>/midnight-ntwrk-midnight-vc-passport-<version>.tgz`.
Then `npm install` / `pnpm install` as usual: the tarball's transitive
dependencies resolve from the public npmjs registry, and your **lockfile
freezes the URL** — installs are reproducible and never silently move. To
upgrade, edit the URL to the newer release (a one-line change) and refresh
the lockfile. Always pin a versioned URL; there is deliberately no
unversioned "latest" convenience URL, so a pinned version can never jump
underneath you.

Notes for consumer tooling:

- A direct URL dependency is a **first-class dependency**, not an exotic
  *sub*dependency — no `blockExoticSubdeps`-style exemption is needed for it.
- A URL dependency carries **no registry publish date**, so registry
  release-age floors (`minimumReleaseAge`-style policies) do not apply to it.

Optional verification (offered, not mandated) after downloading the assets
of a release:

```sh
sha256sum --check SHA256SUMS   # checksums for every release asset
gh attestation verify --repo midnightntwrk/midnight-vc-passport \
  midnight-ntwrk-midnight-vc-passport-0.1.0-rc2.tgz
```

This channel is interim: once npmjs publication succeeds, the usual
`npm install @midnight-ntwrk/midnight-vc-passport` flow becomes the only
documented path, and pinned release URLs keep working until you migrate.

## Repository layout

```
packages/
  midnight-vc-passport/   # the credential family (publishable-ready)
  smoke-consumer/                                    # private consumer boundary evidence
flake.nix                                            # dev shell + hermetic npm-artifacts tarball output
nix/                                                 # offline dependency fetch and per-package tarball derivations
turbo.json                                           # lint / typecheck / build / test / smoke pipeline
```

It is a pnpm + turbo workspace (`packages/*`), mirroring the
[`midnight-did`](https://github.com/midnightntwrk/midnight-did) precedent. The
family package depends only on registry-resolvable semver packages — published
[`@midnight-ntwrk/compact-runtime`](https://www.npmjs.com/package/@midnight-ntwrk/compact-runtime)
and the published contract layer
[`@midnight-ntwrk/credential-compact`](https://www.npmjs.com/package/@midnight-ntwrk/credential-compact)
(the generic VC/VP core from the `credential-*` core split). The generic
Compact-value wire codec is inlined into the family package (no dependency on
the monorepo's openid transport package).

## Development

The reproducible toolchain lives in the Nix flake: Node.js 24, pnpm (via
Corepack, honoring the `packageManager` pin), and the Compact compiler
(**0.31.1**, identical to the CI pin) sourced from the
[`MediaNoxLabs/flake-collection`](https://github.com/MediaNoxLabs/flake-collection)
flake input — the same toolchain packaging the sibling repositories consume —
plus Midnight circuit parameters from the same input, provided to the
compiler through `MIDNIGHT_PP` for offline compilation.

```sh
nix develop            # enter the dev shell (toolchain + circuit params ready)
pnpm install           # install workspace dependencies
pnpm run all           # lint && typecheck && build && test:ci (turbo pipeline)
```

Other useful tasks: `pnpm run smoke` (consumer boundary round-trip),
`pnpm run clean`, `pnpm --filter @midnight-ntwrk/midnight-vc-passport test`.

## Consuming the npm tarballs from another repository

Besides installing the published npm package, downstream repositories can
build the publishable tarballs hermetically from this flake — no local
toolchain, no network during the build:

```sh
nix build github:midnightntwrk/midnight-vc-passport#npm-artifacts
```

The output is a flat directory containing one `.tgz` per publishable
(non-private) workspace package — currently
`midnight-ntwrk-midnight-vc-passport-0.1.0.tgz` —
packed by the same `prepack` pipeline the CI smoke lane exercises (compact
compile, TypeScript build, artifact copies). Dependencies resolve offline from
a lockfile-pinned fixed-output fetch; the Compact compiler and circuit
parameters come from the pinned `MediaNoxLabs/flake-collection` input. A bare
`nix build` works too (`npm-artifacts` is the `default` package), and
`nix flake check` audits the tarball contents (dist output, compact sources,
helper scripts, no managed source maps, version consistency). Adding a new
publishable package under `packages/` flows into this output automatically.

> **Published-core note:** the family's core contract dependency
> `@midnight-ntwrk/credential-compact@0.2.0` is published to npm and is
> built against the same `@midnight-ntwrk/compact-runtime@0.16.0` the family
> pins, so the dependency graph resolves a single shared runtime instance for
> both packages. The manifest is strictly
> registry-clean — dependencies resolve from the registry with no `.core-rc/`
> and no `file:` override anywhere. The workspace carries exactly one
> advisory-driven override (`nanoid@3.3.18`, GHSA-2v37-7h3g-55p8) in the
> dev-tooling chain; it does not touch the publishable manifest or its
> dependency policy. See the package
> [README](packages/midnight-vc-passport/README.md)
> and [design](openspec/changes/extract-digital-passport-credential/design.md) for details.

## Continuous integration

- [`ci.yml`](.github/workflows/ci.yml) — the full contract lane (typecheck,
  lint, build, test) plus the consumer smoke round-trip. The `verify` and `smoke`
  jobs are un-gated and run on every push/PR (`credential-compact` is published,
  so there is no `rc-gate` job); security-hygiene lanes always run.
- [`dependency-review.yml`](.github/workflows/dependency-review.yml),
  [`scorecard.yml`](.github/workflows/scorecard.yml),
  [`scan.yaml`](.github/workflows/scan.yaml) — supply-chain security hygiene.

## Boundary handoff

This repository is the source of truth for the family. The duplicate in the
`midnight-verifiable-credentials` monorepo is frozen migration evidence until a
separate change in that repository deletes it. The criteria authorizing that
deletion are recorded in
[`docs/monorepo-deletion-criteria.md`](docs/monorepo-deletion-criteria.md).

## Related repositories

- [midnight-verifiable-credentials](https://github.com/midnightntwrk/midnight-verifiable-credentials)
  — the generic VC/VP core (now published as `@midnight-ntwrk/credential-compact`
  from the `credential-*` core split) and the extraction source; see the
  [core credentials package](https://github.com/midnightntwrk/midnight-verifiable-credentials/blob/develop-history-2026-08-06/packages/core/primitives/credentials/README.md).
- [midnight-did](https://github.com/midnightntwrk/midnight-did) — the
  pnpm + turbo + flake + CI precedent this repository mirrors.

## License

Apache 2.0 — see [LICENSE](LICENSE).
