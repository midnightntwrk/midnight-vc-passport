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

// Clean-consumer installation tests (npm-publication: "Pre-publication gate"
// and "Post-publication registry verification"). Ported from
// midnight-verifiable-credentials; the consumer evidence reuses this
// repository's existing smoke round-trip
// (packages/smoke-consumer/scripts/round-trip.mjs) instead of VC's fixture
// matrix.
//
// Modes:
//   tarball mode (default):
//     node tooling/scripts/test-release-package-consumers.mjs [--artifacts-dir <dir>]
//     For every packed tarball: create a clean project, install the tarball
//     with registry-only transitive resolution, and (for the family package)
//     run the issuance/presentation/verification round-trip.
//
//   registry mode:
//     node tooling/scripts/test-release-package-consumers.mjs --registry <url> --version <version>
//     Install the published version — and its transitive dependencies — from
//     the public registry and run the same round-trip.

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { publishableWorkspaces } from "./workspace-catalog.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const FAMILY = "@midnight-ntwrk/midnight-verifiable-credential-digital-passport";
const NETWORK_ID = "@midnight-ntwrk/midnight-js-network-id";
const ROUND_TRIP = path.join(repoRoot, "packages/smoke-consumer/scripts/round-trip.mjs");

const SEMVER = /^\d+\.\d+\.\d+(-[\w.-]+)?$/u;

const fail = (message) => {
  console.error(`[test-release-package-consumers] ${message}`);
  process.exit(1);
};

const run = (cmd, args, options = {}) => {
  const result = spawnSync(cmd, args, {
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    ...options,
  });
  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
  if (result.status !== 0) {
    throw new Error(`\`${[cmd, ...args].join(" ")}\` exited with status ${result.status}`);
  }
  return result;
};

/** Argument validation shared by both entry styles (covered by tooling tests). */
export const parseConsumerArgs = (argv) => {
  const options = { registry: null, version: null, artifactsDir: null, mode: "tarball" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--registry") {
      options.registry = argv[++index];
    } else if (arg === "--version") {
      options.version = argv[++index];
    } else if (arg === "--artifacts-dir") {
      options.artifactsDir = argv[++index];
    } else {
      throw new Error(`unknown argument ${arg}`);
    }
  }
  if (options.registry !== null || options.version !== null) {
    if (options.registry === null || options.version === null) {
      throw new Error("--registry and --version must be used together (registry mode)");
    }
    if (!/^https:\/\/[^/]+/u.test(options.registry)) {
      throw new Error(`--registry must be an https URL (got ${options.registry})`);
    }
    if (!SEMVER.test(options.version)) {
      throw new Error(`--version must be a semantic version (got ${options.version})`);
    }
    options.mode = "registry";
  }
  return options;
};

/** Runs the round-trip in a clean project that has the family package installed. */
const consumerRoundTrip = (isolated, { label }) => {
  cpSync(ROUND_TRIP, path.join(isolated, "round-trip.mjs"));
  console.log(`${label}: running the issuance/presentation/verification round-trip`);
  run("node", ["round-trip.mjs"], { cwd: isolated });
};

/** Creates the clean consumer project skeleton shared by both modes. */
const cleanProject = () => {
  const isolated = mkdtempSync(path.join(tmpdir(), "release-consumer-"));
  writeFileSync(
    path.join(isolated, "package.json"),
    `${JSON.stringify(
      {
        name: "release-consumer-isolated",
        version: "0.0.0",
        private: true,
        type: "module",
        packageManager: "pnpm@10.34.1",
      },
      null,
      2,
    )}\n`,
  );
  return isolated;
};

/** Reads `package/package.json` out of a packed tarball, failing closed. */
export const readTarballManifest = (tarball) => {
  const result = spawnSync("tar", ["-xzOf", tarball, "package/package.json"], { encoding: "utf8" });
  if (result.status !== 0 || !result.stdout?.trim()) {
    throw new Error(
      `cannot read package/package.json from ${path.basename(tarball)}: ${
        (result.stderr ?? "").trim() || `tar exited with status ${result.status} and no output`
      }`,
    );
  }
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`package/package.json in ${path.basename(tarball)} is not valid JSON (${error.message})`);
  }
};

const publishableNames = new Set(publishableWorkspaces().map((workspace) => workspace.name));

const testTarball = async (tarball) => {
  const isolated = cleanProject();
  console.log(`tarball consumer: clean project at ${isolated} for ${path.basename(tarball)}`);
  try {
    // Read the manifest first and fail closed: a tarball whose manifest
    // cannot be read (corrupt archive, missing package/package.json, invalid
    // JSON) must abort the consumer test — it may never be downgraded to an
    // install-only check that still prints PASS.
    const manifest = readTarballManifest(tarball);
    if (typeof manifest.name !== "string" || !publishableNames.has(manifest.name)) {
      throw new Error(
        `${path.basename(tarball)} does not carry a cataloged publishable workspace ` +
          `(manifest name: ${manifest.name ?? "<missing>"})`,
      );
    }
    // Copy the tarball into the clean project and add it by a short relative
    // path (mirroring the smoke lane): pnpm derives its store filename from
    // the tarball's full path, so installing from a long artifacts directory
    // (e.g. /home/runner/work/<repo>/<repo>/tooling/artifacts/npm/...) overflows
    // the 255-byte filename limit with ERR_PNPM_ENAMETOOLONG.
    const tarballName = path.basename(tarball);
    cpSync(tarball, path.join(isolated, tarballName));
    // The network-id helper the round-trip uses is a devDependency of the
    // smoke workspace; install it alongside the tarball so the isolated
    // project mirrors the smoke lane's resolution.
    run("pnpm", ["add", `./${tarballName}`, NETWORK_ID], { cwd: isolated });
    if (manifest.name === FAMILY) {
      consumerRoundTrip(isolated, { label: "tarball consumer" });
    } else {
      console.log(`tarball consumer: install-only check for ${manifest.name}`);
    }
    console.log(`tarball consumer: PASS for ${path.basename(tarball)}`);
  } finally {
    rmSync(isolated, { recursive: true, force: true });
  }
};

const testRegistry = (registry, version) => {
  const isolated = cleanProject();
  console.log(`registry consumer: clean project at ${isolated}`);
  try {
    console.log(`registry consumer: installing ${FAMILY}@${version} from ${registry}`);
    run(
      "pnpm",
      ["add", "--registry", registry, `${FAMILY}@${version}`, NETWORK_ID],
      { cwd: isolated },
    );
    consumerRoundTrip(isolated, { label: "registry consumer" });
    console.log(`registry consumer: PASS for ${FAMILY}@${version}`);
  } finally {
    rmSync(isolated, { recursive: true, force: true });
  }
};

const main = async () => {
  if (!existsSync(ROUND_TRIP)) {
    fail(`round-trip runner not found at ${ROUND_TRIP}`);
  }
  const options = (() => {
    try {
      return parseConsumerArgs(process.argv.slice(2));
    } catch (error) {
      fail(error.message);
    }
  })();

  if (options.mode === "registry") {
    testRegistry(options.registry, options.version);
    return;
  }

  const dir =
    options.artifactsDir ??
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../artifacts/npm");
  if (!existsSync(dir)) {
    fail(`no artifacts directory at ${dir} (run artifacts:pack first)`);
  }
  const tarballs = readdirSync(dir)
    .filter((file) => file.endsWith(".tgz"))
    .map((file) => path.join(dir, file));
  if (tarballs.length === 0) {
    fail(`no packed tarballs found in ${dir}`);
  }
  const publishable = publishableWorkspaces();
  if (tarballs.length !== publishable.length) {
    fail(
      `expected ${publishable.length} tarball(s) for the cataloged publishable workspaces, found ${tarballs.length}`,
    );
  }
  for (const tarball of tarballs) {
    await testTarball(tarball);
  }
  console.log(`\nAll consumer tests passed (${tarballs.length} tarball(s)).`);
};

const isDirectExecution =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectExecution) {
  await main();
}
