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

// Release package contract check (npm-publication: "Pre-publication gate";
// package-distribution: "Publication metadata"). Ported from
// midnight-verifiable-credentials and adapted to the digital-passport family
// package. Verifies every packed tarball before it becomes publishable:
//   - manifest publication metadata (publishConfig, repository+directory,
//     description, keywords, homepage, bugs)
//   - package-level CHANGELOG.md / README.md / package.json in the tarball root
//   - expected contents: dist output, managed contract exports, compact
//     sources, helper scripts
//   - no managed-code source maps, no secret material
//   - tarball filename version == packed manifest version
//
// Additionally emits a machine-readable report (github-release-distribution:
// "Release assets and integrity evidence") at tooling/artifacts/contract-report.json
// — per-tarball check results plus the resolved version, deterministic content
// (no timestamps) — without changing the exit semantics. The default path sits
// inside tooling/artifacts/ so the unchanged evidence-artifact upload globs it,
// and the GitHub-Release bridge attaches it to the release as an asset.
//
// CLI:
//   check-release-package-contract.mjs [--artifacts-dir <dir>] [--report <file>]
//   check-release-package-contract.mjs --tarball <file> ... [--report <file>]

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { publishableWorkspaces } from "./workspace-catalog.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const DEFAULT_REPORT_PATH = path.join(repoRoot, "tooling", "artifacts", "contract-report.json");

const NPM_PUBLIC_REGISTRY = "https://registry.npmjs.org/";
const REPOSITORY_URL =
  "git+https://github.com/midnightntwrk/midnight-verifiable-credential-digital-passport.git";
const SEMVER = /^\d+\.\d+\.\d+(-[\w.-]+)?$/u;

const walk = (dir) => {
  const entries = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      entries.push(...walk(fullPath));
    } else if (entry.isFile()) {
      entries.push(fullPath);
    }
  }
  return entries;
};

/**
 * Checks one extracted tarball root for the distribution invariants.
 * `expectedRepositoryDirectory` is the workspace path the catalog declares for
 * the packed package (tests may inject their own expectation).
 */
export const contractViolations = (packageRoot, { expectedRepositoryDirectory } = {}) => {
  const violations = [];
  const manifestPath = path.join(packageRoot, "package.json");
  if (!existsSync(manifestPath)) {
    return ["package.json is missing from the tarball root"];
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

  for (const required of ["README.md", "CHANGELOG.md", "package.json"]) {
    if (!existsSync(path.join(packageRoot, required))) {
      violations.push(`${required} is missing from the tarball root`);
    }
  }

  // Manifest publication metadata (package-distribution: "Publication metadata").
  if (manifest.publishConfig?.access !== "public") {
    violations.push("publishConfig.access must be 'public'");
  }
  if (manifest.publishConfig?.registry !== NPM_PUBLIC_REGISTRY) {
    violations.push(
      `publishConfig.registry must be '${NPM_PUBLIC_REGISTRY}' (got '${manifest.publishConfig?.registry}')`,
    );
  }
  const repositoryUrl =
    typeof manifest.repository === "object" ? manifest.repository?.url : manifest.repository;
  if (typeof repositoryUrl !== "string" || !repositoryUrl.startsWith(REPOSITORY_URL)) {
    violations.push(`repository.url must point at ${REPOSITORY_URL} (got '${repositoryUrl}')`);
  }
  const repositoryDirectory =
    typeof manifest.repository === "object" ? manifest.repository?.directory : undefined;
  if (typeof repositoryDirectory !== "string" || repositoryDirectory.length === 0) {
    violations.push("repository.directory must name the package directory");
  } else if (
    expectedRepositoryDirectory !== undefined &&
    repositoryDirectory !== expectedRepositoryDirectory
  ) {
    violations.push(
      `repository.directory '${repositoryDirectory}' does not match the cataloged workspace '${expectedRepositoryDirectory}'`,
    );
  }
  if (typeof manifest.description !== "string" || manifest.description.length === 0) {
    violations.push("description must be a non-empty string");
  }
  if (!Array.isArray(manifest.keywords) || manifest.keywords.length === 0) {
    violations.push("keywords must be a non-empty array");
  }
  if (typeof manifest.homepage !== "string" || manifest.homepage.length === 0) {
    violations.push("homepage must be a non-empty string");
  }
  if (typeof manifest.bugs !== "object" || typeof manifest.bugs?.url !== "string") {
    violations.push("bugs.url must be present");
  }
  if (!SEMVER.test(manifest.version ?? "")) {
    violations.push(`manifest version '${manifest.version}' is not a semantic version`);
  }
  if (manifest.private === true) {
    violations.push("the packed manifest must not be private");
  }

  // Expected dist / managed / compact / scripts contents.
  const distDir = path.join(packageRoot, "dist");
  if (!existsSync(distDir) || walk(distDir).length === 0) {
    violations.push("compiled distribution output (package/dist/) is missing or empty");
  }
  const managedRoot = path.join(packageRoot, "dist", "managed");
  const managedContracts = existsSync(managedRoot)
    ? readdirSync(managedRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
    : [];
  if (managedContracts.length === 0) {
    violations.push("managed contract exports (package/dist/managed/) are missing");
  }
  for (const contract of managedContracts) {
    const contractIndex = path.join(
      packageRoot,
      "dist",
      "managed",
      contract,
      "contract",
      "index.js",
    );
    if (!existsSync(contractIndex)) {
      violations.push(`managed contract index (dist/managed/${contract}/contract/index.js) is missing`);
    }
  }
  const compactSources = walk(packageRoot).filter((file) => file.endsWith(".compact"));
  if (compactSources.length === 0) {
    violations.push("compact contract sources (*.compact) are missing from the tarball");
  }
  const scriptsDir = path.join(packageRoot, "scripts");
  const scripts = existsSync(scriptsDir)
    ? readdirSync(scriptsDir).filter((file) => file.endsWith(".mjs"))
    : [];
  if (scripts.length === 0) {
    violations.push("build helper scripts (package/scripts/*.mjs) are missing");
  }

  // Managed source maps are deliberately not shipped; no secret material.
  for (const file of walk(packageRoot)) {
    const relative = path.relative(packageRoot, file).split(path.sep).join("/");
    if (relative.startsWith("dist/managed/") && relative.endsWith(".map")) {
      violations.push(`managed-code source map is shipped: ${relative}`);
    }
    const base = path.basename(relative);
    if (/\.(pem|key)$/u.test(base) || /^\.env(\..+)?$/u.test(base)) {
      violations.push(`possible secret material is shipped: ${relative}`);
    }
  }
  return violations;
};

const checkTarball = (tarball) => {
  if (!existsSync(tarball) || !statSync(tarball).isFile()) {
    return [{ tarball, version: null, violations: [`tarball not found: ${tarball}`] }];
  }
  const work = mkdtempSync(path.join(tmpdir(), "release-contract-"));
  try {
    execFileSync("tar", ["-xzf", tarball, "-C", work]);
    const packageRoot = path.join(work, "package");
    const manifest = JSON.parse(readFileSync(path.join(packageRoot, "package.json"), "utf8"));

    const catalogEntry = publishableWorkspaces().find(
      (workspace) => workspace.name === manifest.name,
    );
    const violations = contractViolations(packageRoot, {
      expectedRepositoryDirectory: catalogEntry?.path,
    });
    if (!catalogEntry) {
      violations.unshift(
        `packed package '${manifest.name}' is not a cataloged publishable workspace`,
      );
    }

    const filename = path.basename(tarball);
    if (!filename.endsWith(`-${manifest.version}.tgz`)) {
      violations.push(
        `tarball filename '${filename}' does not match the packed manifest version '${manifest.version}'`,
      );
    }
    return [{ tarball: filename, version: manifest.version, violations }];
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
};

/**
 * Writes the machine-readable contract report. Deterministic by construction:
 * per-tarball results sorted by filename, the resolved version, and nothing
 * time-dependent. Returns the report document.
 */
export const writeContractReport = (reportPath, results) => {
  const sorted = [...results].sort((a, b) => (a.tarball < b.tarball ? -1 : a.tarball > b.tarball ? 1 : 0));
  const versions = sorted
    .map((result) => result.version)
    .filter((version) => typeof version === "string");
  const resolvedVersion =
    versions.length > 0 && versions.every((version) => version === versions[0])
      ? versions[0]
      : null;
  const report = {
    result: sorted.every((result) => result.violations.length === 0) ? "pass" : "fail",
    version: resolvedVersion,
    tarballs: sorted.map((result) => ({
      tarball: result.tarball,
      passed: result.violations.length === 0,
      violations: result.violations,
    })),
  };
  mkdirSync(path.dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
};

const isMain =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  const args = process.argv.slice(2);
  let artifactsDir = null;
  let reportPathArg = null;
  let tarballMode = false;
  let tarballs = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--artifacts-dir") {
      artifactsDir = args[++index];
    } else if (args[index] === "--tarball") {
      tarballs.push(args[++index]);
      tarballMode = true;
    } else if (args[index] === "--report") {
      reportPathArg = args[++index];
    } else {
      console.error(`[check-release-package-contract] unknown argument ${args[index]}`);
      process.exit(2);
    }
  }
  // The report is release evidence: it is emitted for the artifacts-dir
  // (release) path — always inside tooling/artifacts/, the path the
  // evidence-artifact upload globs and the GitHub-Release bridge attaches —
  // or wherever --report names. Ad-hoc --tarball checks stay side-effect-
  // free unless --report is explicit.
  const reportPath = reportPathArg ?? (tarballMode ? null : DEFAULT_REPORT_PATH);

  if (tarballs.length === 0) {
    const dir =
      artifactsDir ??
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../artifacts/npm");
    if (!existsSync(dir)) {
      console.error(
        `[check-release-package-contract] no artifacts directory at ${dir} (run artifacts:pack first)`,
      );
      process.exit(2);
    }
    tarballs = readdirSync(dir)
      .filter((file) => file.endsWith(".tgz"))
      .map((file) => path.join(dir, file))
      .sort();
  }

  if (tarballs.length === 0) {
    console.error("[check-release-package-contract] no tarballs found to check");
    process.exit(1);
  }

  const results = tarballs.flatMap((tarball) => checkTarball(tarball));
  // The report is emitted on both the pass and the failure path (before the
  // exit decision) — the release attaches it either way, and emission never
  // changes the exit semantics.
  const report = reportPath ? writeContractReport(reportPath, results) : null;
  const failed = results.filter((result) => result.violations.length > 0);
  if (failed.length > 0) {
    for (const result of failed) {
      for (const violation of result.violations) {
        console.error(`[check-release-package-contract] ${result.tarball}: ${violation}`);
      }
    }
    process.exit(1);
  }

  for (const result of results) {
    console.log(`[check-release-package-contract] ${result.tarball}: contract satisfied`);
  }
  console.log(`Release package contract satisfied for ${results.length} tarball(s).`);
  if (report) {
    console.log(`[check-release-package-contract] report written to ${path.resolve(reportPath)} (result: ${report.result}, version: ${report.version ?? "<unresolved>"})`);
  }
}
