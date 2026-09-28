#!/usr/bin/env node
// This file is part of midnightntwrk/midnight-vc-passport.
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

// GitHub-Release publication (github-release-distribution: "Window channel
// semantics", "Release assets and integrity evidence"). WINDOW (temporary)
// companion of the GitHub-Release distribution window: runs before the
// best-effort npmjs publication attempt so the Release is produced whatever
// the npm outcome. Two modes over the same artifact set:
//
//   prepare:
//     publish-github-release.mjs prepare --tag <v<version>> --channel <rc|release> \
//       [--artifacts-dir <dir>] [--repo <owner/name>]
//     Enumerates the release assets (packed tarballs, SPDX SBOMs, the
//     contract report), writes SHA256SUMS (basenames, deterministic order)
//     and the generated release body (channel, version, install URL,
//     checksums, verification one-liners, changelog link) into the
//     artifacts dir.
//
//   publish:
//     publish-github-release.mjs publish --tag <v<version>> --channel <rc|release> \
//       --repo <owner/name> [--artifacts-dir <dir>] [--github-output <file>]
//     Creates the release on the operator tag (never moving it) with every
//     asset and the generated body — `--prerelease` for rc (never latest),
//     `--latest` for release — or, when the release already exists, turns the
//     rerun into a verified no-op: every existing asset digest is compared
//     against the locally packed artifact, missing assets are uploaded
//     (without --clobber), and any digest drift fails closed. Emits
//     `release-url=<family tarball download URL>` for the consumer test.
//
// The gh CLI runs through GH_COMMAND (default "gh") so the release-tooling
// tests exercise the create/no-op/drift paths offline against a mock. The
// workflow passes GH_TOKEN through the step env map only — never inside any
// command line — and no workflow template value is interpolated into argv.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { publishableWorkspaces } from "./workspace-catalog.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const DEFAULT_ARTIFACTS_DIR = path.join(repoRoot, "tooling", "artifacts");
const CHANNELS = ["rc", "release"];

const fail = (message) => {
  console.error(`[publish-github-release] ${message}`);
  process.exit(1);
};

const sha256File = (filePath) =>
  createHash("sha256").update(readFileSync(filePath)).digest("hex");

/**
 * The deterministic release asset list over the artifacts dir: the packed
 * tarballs, the SPDX SBOMs, the contract report, and (when present, i.e.
 * after `prepare`, for the upload set) SHA256SUMS. Sorted by name; every
 * entry must exist. SHA256SUMS is never part of its own checksum set.
 */
export const releaseAssets = (artifactsDir, { includeSums = true } = {}) => {
  const assets = [];
  const npmDir = path.join(artifactsDir, "npm");
  const sbomDir = path.join(artifactsDir, "sbom");
  if (!existsSync(npmDir)) {
    fail(`no packed tarballs at ${npmDir} (run artifacts:pack first)`);
  }
  assets.push(
    ...readdirSync(npmDir)
      .filter((file) => file.endsWith(".tgz"))
      .map((file) => path.join(npmDir, file)),
  );
  if (assets.length === 0) {
    fail(`no packed tarballs in ${npmDir}`);
  }
  if (!existsSync(sbomDir)) {
    fail(`no SPDX SBOMs at ${sbomDir} (run generate-release-sbom.mjs first)`);
  }
  assets.push(
    ...readdirSync(sbomDir)
      .filter((file) => file.endsWith(".spdx.json"))
      .map((file) => path.join(sbomDir, file)),
  );
  const report = path.join(artifactsDir, "contract-report.json");
  if (!existsSync(report)) {
    fail(`no contract report at ${report} (the pack path must emit it)`);
  }
  assets.push(report);
  const sums = path.join(artifactsDir, "SHA256SUMS");
  if (includeSums && existsSync(sums)) {
    assets.push(sums);
  }
  return assets.sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
};

/** The family package tarball filename for a version (npm pack naming). */
const familyTarballName = (version) => {
  const family = publishableWorkspaces()[0];
  if (!family) {
    fail("the workspace catalog lists no publishable package");
  }
  return `${family.name.replace(/^@/u, "").replace(/\//gu, "-")}-${version}.tgz`;
};

const parseArgs = (argv) => {
  const options = { mode: null, tag: null, channel: null, repo: null, artifactsDir: DEFAULT_ARTIFACTS_DIR, githubOutput: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "prepare" || arg === "publish") {
      options.mode = arg;
    } else if (arg === "--tag") {
      options.tag = argv[++index];
    } else if (arg === "--channel") {
      options.channel = argv[++index];
    } else if (arg === "--repo") {
      options.repo = argv[++index];
    } else if (arg === "--artifacts-dir") {
      options.artifactsDir = argv[++index];
    } else if (arg === "--github-output") {
      options.githubOutput = argv[++index];
    } else {
      fail(`unknown argument ${arg}`);
    }
  }
  if (!options.mode) {
    fail("a mode is required (prepare | publish)");
  }
  if (!options.tag || !/^v\d+\.\d+\.\d+(-[\w.]+)?$/u.test(options.tag)) {
    fail("--tag is required and must be v<version> (e.g. v0.1.0-rc1)");
  }
  if (!CHANNELS.includes(options.channel)) {
    fail(`--channel is required and must be one of ${CHANNELS.join(", ")} during the GitHub-Release window`);
  }
  if (options.mode === "publish" && !options.repo) {
    fail("--repo <owner/name> is required in publish mode (or set GITHUB_REPOSITORY)");
  }
  return options;
};

/** Renders the generated release body (deterministic; no timestamps). */
export const releaseBody = ({ tag, channel, repo, assets }) => {
  const version = tag.slice(1);
  const family = publishableWorkspaces()[0];
  const installUrl = `https://github.com/${repo}/releases/download/${tag}/${familyTarballName(version)}`;
  const sums = assets
    .map((asset) => `${sha256File(asset)}  ${path.basename(asset)}`)
    .join("\n");
  return `## ${family.name} ${version} (${channel})

Interim GitHub-Release distribution: npmjs remains the durable target, but
this release is published here while the npmjs Trusted Publisher mapping is
not yet configured (see the
[publication runbook](https://github.com/${repo}/blob/${tag}/docs/guides/npmjs-publication.md)).

### Install (versioned URL pin)

\`\`\`json
"dependencies": {
  "${family.name}": "${installUrl}"
}
\`\`\`

The lockfile freezes the URL; upgrades are a one-line URL edit. Transitive
dependencies resolve from the public npmjs registry.

### Assets and checksums (SHA256)

\`\`\`
${sums}
\`\`\`

### Verify (optional)

\`\`\`sh
sha256sum --check SHA256SUMS
gh attestation verify --repo ${repo} <asset-file>
\`\`\`

### Changelog

See the package
[changelog](https://github.com/${repo}/blob/${tag}/${family.path}/CHANGELOG.md).
`;
};

const prepare = (options) => {
  // SHA256SUMS covers the tarball(s), SBOM(s), and the contract report —
  // never itself (a rerun must be byte-identical).
  const assets = releaseAssets(options.artifactsDir, { includeSums: false });
  const sumsPath = path.join(options.artifactsDir, "SHA256SUMS");
  const sums = assets
    .map((asset) => `${sha256File(asset)}  ${path.basename(asset)}`)
    .join("\n");
  writeFileSync(sumsPath, `${sums}\n`, "utf8");
  const bodyPath = path.join(options.artifactsDir, "release-body.md");
  writeFileSync(
    bodyPath,
    releaseBody({ tag: options.tag, channel: options.channel, repo: options.repo ?? "OWNER/REPO", assets }),
    "utf8",
  );
  console.log(`[publish-github-release] SHA256SUMS written over ${assets.length} asset(s)`);
  console.log(`[publish-github-release] release body written to ${bodyPath}`);
};

/** Runs gh (or its test mock) and fails closed on any nonzero exit. */
const gh = (args, { cwd } = {}) => {
  const command = (process.env.GH_COMMAND ?? "gh").split(" ").filter(Boolean);
  const result = spawnSync(command[0], [...command.slice(1), ...args], {
    encoding: "utf8",
    cwd,
    env: { ...process.env, GH_TOKEN: process.env.GH_TOKEN ?? "" },
  });
  if (result.error) {
    fail(`cannot run ${command.join(" ")}: ${result.error.message}`);
  }
  return result;
};

const publish = (options) => {
  const assets = releaseAssets(options.artifactsDir);
  const sumsPath = path.join(options.artifactsDir, "SHA256SUMS");
  if (!existsSync(sumsPath)) {
    fail(`SHA256SUMS is missing at ${sumsPath} (run prepare first)`);
  }
  const bodyPath = path.join(options.artifactsDir, "release-body.md");
  if (!existsSync(bodyPath)) {
    fail(`the release body is missing at ${bodyPath} (run prepare first)`);
  }
  const uploadFiles = [sumsPath, ...assets.filter((asset) => asset !== sumsPath)];
  const local = new Map(
    uploadFiles.map((asset) => [path.basename(asset), `sha256:${sha256File(asset)}`]),
  );
  // gh resolves asset paths against its cwd (= the artifacts dir): the
  // npm/ and sbom/ subdirectory assets must be passed relative to it, never
  // as bare basenames.
  const uploadPath = new Map(
    uploadFiles.map((asset) => [path.basename(asset), path.relative(options.artifactsDir, asset)]),
  );
  const prerelease = options.channel === "rc";
  const releaseView = () => {
    const view = gh([
      "release",
      "view",
      options.tag,
      "--repo",
      options.repo,
      "--json",
      "assets,isPrerelease",
    ]);
    if (view.status !== 0) {
      return null;
    }
    try {
      return JSON.parse(view.stdout);
    } catch (error) {
      fail(`cannot parse 'gh release view' output: ${error.message}`);
    }
  };

  const view = releaseView();
  if (view === null) {
    // gh resolves asset paths and --notes-file against its cwd: run it from
    // the artifacts dir and pass artifacts-dir-relative paths so the npm/
    // and sbom/ subdirectory assets resolve.
    const created = gh(
      [
        "release",
        "create",
        options.tag,
        ...uploadFiles.map((asset) => uploadPath.get(path.basename(asset))),
        "--repo",
        options.repo,
        "--title",
        options.tag,
        "--notes-file",
        path.basename(bodyPath),
        "--verify-tag",
        ...(prerelease ? ["--prerelease"] : ["--latest"]),
      ],
      { cwd: options.artifactsDir },
    );
    if (created.status !== 0) {
      fail(`gh release create failed:\n${created.stderr}`);
    }
    console.log(`[publish-github-release] release ${options.tag} created (${prerelease ? "prerelease, never latest" : "latest"})`);
  } else {
    // Idempotent rerun: every asset the release already carries must match
    // the packed bytes — any drift fails closed; `--clobber` is never used.
    const drift = [];
    for (const asset of view.assets ?? []) {
      const expected = local.get(asset.name);
      if (expected === undefined) {
        drift.push(`release carries an unexpected asset '${asset.name}'`);
      } else if (asset.digest !== expected) {
        drift.push(
          `asset '${asset.name}' drifted: release digest ${asset.digest} != local ${expected}`,
        );
      }
    }
    if (drift.length > 0) {
      for (const violation of drift) {
        console.error(`[publish-github-release] ${violation}`);
      }
      fail("the existing release does not match the packed artifacts; delete it or re-dispatch the correction (never --clobber)");
    }
    if (Boolean(view.isPrerelease) !== prerelease) {
      fail(
        `the existing release has isPrerelease=${view.isPrerelease} but channel '${options.channel}' requires ${prerelease}`,
      );
    }
  }

  // Complete a partial upload (network drop mid-create, or an interrupted
  // earlier rerun): upload anything missing — never overwriting an existing
  // asset (--clobber is never used).
  const afterCreate = releaseView();
  if (afterCreate === null) {
    fail("the release does not exist after creation");
  }
  const landed = new Set((afterCreate.assets ?? []).map((asset) => asset.name));
  const missing = [...local.keys()].filter((name) => !landed.has(name));
  if (missing.length > 0) {
    console.log(`[publish-github-release] uploading ${missing.length} missing asset(s): ${missing.join(", ")}`);
    const uploaded = gh(
      [
        "release",
        "upload",
        options.tag,
        ...missing.map((name) => uploadPath.get(name)),
        "--repo",
        options.repo,
      ],
      { cwd: options.artifactsDir },
    );
    if (uploaded.status !== 0) {
      fail(`gh release upload failed:\n${uploaded.stderr}`);
    }
  } else if (view !== null) {
    console.log(`[publish-github-release] release ${options.tag} already exists with identical assets: no-op`);
  }

  // Final digest verification: whatever the release reports must equal the
  // locally packed bytes — the exact set, no extras, no gaps.
  const finalView = releaseView();
  if (finalView === null) {
    fail("cannot verify the release assets");
  }
  const finalNames = new Set((finalView.assets ?? []).map((asset) => asset.name));
  for (const [name, digest] of local.entries()) {
    const remote = (finalView.assets ?? []).find((asset) => asset.name === name);
    if (remote === undefined) {
      fail(`asset '${name}' is absent from the release after upload`);
    }
    if (remote.digest !== digest) {
      fail(`uploaded asset '${name}' digest ${remote.digest} != local ${digest}`);
    }
    finalNames.delete(name);
  }
  if (finalNames.size > 0) {
    fail(`release carries unexpected asset(s): ${[...finalNames].join(", ")}`);
  }
  if (Boolean(finalView.isPrerelease) !== prerelease) {
    fail(`release isPrerelease=${finalView.isPrerelease} does not match channel '${options.channel}'`);
  }
  console.log(`[publish-github-release] all ${local.size} uploaded asset digests verified against the packed artifacts`);

  const version = options.tag.slice(1);
  const releaseUrl = `https://github.com/${options.repo}/releases/download/${options.tag}/${familyTarballName(version)}`;
  const githubOutput = options.githubOutput ?? process.env.GITHUB_OUTPUT;
  if (githubOutput) {
    const line = `release-url=${releaseUrl}\n`;
    if (options.githubOutput) {
      writeFileSync(options.githubOutput, line, "utf8");
    } else {
      appendFileSync(githubOutput, line, "utf8");
    }
  }
  console.log(`[publish-github-release] release-url=${releaseUrl}`);
};

const main = () => {
  const options = parseArgs(process.argv.slice(2));
  if (options.mode === "prepare") {
    prepare(options);
  } else {
    publish(options);
  }
};

const isDirectExecution =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectExecution) {
  main();
}
