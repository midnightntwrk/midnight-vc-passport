## Context

The package has never been published: `npm view @midnight-ntwrk/midnight-verifiable-credential-digital-passport` returns E404 (no versions, zero downloads), verified on 2026-09-03 and recorded in issue #47. Both rename candidates were free. Sibling packages in the org are scoped (`@midnight-ntwrk/credential-compact`, `@midnight-ntwrk/midnight-js-network-id`). The `npm-trusted-publishing` change (15/16 tasks done, only archive-time actions outstanding) introduces a Trusted Publisher mapping requirement that is bound to the package name, and its archive lands the requirement in base `openspec/specs/npm-publication/spec.md` carrying the old name.

## Goals / Non-Goals

**Goals:**

- Publish under a short, org-scoped name: `@midnight-ntwrk/midnight-vc-passport`
- Keep every reference in the repo (manifest, consumers, tooling, docs, specs) consistent with the new name
- Keep the trusted-publishing prerequisite correct for the new name (name-bound mapping)

**Non-Goals:**

- Renaming the GitHub repository or the root workspace `name` (`midnight-verifiable-credential-digital-passport`) — SPDX headers name the repository and stay valid
- Any npm migration: no `npm deprecate` cycle, no dual-publishing window (nothing was ever published)
- Changing on-chain identifiers (`midnight:vc:digital-passport`, `digital-passport:v1`) — the spec already decouples them from package naming
- Changing the package version (`0.1.0` is simply the first release under the new name)
- Changing the public export surface (`./codecs`, `./contract`, `./testing` subpaths move with the new name mechanically)

## Decisions

**D1 — Scoped name, `midnight-` prefix kept: `@midnight-ntwrk/midnight-vc-passport`.** Chosen over the unscoped `midnight-vc-passport` (global-namespace squatting risk, breaks the all-scoped org convention, loses npm org grouping) and over `@midnight-ntwrk/vc-passport` (maintainer preferred keeping the `midnight-` prefix for brand searchability). Availability verified (E404).

**D2 — Directory renamed to `packages/midnight-vc-passport`; root workspace name and GitHub repo unchanged.** Nothing references the package by directory path from outside the workspace tooling (consumers import the published name, not the path), so the directory rename is low-risk `git mv` plus manifest `repository.directory` update. Repo rename was rejected as orthogonal ceremony with real churn (SPDX headers in every file, external links, provenance attestations).

**D3 — No npm-side migration.** Zero published versions means zero consumers; the rename is purely a repo-side consistency edit plus one owner action (the Trusted Publisher mapping for the new name).

**D4 — Sequencing: `npm-trusted-publishing` archives first; this change is drafted to apply against its post-archive base.** The `npm-publication` delta in this change MODIFIES the "Trusted-publisher configuration prerequisite" requirement, which enters the base spec only when `npm-trusted-publishing` archives. This change was therefore drafted while that archive is pending: if the archive has not landed on this branch's base, validation of the `npm-publication` delta will report the requirement as not yet in base — rebase onto the post-archive `develop` before applying. The `github-release-distribution` spec that also references the old name is retired by that archive, so no rename delta is needed for it.

**D5 — Trusted Publisher mapping is restated, not migrated.** npm Trusted Publishing mappings are name-bound; there is nothing to transfer because nothing was published. The runbook's prerequisite section keeps naming the owner action (create the mapping for the new package name) rather than any migration step.

## Risks / Trade-offs

- **Drafted pre-archive:** if `npm-trusted-publishing` archives with edits to the requirement text, this change's MODIFIED block must be refreshed during rebase (mechanical: swap the package name in the archived text). Tracked as a task.
- **Name drift in untracked prose:** the old name appears in archived OpenSpec changes (history — intentionally untouched) and possibly in stray docs; a repo-wide grep task guards the live tree.
- **`midnight-` prefix costs 10 chars** versus the shortest scoped option (`@midnight-ntwrk/vc-passport`); accepted for brand consistency with `@midnight-ntwrk/midnight-js-*` siblings.
