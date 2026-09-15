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

// Release version preparation (npm-publication: "Stateless release
// versioning"). Ported from midnight-verifiable-credentials. The base semver
// lives in the root and publishable package manifests (and they must agree);
// this script computes the channel version —
//   snapshot: <base>-snapshot.<run-number>.<short-sha>  (npm tag `snapshot`)
//   rc:       <base>-rc<index>                          (npm tag `rc`)
//   release:  <base>                                    (npm tag `latest`)
// — and stamps it ONLY into the invoking checkout (the publication workflow's
// ephemeral copy). Nothing is committed, tagged, or pushed; source manifests
// keep the base version.
//
// CLI:
//   node tooling/scripts/prepare-release-version.mjs --channel <snapshot|rc|release> \
//     [--rc-index <n>] [--version <base>] [--github-output <file>] [--dry-run] [--json]
//
// Without --github-output, $GITHUB_OUTPUT (when set) receives the same fields.

import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { publishableWorkspaces } from "./workspace-catalog.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

export const CHANNELS = ["snapshot", "rc", "release"];

export const STABLE_SEMVER = /^\d+\.\d+\.\d+$/u;
const POSITIVE_INTEGER = /^\d+$/u;

/**
 * Verifies the base version agreement: the root manifest and every publishable
 * package manifest carry the same (stable) base semver. Throws on drift.
 */
export const assertBaseVersionAgreement = (rootVersion, packageVersions) => {
  if (!STABLE_SEMVER.test(rootVersion)) {
    throw new Error(
      `root manifest version ${rootVersion} is not a stable semantic version`,
    );
  }
  for (const [name, version] of Object.entries(packageVersions)) {
    if (version !== rootVersion) {
      throw new Error(
        `base version disagreement: root manifest has ${rootVersion} but ${name} has ${version}`,
      );
    }
  }
};

/**
 * Computes the release version and npm dist-tag for a channel. `snapshot`
 * requires a run number (and takes a short sha; git HEAD is used when absent).
 */
export const computeReleaseVersion = ({
  channel,
  baseVersion,
  rcIndex,
  runNumber,
  shortSha,
}) => {
  if (!CHANNELS.includes(channel)) {
    throw new Error(`unknown channel ${channel} (expected one of ${CHANNELS.join(", ")})`);
  }
  if (channel === "rc") {
    const index = rcIndex ?? 1;
    if (!POSITIVE_INTEGER.test(String(index)) || Number(index) < 1) {
      throw new Error(`rc channel requires a positive integer rc-index (got ${index})`);
    }
    return { version: `${baseVersion}-rc${Number(index)}`, npmTag: "rc" };
  }
  if (channel === "snapshot") {
    const run = runNumber ?? process.env.GITHUB_RUN_NUMBER ?? "0";
    const sha = shortSha ?? shortCommitSha();
    return { version: `${baseVersion}-snapshot.${run}.${sha}`, npmTag: "snapshot" };
  }
  return { version: baseVersion, npmTag: "latest" };
};

const shortCommitSha = () => {
  const sha = process.env.GITHUB_SHA ?? execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
  return sha.slice(0, 7);
};

const readManifestVersion = (manifestPath) =>
  JSON.parse(readFileSync(manifestPath, "utf8")).version;

const writeManifestVersion = (manifestPath, version) => {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.version = version;
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
};

const parseArgs = (argv) => {
  const options = { channel: null, rcIndex: null, version: null, githubOutput: null, dryRun: false, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--channel":
        options.channel = argv[++index];
        break;
      case "--rc-index":
        options.rcIndex = argv[++index];
        break;
      case "--version":
        options.version = argv[++index];
        break;
      case "--github-output":
        options.githubOutput = argv[++index];
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--json":
        options.json = true;
        break;
      default:
        throw new Error(`unknown argument ${arg}`);
    }
  }
  if (!options.channel) {
    throw new Error("--channel is required (snapshot | rc | release)");
  }
  if (options.version !== null && options.version !== "" && !STABLE_SEMVER.test(options.version)) {
    throw new Error(`--version must be a stable semantic version (got ${options.version})`);
  }
  return options;
};

const main = () => {
  const options = parseArgs(process.argv.slice(2));
  const publishable = publishableWorkspaces();

  const rootManifest = path.join(repoRoot, "package.json");
  const baseVersion = readManifestVersion(rootManifest);
  const packageVersions = Object.fromEntries(
    publishable.map((workspace) => [
      workspace.name,
      readManifestVersion(path.join(repoRoot, workspace.path, "package.json")),
    ]),
  );

  // The manifests are the source of truth: they must agree, and a supplied
  // --version is a confirmation of (not an override for) the manifest base.
  assertBaseVersionAgreement(baseVersion, packageVersions);
  if (options.version && options.version !== baseVersion) {
    throw new Error(
      `--version ${options.version} disagrees with the manifest base version ${baseVersion}; bump the manifests first (stateless versioning)`,
    );
  }

  const { version, npmTag } = computeReleaseVersion({
    channel: options.channel,
    baseVersion,
    rcIndex: options.rcIndex,
  });

  const stamped = !options.dryRun;
  if (stamped) {
    writeManifestVersion(rootManifest, version);
    for (const workspace of publishable) {
      writeManifestVersion(path.join(repoRoot, workspace.path, "package.json"), version);
    }
  }

  const result = {
    channel: options.channel,
    baseVersion,
    version,
    npmTag,
    stamped,
    manifests: stamped
      ? [rootManifest, ...publishable.map((workspace) => path.join(repoRoot, workspace.path, "package.json"))]
      : [],
  };

  const githubOutput = options.githubOutput ?? process.env.GITHUB_OUTPUT;
  if (githubOutput) {
    const lines = [
      `channel=${result.channel}`,
      `base-version=${result.baseVersion}`,
      `version=${result.version}`,
      `npm-tag=${result.npmTag}`,
      "",
    ].join("\n");
    // `--github-output` writes a standalone file; $GITHUB_OUTPUT is appended to.
    if (options.githubOutput) {
      writeFileSync(options.githubOutput, lines, { encoding: "utf8" });
    } else {
      appendFileSync(githubOutput, lines, "utf8");
    }
  }

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(
      `release version: ${version} (channel ${options.channel}, npm tag ${npmTag}, base ${baseVersion}${stamped ? ", stamped into the ephemeral checkout" : ", dry run — manifests untouched"})`,
    );
  }
};

const isDirectExecution =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectExecution) {
  main();
}
