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

// npm release state (npm-publication: "Dist-tag safety and idempotency").
// Ported from midnight-verifiable-credentials. Snapshots the npm dist-tags
// before publication and verifies them afterwards, failing closed on drift —
// in particular protecting an existing `latest` during snapshot/rc publications.
//
// CLI:
//   npm-release-state.mjs --snapshot [--out <file>] [--registry <url>] [--view-cmd <cmd>]
//   npm-release-state.mjs --verify [--snapshot-file <file>] [--version <v>] [--npm-tag <tag>]
//                          [--protect-latest] [--repair] [--registry <url>]
//                          [--view-cmd <cmd>] [--dist-tag-cmd <cmd>]
//
// --view-cmd (default "npm view") and --dist-tag-cmd (default "npm dist-tag")
// allow the tooling tests to substitute a mocked registry view.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { supportedWorkspacePaths } from "./workspace-catalog.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const NPM_PUBLIC_REGISTRY = "https://registry.npmjs.org/";
const DEFAULT_STATE_FILE = path.join(repoRoot, "tooling/artifacts/npm-release-state.json");

const publishableNames = () =>
  supportedWorkspacePaths().map((workspacePath) =>
    JSON.parse(readFileSync(path.join(repoRoot, workspacePath, "package.json"), "utf8")).name,
  );

const splitCommand = (command) => command.trim().split(/\s+/u);

const viewDistTags = (name, { viewCmd, registry }) => {
  const result = spawnSync(
    splitCommand(viewCmd)[0],
    [...splitCommand(viewCmd).slice(1), name, "dist-tags", "--json", "--registry", registry],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    const output = `${result.stderr ?? ""}${result.stdout ?? ""}`;
    if (/E404/u.test(output)) {
      // The package has never been published: the first publication has no
      // prior dist-tag state to protect, so the snapshot is empty. Any other
      // registry error still fails closed.
      return {};
    }
    throw new Error(
      `registry view failed for ${name}: ${result.stderr || result.stdout}`,
    );
  }
  return JSON.parse(result.stdout);
};

const setDistTag = (name, version, tag, { distTagCmd, registry }) => {
  const result = spawnSync(
    splitCommand(distTagCmd)[0],
    [
      ...splitCommand(distTagCmd).slice(1),
      "add",
      `${name}@${version}`,
      tag,
      "--registry",
      registry,
    ],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(
      `dist-tag repair failed for ${name}@${version} -> ${tag}: ${result.stderr || result.stdout}`,
    );
  }
};

const parseArgs = (argv) => {
  const options = {
    snapshot: false,
    verify: false,
    out: null,
    snapshotFile: null,
    version: null,
    npmTag: null,
    protectLatest: false,
    repair: false,
    registry: process.env.NPM_REGISTRY ?? NPM_PUBLIC_REGISTRY,
    viewCmd: process.env.NPM_VIEW_COMMAND ?? "npm view",
    distTagCmd: process.env.NPM_DIST_TAG_COMMAND ?? "npm dist-tag",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--snapshot":
        options.snapshot = true;
        break;
      case "--verify":
        options.verify = true;
        break;
      case "--out":
        options.out = argv[++index];
        break;
      case "--snapshot-file":
        options.snapshotFile = argv[++index];
        break;
      case "--version":
        options.version = argv[++index];
        break;
      case "--npm-tag":
        options.npmTag = argv[++index];
        break;
      case "--protect-latest":
        options.protectLatest = true;
        break;
      case "--repair":
        options.repair = true;
        break;
      case "--registry":
        options.registry = argv[++index];
        break;
      case "--view-cmd":
        options.viewCmd = argv[++index];
        break;
      case "--dist-tag-cmd":
        options.distTagCmd = argv[++index];
        break;
      default:
        throw new Error(`unknown argument ${arg}`);
    }
  }
  if (options.registry !== NPM_PUBLIC_REGISTRY) {
    throw new Error(
      `registry must be locked to ${NPM_PUBLIC_REGISTRY} (got ${options.registry})`,
    );
  }
  if (options.snapshot === options.verify) {
    throw new Error("exactly one of --snapshot or --verify is required");
  }
  if (options.verify && options.npmTag !== null && options.version === null) {
    throw new Error("--npm-tag requires --version");
  }
  if (options.protectLatest && options.version === null) {
    throw new Error("--protect-latest requires --version");
  }
  if (options.repair && (options.npmTag === null || options.version === null)) {
    throw new Error("--repair requires --npm-tag and --version");
  }
  return options;
};

const main = () => {
  const options = parseArgs(process.argv.slice(2));
  const names = publishableNames();

  if (options.snapshot) {
    const state = {
      capturedAt: new Date().toISOString(),
      registry: options.registry,
      packages: Object.fromEntries(
        names.map((name) => [name, { distTags: viewDistTags(name, options) }]),
      ),
    };
    const outFile = options.out ?? DEFAULT_STATE_FILE;
    writeFileSync(outFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    console.log(`[npm-release-state] snapshot written to ${outFile}`);
    for (const name of names) {
      console.log(
        `[npm-release-state] ${name}: ${JSON.stringify(state.packages[name].distTags)}`,
      );
    }
    return;
  }

  // --verify
  const snapshotFile = options.snapshotFile ?? DEFAULT_STATE_FILE;
  if (!existsSync(snapshotFile)) {
    throw new Error(`snapshot file not found: ${snapshotFile} (run --snapshot first)`);
  }
  const snapshot = JSON.parse(readFileSync(snapshotFile, "utf8"));
  const failures = [];
  const repairs = [];

  for (const name of names) {
    const before = snapshot.packages?.[name]?.distTags;
    if (!before) {
      failures.push(`${name}: no dist-tag snapshot recorded`);
      continue;
    }
    const after = viewDistTags(name, options);

    if (options.npmTag !== null) {
      if (after[options.npmTag] !== options.version) {
        if (options.repair) {
          setDistTag(name, options.version, options.npmTag, options);
          repairs.push(`${name}: dist-tag '${options.npmTag}' repaired to ${options.version}`);
          const repaired = viewDistTags(name, options);
          if (repaired[options.npmTag] !== options.version) {
            failures.push(`${name}: dist-tag '${options.npmTag}' repair did not take effect`);
          }
        } else {
          failures.push(
            `${name}: dist-tag '${options.npmTag}' resolves to ${after[options.npmTag] ?? "<unset>"} but ${options.version} was expected`,
          );
        }
      }
    }

    if (options.protectLatest && options.npmTag !== "latest") {
      if (before.latest === undefined) {
        // First publication of this package: the npmjs registry always sets
        // 'latest' to the very first published version, even when publishing
        // with a non-latest dist-tag (precedent: @midnight-ntwrk/credential-model,
        // first published as 0.1.0-rc1, still carries 'latest' on an rc). The
        // tag cannot be removed once set, so tolerate it on first publication —
        // but only when it points at the version this run just published
        // (--protect-latest always runs with --version, enforced in parseArgs).
        if (after.latest !== undefined && after.latest !== options.version) {
          failures.push(
            `${name}: first publication set 'latest' to ${after.latest} instead of the published ${options.version}`,
          );
        }
      } else if (after.latest !== before.latest) {
        failures.push(
          `${name}: 'latest' moved from ${before.latest} to ${after.latest ?? "<unset>"} during a non-release publication`,
        );
      }
    }
  }

  for (const repair of repairs) {
    console.log(`[npm-release-state] ${repair}`);
  }
  if (failures.length > 0) {
    for (const failure of failures) {
      console.error(`[npm-release-state] ${failure}`);
    }
    process.exit(1);
  }
  console.log(
    `[npm-release-state] dist-tags verified${options.repair ? " (with repair)" : ""} for ${names.length} package(s)`,
  );
};

try {
  main();
} catch (error) {
  console.error(`[npm-release-state] ${error.message}`);
  process.exit(1);
}
