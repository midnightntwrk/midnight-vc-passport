## Why

The repository became public and now runs as an OSS project, but the security hardening its two sibling repositories already operate was never adopted here: installs have no supply-chain constraints (`minimumReleaseAge`, `blockExoticSubdeps`, `trustPolicy`), runtime dependency updates are effectively disabled (the Dependabot npm lane is commented out and Renovate sits dormant), the Scan lane never gates on findings, the security workflows have no machine-enforced guard against pin or trigger drift, and ignored vulnerabilities have no governance path. `midnight-did` and `midnight-verifiable-credentials` run all of these controls; this change closes the gap by adopting them.

## What Changes

Delivered as three independently landable PR slices (config first, guarded workflows second, threat model third):

**Slice 1 — supply-chain hardened installation and update automation**

- `pnpm-workspace.yaml`: add `blockExoticSubdeps: true`, `minimumReleaseAge: 10080`, `trustPolicy: no-downgrade` (midnight-did values), with `minimumReleaseAgeExclude`/`trustPolicyExclude` lists starting empty, plus explicit `ignoredBuiltDependencies` (initially `esbuild`, `unrs-resolver`) so the currently-silent build-script skipping becomes declared policy. Verified compatible with the current lockfile: clean `pnpm install --frozen-lockfile` under pnpm 10.34.1 with these settings enabled.
- `.npmrc`: add `min-release-age=7`.
- `renovate.json`: activate the installed-but-dormant Renovate app (the `renovate/configure` branch already exists on origin) extending `local>midnightntwrk/renovate-config`, main-only base branch.
- `.github/dependabot.yml`: re-enable the `npm` ecosystem lane (daily, 7-day cooldown) alongside the existing `github-actions` lane — both bots active, sibling-style (activation is staged until `develop` is promoted to the default branch, per design D6/D7).

**Slice 2 — gating scan and self-guarding security workflows**

- `.github/workflows/scan.yaml`: pin `midnightntwrk/upload-sarif-github-action` to `9da05ae8b0dc1b97a0a25f809deb586c06b7ad3e` (newest upstream fix; supersedes midnight-did's `4bbe849` pin), add `fail_severity: "high"` (fail-closed) and `skip_scorecard_scan: "true"`, `persist-credentials: false` on checkout, pin runner to `ubuntu-24.04`. Pre-flight via `workflow_dispatch` before merging so main never goes red on a latent finding.
- CODEOWNERS: extend the `@midnightntwrk/mn-security`/`@midnightntwrk/mn-sre` guard list to `scorecard.yml` and `dependency-review.yml`, and fix the CODEOWNERS dependabot entry to point at the actual config location (`/.github/workflows/dependabot.yml` → `/.github/dependabot.yml`).
- Port `check:security-workflows` from midnight-verifiable-credentials (adapted: branch policy is `main`-only since `develop`/`release/**` do not exist here; `publish.yml` assertions dropped as out of scope) and `check:vulnerability-exceptions`, wired into the existing CI `verify` lane; adds the `yaml` devDependency.
- `osv-scanner.toml` (empty — no ignored vulnerabilities today) paired with `docs/security/vulnerability-exceptions.md`: every future OSV ignore must be documented with accountable owner and expiry date, enforced in CI.
- README: add the OpenSSF Scorecard badge.
- Pin tidy-up as a rider: normalize mixed `actions/checkout` v5/v7 and `setup-node`/`upload-sarif` pins across workflows.

**Slice 3 — threat model proposal (docs only)**

- `docs/security/digital-passport-threat-model.md`: original threat model for this credential family (claims privacy, selective-disclosure boundaries, the age-over-threshold predicate circuit, presentation-request validation, proof-server trust, revocation/status assumptions), drafted for review. Per CODEOWNERS, `SECURITY.md` itself routes to `@midnightntwrk/mn-security`; this change deliberately does not touch `SECURITY.md` — promotion of the accepted content into it is their call, not part of this change.

Out of scope: publishing/release enablement (npm publish pipeline, SBOM, provenance, package manifest hygiene), Git-LFS artifact policy, fuzzing, `develop`/`release/**` branch models, docs-site tooling, and org-level GitHub settings (branch protection, secret scanning, default token permissions).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `repository-toolchain`: the "Continuous integration lanes" requirement is modified — the scan lane SHALL gate on high-severity findings, and the security workflows SHALL be verified by a CI-enforced self-check (full-SHA action pinning, `persist-credentials: false`, declared branch policy). New requirements added: "Supply-chain hardened dependency installation" (release-age floor, exotic-subdependency blocking, trust policy, declared build-script allowances), "Dependency update automation" (active npm and github-actions lanes with release-age cooldowns; Renovate via the org preset), and "Vulnerability exception governance" (every ignored OSV finding documented, owner-assigned, and expiring, enforced by a CI check).

## Impact

- **Install/dependency policy**: `pnpm-workspace.yaml`, `.npmrc`, `package.json` (add `yaml` devDependency), `pnpm-lock.yaml` regenerates.
- **CI/workflows**: `.github/workflows/scan.yaml` (gating + new pin), minor pin normalization in `ci.yml`/`scorecard.yml`/`dependency-review.yml`, `ci.yml` `verify` lane gains the two new checks.
- **Automation config**: `renovate.json` (new), `.github/dependabot.yml` (npm lane re-enabled).
- **Governance**: `osv-scanner.toml` (new, empty), `docs/security/vulnerability-exceptions.md` (new scaffold), `tooling/scripts/check-security-workflows.mjs` and `tooling/scripts/check-vulnerability-exceptions.mjs` (new, ported from midnight-verifiable-credentials and adapted).
- **Docs**: `README.md` (Scorecard badge), `docs/security/digital-passport-threat-model.md` (new proposal document), CHANGELOG.
- **Runtime code**: none. No package source, contract, or artifact changes.
- **Ordering**: the active `npm-artifacts-flake-output` change also carries a `repository-toolchain` delta (touching "Pinned Compact toolchain", a different requirement than any delta here); no textual conflict, but archive order between the two changes should be deliberate so both deltas apply cleanly.
