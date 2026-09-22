#!/usr/bin/env node
// This file is part of midnightntwrk/midnight-verifiable-credential-digital-passport.
// Copyright (C) Midnight Foundation
// SPDX-License-Identifier: Apache-2.0
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

// Workspace release catalog (npm-publication: "Stateless release versioning" /
// "Private workspace never published"). Ported from
// midnight-verifiable-credentials and reduced to this repository's catalog:
// the digital-passport family package is the single supported (publishable)
// entry; the smoke consumer is private evidence tooling that is never packed
// for publication.
//
// CLI:
//   node tooling/scripts/workspace-catalog.mjs                     # JSON catalog
//   node tooling/scripts/workspace-catalog.mjs --publishable-paths # paths that may be published
//   node tooling/scripts/workspace-catalog.mjs --packable-paths    # paths that may be packed
//   node tooling/scripts/workspace-catalog.mjs --check             # catalog ↔ workspace agreement

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

/** @type {Array<{ name: string, path: string, releaseStage: string | null, publishable: boolean, private: boolean }>} */
export const workspaceCatalog = [
  {
    name: "@midnight-ntwrk/midnight-verifiable-credential-digital-passport",
    path: "packages/midnight-verifiable-credential-digital-passport",
    releaseStage: "supported",
    publishable: true,
    private: false,
  },
  {
    name: "smoke-consumer",
    path: "packages/smoke-consumer",
    releaseStage: null,
    publishable: false,
    private: true,
  },
];

/** Workspaces whose release stage is `supported` — the publication candidates. */
export const supportedWorkspacePaths = () =>
  workspaceCatalog
    .filter((workspace) => workspace.releaseStage === "supported")
    .map((workspace) => workspace.path);

/** Workspaces whose tarballs may be packed/published. */
export const packableWorkspacePaths = () =>
  workspaceCatalog
    .filter((workspace) => workspace.publishable)
    .map((workspace) => workspace.path);

/** Publishable catalog entries (name + path), for scripts that pack by name. */
export const publishableWorkspaces = () =>
  workspaceCatalog.filter((workspace) => workspace.publishable);

const readWorkspaceManifest = (workspacePath) =>
  JSON.parse(readFileSync(path.join(repoRoot, workspacePath, "package.json"), "utf8"));

/** Lists the actual workspace directories under `packages/`. */
const actualWorkspacePaths = () =>
  readdirSync(path.join(repoRoot, "packages"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `packages/${entry.name}`)
    .filter((workspacePath) =>
      existsSync(path.join(repoRoot, workspacePath, "package.json")),
    );

/**
 * Verifies the catalog against the real workspace: every workspace must be
 * cataloged exactly once, names must agree, and publishability must match the
 * manifest's `private` flag. Returns an array of violation strings.
 */
export const catalogViolations = () => {
  const violations = [];
  const catalogedPaths = workspaceCatalog.map((workspace) => workspace.path);
  const duplicates = catalogedPaths.filter(
    (workspacePath, index) => catalogedPaths.indexOf(workspacePath) !== index,
  );
  for (const duplicate of duplicates) {
    violations.push(`workspace ${duplicate} is cataloged more than once`);
  }

  for (const workspacePath of actualWorkspacePaths()) {
    if (!catalogedPaths.includes(workspacePath)) {
      violations.push(
        `workspace ${workspacePath} exists under packages/ but is not cataloged`,
      );
    }
  }

  for (const workspace of workspaceCatalog) {
    const manifestPath = path.join(repoRoot, workspace.path, "package.json");
    if (!existsSync(manifestPath)) {
      violations.push(`cataloged workspace ${workspace.path} has no package.json`);
      continue;
    }
    const manifest = readWorkspaceManifest(workspace.path);
    if (manifest.name !== workspace.name) {
      violations.push(
        `cataloged name ${workspace.name} does not match manifest name ${manifest.name} in ${workspace.path}`,
      );
    }
    if (Boolean(manifest.private) !== workspace.private) {
      violations.push(
        `cataloged private=${workspace.private} does not match manifest private=${Boolean(manifest.private)} in ${workspace.path}`,
      );
    }
    if (workspace.publishable && manifest.private) {
      violations.push(`publishable workspace ${workspace.path} is private`);
    }
    if (workspace.publishable && workspace.releaseStage !== "supported") {
      violations.push(
        `publishable workspace ${workspace.path} must have releaseStage "supported"`,
      );
    }
  }
  return violations;
};

const fail = (message) => {
  console.error(`[workspace-catalog] ${message}`);
  process.exit(1);
};

const isMain =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  const args = process.argv.slice(2);
  if (args.includes("--check")) {
    const violations = catalogViolations();
    if (violations.length > 0) {
      for (const violation of violations) {
        console.error(`[workspace-catalog] ${violation}`);
      }
      process.exit(1);
    }
    console.log(
      `Workspace catalog is consistent: ${workspaceCatalog.length} workspaces, ${packableWorkspacePaths().length} publishable (${packableWorkspacePaths().join(", ")}).`,
    );
  } else if (args.includes("--publishable-paths")) {
    for (const workspacePath of supportedWorkspacePaths()) {
      console.log(workspacePath);
    }
  } else if (args.includes("--packable-paths")) {
    for (const workspacePath of packableWorkspacePaths()) {
      console.log(workspacePath);
    }
  } else if (args.length > 0) {
    fail(`unknown arguments: ${args.join(" ")}`);
  } else {
    console.log(JSON.stringify(workspaceCatalog, null, 2));
  }

  // Guard against accidental drift between the catalog and the git worktree the
  // scripts operate on (keeps `--check` meaningful when invoked from a subdirectory).
  if (!existsSync(path.join(repoRoot, ".git"))) {
    try {
      execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: repoRoot });
    } catch {
      fail(`${repoRoot} is not the repository root`);
    }
  }
}
