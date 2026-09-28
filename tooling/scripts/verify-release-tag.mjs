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

// Release tag reconciliation (github-release-distribution: "Operator-owned
// release tags"). WINDOW (temporary) companion of the GitHub-Release
// distribution window: the publication workflow calls this before any build,
// pack, or upload step, and the run fails closed unless the operator-supplied
// release tag (a manual workflow input — the workflow itself never creates,
// moves, or deletes any ref):
//   1. exists in the repository,
//   2. points at the commit the dispatch was made from, and
//   3. equals `v<resolved-full-version>` — the channel-version scheme shared
//      with prepare-release-version.mjs (never duplicated here).
//
// The script is read-only over git and the manifests: it reconciles, it never
// mutates. Inputs arrive only through arguments and the environment — never
// through workflow template interpolation (the workflow env-indirects them).
//
// CLI:
//   verify-release-tag.mjs --tag <name> --channel <rc|release> \
//     [--rc-index <n>] [--base-version <v>] [--sha <commit>]
//
// `--sha` defaults to $GITHUB_SHA (the workflow_dispatch commit); the base
// version is read from the manifests (the source of truth — a supplied
// `--base-version` is a confirmation, not an override). The `snapshot` channel
// fails closed: run-number-stamped versions cannot be pre-tagged by an
// operator (release-resolve-context.sh rejects it first; this is belt and
// braces for direct invocations).

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  assertBaseVersionAgreement,
  expectedReleaseTag,
} from "./prepare-release-version.mjs";
import { publishableWorkspaces } from "./workspace-catalog.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

const fail = (message) => {
  console.error(`[verify-release-tag] ${message}`);
  process.exit(1);
};

/** Argument validation (covered by the release-tooling tests). */
export const parseTagArgs = (argv) => {
  const options = { tag: null, channel: null, rcIndex: null, baseVersion: null, sha: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--tag":
        options.tag = argv[++index];
        break;
      case "--channel":
        options.channel = argv[++index];
        break;
      case "--rc-index":
        options.rcIndex = argv[++index];
        break;
      case "--base-version":
        options.baseVersion = argv[++index];
        break;
      case "--sha":
        options.sha = argv[++index];
        break;
      default:
        throw new Error(`unknown argument ${arg}`);
    }
  }
  if (!options.tag) {
    throw new Error("--tag is required (the operator-created release tag, e.g. v0.1.0-rc1)");
  }
  if (!options.channel) {
    throw new Error("--channel is required (rc | release)");
  }
  return options;
};

/** Peels a tag to the commit it points at; null when the ref does not exist. */
const tagCommit = (tag) => {
  try {
    return execFileSync("git", ["rev-parse", "--verify", "--quiet", `refs/tags/${tag}^{commit}`], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
};

/**
 * The fail-closed reconciliation contract. Returns the list of violations
 * (empty when the tag reconciles); exported so the release-tooling tests can
 * exercise missing-tag / wrong-commit / version-mismatch / happy paths.
 */
export const tagViolations = ({ tag, channel, rcIndex, baseVersion, sha }) => {
  const violations = [];

  if (channel === "snapshot") {
    return [
      "channel 'snapshot' is not available during the GitHub-Release distribution window: run-number-stamped snapshot versions cannot be pre-tagged by an operator",
    ];
  }

  // Manifest base version: the source of truth (a supplied --base-version is
  // a confirmation of, never an override for, the manifests).
  const rootVersion = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8")).version;
  const packageVersions = Object.fromEntries(
    publishableWorkspaces().map((workspace) => [
      workspace.name,
      JSON.parse(readFileSync(path.join(repoRoot, workspace.path, "package.json"), "utf8")).version,
    ]),
  );
  try {
    assertBaseVersionAgreement(rootVersion, packageVersions);
  } catch (error) {
    violations.push(error.message);
    return violations;
  }
  if (baseVersion && baseVersion !== rootVersion) {
    violations.push(
      `--base-version ${baseVersion} disagrees with the manifest base version ${rootVersion}`,
    );
    return violations;
  }

  let expectedTag;
  try {
    expectedTag = expectedReleaseTag({ channel, baseVersion: rootVersion, rcIndex });
  } catch (error) {
    violations.push(error.message);
    return violations;
  }

  // 1. The tag must exist (before anything expensive runs).
  const commit = tagCommit(tag);
  if (commit === null) {
    violations.push(
      `tag '${tag}' does not exist in the repository (create and push it on the release commit first; expected '${expectedTag}' for channel '${channel}')`,
    );
    return violations;
  }

  // 2. The tag must point at the dispatch commit.
  if (typeof sha !== "string" || sha.length === 0) {
    violations.push("no dispatch commit to reconcile against (pass --sha or set GITHUB_SHA)");
    return violations;
  }
  if (commit !== sha) {
    violations.push(
      `tag '${tag}' points at commit ${commit} but the dispatch commit is ${sha} (create the tag on the dispatched commit)`,
    );
  }

  // 3. The tag must equal v<resolved-full-version>.
  if (tag !== expectedTag) {
    violations.push(
      `tag '${tag}' does not match the resolved channel version (expected '${expectedTag}' for channel '${channel}'${rcIndex !== null && rcIndex !== undefined ? `, rc-index ${rcIndex}` : ""})`,
    );
  }

  return violations;
};

const main = () => {
  const options = (() => {
    try {
      return parseTagArgs(process.argv.slice(2));
    } catch (error) {
      fail(error.message);
    }
  })();
  const sha = options.sha ?? process.env.GITHUB_SHA ?? null;
  const violations = tagViolations({ ...options, sha });
  if (violations.length > 0) {
    for (const violation of violations) {
      fail(violation);
    }
    return;
  }
  const expectedTag = expectedReleaseTag({
    channel: options.channel,
    baseVersion: JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8")).version,
    rcIndex: options.rcIndex,
  });
  console.log(
    `[verify-release-tag] tag '${options.tag}' reconciled: exists, points at the dispatch commit, and matches ${expectedTag} (channel '${options.channel}')`,
  );
};

const isDirectExecution =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectExecution) {
  main();
}
