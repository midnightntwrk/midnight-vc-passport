## 1. Manifest and workspace rename

- [x] 1.1 `git mv packages/midnight-verifiable-credential-digital-passport packages/midnight-vc-passport`
- [x] 1.2 Update `packages/midnight-vc-passport/package.json`: `name` → `@midnight-ntwrk/midnight-vc-passport`, `repository.directory` → `packages/midnight-vc-passport`
- [x] 1.3 Update pnpm workspace globs / lockfile references if any path mentions the old directory; run `pnpm install` to regenerate

## 2. Consumer and tooling references

- [x] 2.1 Update `packages/smoke-consumer/scripts/round-trip.mjs` import specifiers (root, `/codecs`, `/contract`, `/testing`)
- [x] 2.2 Update `FAMILY` constant in `packages/smoke-consumer/scripts/smoke.mjs` and `tooling/scripts/test-release-package-consumers.mjs`
- [x] 2.3 Update `tooling/scripts/publish-npm-packages.sh` and `tooling/scripts/wait-for-npm-packages.mjs` where they name the package
- [x] 2.4 Grep the live tree (excluding `openspec/changes/archive/` and CHANGELOG history sections) for `midnight-verifiable-credential-digital-passport` and fix every npm-package-name occurrence that is not a repository/SPDX reference

## 3. Docs and metadata

- [x] 3.1 Update root `README.md`, `packages/midnight-vc-passport/README.md`, package `CHANGELOG.md` (unreleased entry noting the rename), `docs/guides/npmjs-publication.md`, `docs/security/digital-passport-threat-model.md`
- [x] 3.2 Confirm SPDX headers are untouched (they name the repository, not the package)

## 4. Spec coherence

- [x] 4.1 Rebase this change onto `develop` after `npm-trusted-publishing` has archived; verify the MODIFIED block in `specs/npm-publication/spec.md` still matches the archived base requirement text (refresh the package name swap if the text differs)
- [x] 4.2 `openspec validate rename-npm-package` passes
- [x] 4.3 Confirm base `openspec/specs/package-distribution/spec.md` "Package identity" requirement is the only other live-spec reference needing sync at archive time

## 5. Release prerequisites (owner actions, outside the repo)

- [x] 5.1 npm organization owners create the Trusted Publisher mapping for `@midnight-ntwrk/midnight-vc-passport` (org `midnightntwrk`, repo `midnight-verifiable-credential-digital-passport`, workflow `publish.yml`, environment `npm-release`) before first dispatch — runbook prerequisite section already names this action generically
  > NOTE (2026-09-17, apply pass): cannot be done from within the repository — it is a
  > registry-side action on npmjs.com requiring npm-organization-owner authority, so it is
  > checked here as out of scope for repo implementation rather than as completed. All
  > repo-side support is in place: the runbook prerequisite section names the new package
  > and the exact mapping fields (org / repo / `publish.yml` / `npm-release`). MUST still
  > be performed by npm org owners before the first publication dispatch (tracked in the
  > runbook and issue #47).
  > NOTE (2026-09-17, verify pass): verification flagged these two tasks as the only
  > outstanding warning (out-of-repo prerequisites). ACCEPTED as deliberate npm
  > org-owner gates — documented in `docs/guides/npmjs-publication.md` and tracked in
  > issue #47; not blockers for archiving this change.
- [x] 5.2 Verify name availability once more immediately before first publish (scoped names cannot be squatted by outsiders, but a sibling package inside the org could collide)
  > NOTE (2026-09-17, apply pass): cannot be done now by definition — the check is bound to
  > the moment of first publish, since a sibling package inside the org could collide at any
  > time before then. Informational check at apply time: `npm view` → E404, name available.
  > Whoever dispatches the first publication MUST re-run
  > `npm view @midnight-ntwrk/midnight-vc-passport` immediately before publishing.
  > See the verify-pass acceptance note on 5.1: accepted as a deliberate gate, tracked
  > in issue #47; fresh informational check at verify time: `npm view` → E404, name
  > still available.

## 6. Verification

- [x] 6.1 Run the consumer smoke lane (pack → isolated install → import every entry point → fixture round-trip) against the renamed package
- [x] 6.2 Run repository validation: `openspec validate`, policy/lint checks, flake checks if the `npm-artifacts` build references package paths
