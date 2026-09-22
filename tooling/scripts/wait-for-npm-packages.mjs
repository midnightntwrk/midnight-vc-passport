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

// Registry propagation wait (npm-publication: "Post-publication registry
// verification"). Ported from midnight-verifiable-credentials. Polls the
// public registry until every supported package's release version is visible.
//
// CLI:
//   wait-for-npm-packages.mjs --version <v> --npm-tag <snapshot|rc|latest>
//                                     [--timeout <seconds>] [--interval <seconds>]
//                                     [--registry <url>] [--view-cmd <cmd>]

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { supportedWorkspacePaths } from "./workspace-catalog.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const NPM_PUBLIC_REGISTRY = "https://registry.npmjs.org/";
const SEMVER = /^\d+\.\d+\.\d+(-[\w.-]+)?$/u;

const parseArgs = (argv) => {
  const options = {
    version: null,
    npmTag: null,
    timeout: 300,
    interval: 10,
    registry: process.env.NPM_REGISTRY ?? NPM_PUBLIC_REGISTRY,
    viewCmd: process.env.NPM_VIEW_COMMAND ?? "npm view",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--version":
        options.version = argv[++index];
        break;
      case "--npm-tag":
        options.npmTag = argv[++index];
        break;
      case "--timeout":
        options.timeout = Number(argv[++index]);
        break;
      case "--interval":
        options.interval = Number(argv[++index]);
        break;
      case "--registry":
        options.registry = argv[++index];
        break;
      case "--view-cmd":
        options.viewCmd = argv[++index];
        break;
      default:
        throw new Error(`unknown argument ${arg}`);
    }
  }
  if (!options.version || !SEMVER.test(options.version)) {
    throw new Error("--version is required and must be a semantic version");
  }
  if (!options.npmTag) {
    throw new Error("--npm-tag is required (snapshot | rc | latest)");
  }
  if (options.registry !== NPM_PUBLIC_REGISTRY) {
    throw new Error(
      `registry must be locked to ${NPM_PUBLIC_REGISTRY} (got ${options.registry})`,
    );
  }
  if (!Number.isFinite(options.timeout) || options.timeout <= 0) {
    throw new Error("--timeout must be a positive number of seconds");
  }
  return options;
};

const splitCommand = (command) => command.trim().split(/\s+/u);

const versionVisible = (name, version, options) => {
  const result = spawnSync(
    splitCommand(options.viewCmd)[0],
    [
      ...splitCommand(options.viewCmd).slice(1),
      `${name}@${version}`,
      "version",
      "--json",
      "--registry",
      options.registry,
    ],
    { encoding: "utf8" },
  );
  return result.status === 0 && result.stdout.trim() === JSON.stringify(version);
};

/** The release dist-tag must resolve to the published version as well: the
 * subsequent dist-tag verification gates on it, so propagation of the tag is
 * waited for here rather than failing the verify step on registry lag. */
const distTagPointsAt = (name, version, npmTag, options) => {
  const result = spawnSync(
    splitCommand(options.viewCmd)[0],
    [
      ...splitCommand(options.viewCmd).slice(1),
      name,
      `dist-tags.${npmTag}`,
      "--json",
      "--registry",
      options.registry,
    ],
    { encoding: "utf8" },
  );
  return result.status === 0 && result.stdout.trim() === JSON.stringify(version);
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  const names = supportedWorkspacePaths().map(
    (workspacePath) =>
      JSON.parse(
        readFileSync(path.join(repoRoot, workspacePath, "package.json"), "utf8"),
      ).name,
  );

  const deadline = Date.now() + options.timeout * 1000;
  const pending = new Set(names);
  while (pending.size > 0) {
    for (const name of [...pending]) {
      if (
        versionVisible(name, options.version, options) &&
        distTagPointsAt(name, options.version, options.npmTag, options)
      ) {
        console.log(
          `[wait-for-npm-packages] ${name}@${options.version} is visible on the registry with dist-tag '${options.npmTag}'`,
        );
        pending.delete(name);
      }
    }
    if (pending.size === 0) {
      break;
    }
    if (Date.now() >= deadline) {
      console.error(
        `[wait-for-npm-packages] timed out after ${options.timeout}s waiting for: ${[...pending].join(", ")}`,
      );
      process.exit(1);
    }
    await sleep(options.interval * 1000);
  }
  console.log(
    `[wait-for-npm-packages] all ${names.length} package(s) propagated at version ${options.version}`,
  );
};

try {
  await main();
} catch (error) {
  console.error(`[wait-for-npm-packages] ${error.message}`);
  process.exit(1);
}
