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

// Clean-consumer installation tests (npm-publication: "Pre-publication gate"
// and "Verified post-publication registry checks"). Ported from
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
//     Resolve the exact tarball the registry serves for the published version
//     (`npm view … dist.tarball --prefer-online`), install that URL in a clean
//     project with a run-private pnpm store and cache (so no metadata cached
//     before the publication can be consulted) and dependencies resolved from
//     the public registry, and run the same round-trip. The install is
//     attempted at most 3 times, 10 seconds apart.

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { parse as parseYaml } from "yaml";

import { publishableWorkspaces } from "./workspace-catalog.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const FAMILY = "@midnight-ntwrk/midnight-vc-passport";
const NETWORK_ID = "@midnight-ntwrk/midnight-js-network-id";

const SEMVER = /^\d+\.\d+\.\d+(-[\w.-]+)?$/u;

const ROUND_TRIP = path.join(repoRoot, "packages/smoke-consumer/scripts/round-trip.mjs");

/** Registry-mode install budget (design D5): 3 attempts, 10 seconds apart. */
export const REGISTRY_INSTALL_ATTEMPTS = 3;
export const REGISTRY_INSTALL_DELAY_MS = 10_000;

const fail = (message) => {
  console.error(`[test-release-package-consumers] ${message}`);
  process.exit(1);
};

// `pnpm run` injects the workspace's own pnpm settings (including
// `minimumReleaseAge`) into child environments as `npm_config_*` variables,
// but cannot carry the exclusion list through the environment. Those leaked
// variables are stripped (they would override the clean project's own
// policy), and the clean project instead gets the workspace's release-age
// floor and exclusions mirrored into its own pnpm-workspace.yaml — the same
// approach as packages/smoke-consumer/scripts/smoke.mjs.
const consumerEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !/release.?age/iu.test(key)),
);

const run = (cmd, args, options = {}) => {
  const result = spawnSync(cmd, args, {
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    env: consumerEnv,
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

/** Argument validation shared by the entry styles (covered by tooling tests). */
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

/**
 * The workspace's supply-chain release-age policy (pnpm-workspace.yaml), read
 * from the file so leaked environment variables cannot shadow it. Fail-closed:
 * without a floor the consumer test refuses to install anything. The package
 * under test is always excluded on top of the workspace list: it is our own
 * package, and registry mode installs it moments after publication.
 */
export const releaseAgePolicy = (workspaceFile = path.join(repoRoot, "pnpm-workspace.yaml")) => {
  const workspace = parseYaml(readFileSync(workspaceFile, "utf8")) ?? {};
  const { minimumReleaseAge } = workspace;
  if (!Number.isInteger(minimumReleaseAge) || minimumReleaseAge <= 0) {
    throw new Error(
      "the workspace declares no minimumReleaseAge floor; refusing to install without a release-age policy",
    );
  }
  const exclude = [...(workspace.minimumReleaseAgeExclude ?? []), FAMILY];
  return { minimumReleaseAge, minimumReleaseAgeExclude: [...new Set(exclude)] };
};

/** Serializes the policy as the clean project's pnpm-workspace.yaml. */
const renderReleaseAgePolicy = ({ minimumReleaseAge, minimumReleaseAgeExclude }) =>
  `${[
    "# Supply-chain policy mirrored from the repository workspace",
    "# (pnpm-workspace.yaml), plus the package under test.",
    `minimumReleaseAge: ${minimumReleaseAge}`,
    "minimumReleaseAgeExclude:",
    ...minimumReleaseAgeExclude.map((entry) => `  - '${String(entry).replaceAll("'", "''")}'`),
  ].join("\n")}\n`;

/** Creates the clean consumer project skeleton shared by every mode. */
const cleanProject = () => {
  const isolated = mkdtempSync(path.join(tmpdir(), "release-consumer-"));
  writeFileSync(
    path.join(isolated, "pnpm-workspace.yaml"),
    renderReleaseAgePolicy(releaseAgePolicy()),
  );
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

/** Resolves the exact tarball URL the registry serves, bypassing local metadata caches. */
const resolveTarballUrl = (registry, version) => {
  const result = run("npm", [
    "view",
    `${FAMILY}@${version}`,
    "dist.tarball",
    "--json",
    "--prefer-online",
    "--registry",
    registry,
  ]);
  let url;
  try {
    url = JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`registry metadata for ${FAMILY}@${version} is not valid JSON (${error.message})`);
  }
  if (typeof url !== "string" || !/^https:\/\//u.test(url)) {
    throw new Error(`registry returned no https dist.tarball for ${FAMILY}@${version} (got ${JSON.stringify(url)})`);
  }
  return url;
};

/**
 * Points the clean project's pnpm at a run-private store and cache, and asks
 * for fresh registry metadata. Returns the environment the install runs
 * with: environment config outranks every .npmrc, so no ambient store/cache
 * setting can re-route the install to a pre-seeded cache.
 */
const privatePackageManagerState = (isolated, state) => {
  const storeDir = path.join(state, "store");
  const cacheDir = path.join(state, "cache");
  mkdirSync(storeDir);
  mkdirSync(cacheDir);
  writeFileSync(
    path.join(isolated, ".npmrc"),
    `store-dir=${storeDir}\ncache-dir=${cacheDir}\nprefer-offline=false\n`,
  );
  const env = Object.fromEntries(
    Object.entries(consumerEnv).filter(([key]) => !/^npm_config_(store_dir|cache_dir|prefer_offline|offline)$/iu.test(key)),
  );
  return {
    storeDir,
    cacheDir,
    env: {
      ...env,
      npm_config_store_dir: storeDir,
      npm_config_cache_dir: cacheDir,
      npm_config_prefer_offline: "false",
    },
  };
};

const pnpmAdd = ({ cwd, env, specs }) => run("pnpm", ["add", ...specs], { cwd, env });

/**
 * Registry mode. The collaborators are injectable so tooling tests exercise
 * the retry budget and cache isolation without the network.
 */
export const testRegistry = async (
  registry,
  version,
  {
    resolveUrl = resolveTarballUrl,
    install = pnpmAdd,
    roundTrip = (isolated) => consumerRoundTrip(isolated, { label: "registry consumer" }),
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    attempts = REGISTRY_INSTALL_ATTEMPTS,
    delayMs = REGISTRY_INSTALL_DELAY_MS,
  } = {},
) => {
  const isolated = cleanProject();
  const state = mkdtempSync(path.join(tmpdir(), "release-consumer-state-"));
  console.log(`registry consumer: clean project at ${isolated}`);
  try {
    const tarballUrl = resolveUrl(registry, version);
    const { env } = privatePackageManagerState(isolated, state);
    console.log(`registry consumer: installing ${tarballUrl} (${FAMILY}@${version}) with a run-private store and cache`);
    for (let attempt = 1; ; attempt += 1) {
      try {
        await install({ cwd: isolated, env, specs: [tarballUrl, NETWORK_ID] });
        break;
      } catch (error) {
        if (attempt >= attempts) {
          throw new Error(`registry install failed after ${attempts} attempt(s): ${error.message}`);
        }
        console.error(
          `registry consumer: install attempt ${attempt}/${attempts} failed (${error.message}); retrying in ${delayMs / 1000}s`,
        );
        await sleep(delayMs);
      }
    }
    await roundTrip(isolated);
    console.log(`registry consumer: PASS for ${FAMILY}@${version}`);
  } finally {
    rmSync(isolated, { recursive: true, force: true });
    rmSync(state, { recursive: true, force: true });
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
    try {
      await testRegistry(options.registry, options.version);
    } catch (error) {
      fail(error.message);
    }
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
