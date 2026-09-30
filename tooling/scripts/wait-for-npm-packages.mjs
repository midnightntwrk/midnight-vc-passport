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

// Convergence gate (npm-publication: "Verified post-publication registry
// checks" — bounded convergence). Modelled on midnight-did's post-incident
// fix for registry read-after-write lag (midnight-did#443). The single place
// that polls for propagation: after the publish step reports Accepted, it
// polls the public registry every --interval seconds (default 30) for at most
// --timeout seconds (default 300) — every request individually time-bounded —
// until each supported package's exact version is Visible: served by the
// registry, its payload identical to the packed tarball
// (npm-package-identity.mjs), and the channel's dist-tag resolving to it.
//
//   - pending: only a recognised E404 for the exact version, or a valid
//     dist-tag that does not point at it yet;
//   - fails immediately: any other command failure or request timeout,
//     malformed metadata, a payload mismatch, or a non-`release` version
//     owning `latest`;
//   - fails at the deadline: still pending, or evidence that arrived only
//     after the deadline.
//
// CLI:
//   wait-for-npm-packages.mjs --version <v> --npm-tag <snapshot|rc|latest>
//                             [--timeout <seconds>] [--interval <seconds>]
//                             [--request-timeout <seconds>] [--artifacts-dir <dir>]
//                             [--registry <url>] [--view-cmd <cmd>]

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { verifyPayloadIdentity } from "./npm-package-identity.mjs";
import { supportedWorkspacePaths } from "./workspace-catalog.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const NPM_PUBLIC_REGISTRY = "https://registry.npmjs.org/";
const SEMVER = /^\d+\.\d+\.\d+(-[\w.-]+)?$/u;
const E404 = /\bE404\b/u;

export const parseWaitArgs = (argv) => {
  const options = {
    version: null,
    npmTag: null,
    timeout: 300,
    interval: 30,
    requestTimeout: 30,
    artifactsDir: path.join(repoRoot, "tooling/artifacts/npm"),
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
      case "--request-timeout":
        options.requestTimeout = Number(argv[++index]);
        break;
      case "--artifacts-dir":
        options.artifactsDir = path.resolve(argv[++index]);
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
  if (!["snapshot", "rc", "latest"].includes(options.npmTag)) {
    throw new Error("--npm-tag is required (snapshot | rc | latest)");
  }
  if (options.registry !== NPM_PUBLIC_REGISTRY) {
    throw new Error(
      `registry must be locked to ${NPM_PUBLIC_REGISTRY} (got ${options.registry})`,
    );
  }
  for (const [flag, value] of [
    ["--timeout", options.timeout],
    ["--interval", options.interval],
    ["--request-timeout", options.requestTimeout],
  ]) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`${flag} must be a positive number of seconds`);
    }
  }
  return options;
};

const splitCommand = (command) => command.trim().split(/\s+/u);

/** The default registry read: `npm view <name@version> --json`, time-bounded. */
export const npmViewCommand = ({ viewCmd, registry, requestTimeout }) => (target) => {
  const [command, ...prefix] = splitCommand(viewCmd);
  return spawnSync(command, [...prefix, target, "--json", "--registry", registry], {
    encoding: "utf8",
    timeout: requestTimeout * 1000,
  });
};

class GateFailure extends Error {}

/**
 * Classifies one exact-version registry read. Returns `{ state: "absent" }`
 * for a recognised E404, `{ state: "present", doc }` for strictly valid
 * metadata, and throws a GateFailure for everything else.
 */
export const classifyView = (result, { name, version }) => {
  const target = `${name}@${version}`;
  if (result.error) {
    throw new GateFailure(`registry read for ${target} failed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const output = `${result.stderr ?? ""}${result.stdout ?? ""}`;
    if (E404.test(output)) {
      return { state: "absent" };
    }
    throw new GateFailure(
      `registry read for ${target} failed with status ${result.status} (not a recognised E404): ${output.trim()}`,
    );
  }
  let doc;
  try {
    doc = JSON.parse(result.stdout);
  } catch (error) {
    throw new GateFailure(`registry metadata for ${target} is not valid JSON (${error.message})`);
  }
  const malformed = (what) => new GateFailure(`registry metadata for ${target} is malformed: ${what}`);
  if (doc === null || typeof doc !== "object" || Array.isArray(doc)) {
    throw malformed("not a version document");
  }
  if (doc.version !== version) {
    throw malformed(`version is ${JSON.stringify(doc.version)}`);
  }
  if (typeof doc.dist?.integrity !== "string" || !doc.dist.integrity.startsWith("sha512-")) {
    throw malformed("missing a sha512 dist.integrity");
  }
  if (typeof doc.dist?.tarball !== "string" || doc.dist.tarball === "") {
    throw malformed("missing dist.tarball");
  }
  const tags = doc["dist-tags"];
  if (tags === null || typeof tags !== "object" || Array.isArray(tags)) {
    throw malformed("missing dist-tags");
  }
  for (const [tag, value] of Object.entries(tags)) {
    if (typeof value !== "string") {
      throw malformed(`dist-tag '${tag}' is not a version string`);
    }
  }
  return { state: "present", doc };
};

/**
 * Waits until `name@version` is Visible. Time (`now`, `sleep`), the registry
 * read (`view`), and the payload check (`payload`) are injectable so tests
 * run against a fake clock. Resolves on convergence; rejects with the reason
 * otherwise.
 */
export const waitForVisible = async ({
  name,
  version,
  npmTag,
  timeoutMs,
  intervalMs,
  view,
  payload,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  log = console.log,
  start = now(),
}) => {
  const target = `${name}@${version}`;
  const deadline = start + timeoutMs;
  for (;;) {
    const observation = classifyView(view(target), { name, version });
    const observedAt = now();
    const elapsed = Math.round((observedAt - start) / 1000);
    if (observation.state === "present") {
      if (observedAt > deadline) {
        throw new GateFailure(
          `${target} was observed on the registry ${elapsed}s after acceptance — after the ${timeoutMs / 1000}s deadline; the evidence arrived too late`,
        );
      }
      const { doc } = observation;
      const identity = await payload({ integrity: doc.dist.integrity, tarballUrl: doc.dist.tarball });
      if (!identity.match) {
        throw new GateFailure(
          `${target} on the registry is not the packed payload: ${identity.differences.join("; ")}`,
        );
      }
      const tags = doc["dist-tags"];
      if (npmTag !== "latest" && tags.latest === version) {
        throw new GateFailure(
          `'latest' resolves to the non-release version ${version}; a ${npmTag} publication must never own 'latest'`,
        );
      }
      if (tags[npmTag] === version) {
        log(
          `[wait-for-npm-packages] ${target} is Visible after ${elapsed}s: payload ${identity.method === "integrity" ? "integrity" : "content"} matches and dist-tag '${npmTag}' resolves to it`,
        );
        return;
      }
      log(
        `[wait-for-npm-packages] ${target} is served but dist-tag '${npmTag}' resolves to ${tags[npmTag] ?? "<unset>"} (${elapsed}s elapsed)`,
      );
    } else {
      log(`[wait-for-npm-packages] ${target} is not served yet (E404, ${elapsed}s elapsed)`);
    }
    const remaining = deadline - now();
    if (remaining <= 0) {
      throw new GateFailure(
        `timed out after ${timeoutMs / 1000}s: ${target} is not Visible (Accepted, propagation timed out)`,
      );
    }
    await sleep(Math.min(intervalMs, remaining));
  }
};

/** The packed tarball for each package name in the artifacts directory. */
const packedTarballs = (artifactsDir) => {
  if (!existsSync(artifactsDir)) {
    throw new Error(`no artifacts directory at ${artifactsDir} (run artifacts:pack first)`);
  }
  const byName = new Map();
  for (const file of readdirSync(artifactsDir).filter((entry) => entry.endsWith(".tgz"))) {
    const tarball = path.join(artifactsDir, file);
    const result = spawnSync("tar", ["-xzOf", tarball, "package/package.json"], { encoding: "utf8" });
    if (result.status !== 0) {
      throw new Error(`cannot read package/package.json from ${file}`);
    }
    byName.set(JSON.parse(result.stdout).name, tarball);
  }
  return byName;
};

const main = async () => {
  const options = parseWaitArgs(process.argv.slice(2));
  const names = supportedWorkspacePaths().map(
    (workspacePath) =>
      JSON.parse(
        readFileSync(path.join(repoRoot, workspacePath, "package.json"), "utf8"),
      ).name,
  );
  const tarballs = packedTarballs(options.artifactsDir);
  const view = npmViewCommand(options);
  // One deadline for the whole gate, measured from the step's start (in
  // practice the moment of acceptance).
  const start = Date.now();
  for (const name of names) {
    const tarball = tarballs.get(name);
    if (!tarball) {
      throw new Error(`no packed tarball for ${name} in ${options.artifactsDir}`);
    }
    await waitForVisible({
      name,
      version: options.version,
      npmTag: options.npmTag,
      timeoutMs: options.timeout * 1000,
      intervalMs: options.interval * 1000,
      view,
      payload: ({ integrity, tarballUrl }) => verifyPayloadIdentity({ tarball, integrity, tarballUrl }),
      start,
    });
  }
  console.log(
    `[wait-for-npm-packages] all ${names.length} package(s) Visible at version ${options.version}`,
  );
};

const isDirectExecution =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectExecution) {
  try {
    await main();
  } catch (error) {
    console.error(`[wait-for-npm-packages] ${error.message}`);
    process.exit(1);
  }
}
