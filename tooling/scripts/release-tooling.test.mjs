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

// Release tooling test suite (repository-toolchain: "Continuous integration
// and registry-only publication self-check lanes" — release tooling
// regressions fail CI). Ported and extended from
// midnight-verifiable-credentials. Covers version computation, the workspace
// catalog, publication context rules, payload identity, the publish-script
// contract (registry lockdown, provenance flag, single publish, payload- and
// tag-checked idempotent no-op), the release package contract over sandboxed
// tarball fixtures, dist-tag state, the fake-clock convergence gate, the
// consumer tests' registry mode, SBOM generation, and the publication
// workflow guard and outcome summary. Everything runs offline: registry
// views are mocked, time is faked, and tarballs are fixtures.

import { spawn, spawnSync } from "node:child_process";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

import {
  assertBaseVersionAgreement,
  computeReleaseVersion,
} from "./prepare-release-version.mjs";
import { contractViolations } from "./check-release-package-contract.mjs";
import { catalogViolations, workspaceCatalog } from "./workspace-catalog.mjs";
import { parseConsumerArgs, readTarballManifest, releaseAgePolicy, testRegistry } from "./test-release-package-consumers.mjs";
import { downloadTarball, tarballIntegrity, verifyPayloadIdentity } from "./npm-package-identity.mjs";
import { parseWaitArgs, waitForVisible } from "./wait-for-npm-packages.mjs";
import { packageVerificationCode } from "./generate-release-sbom.mjs";
import { assertPublishWorkflow, externalActionPinningViolations } from "./check-security-workflows.mjs";
import { parse as parseYaml } from "yaml";

const SCRIPTS = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPTS, "../..");
const FAMILY = "@midnight-ntwrk/midnight-vc-passport";
const FAMILY_PATH = "packages/midnight-vc-passport";
const NPMJS = "https://registry.npmjs.org/";

const node = (args, options = {}) =>
  spawnSync(process.execPath, args, { encoding: "utf8", ...options });

const bash = (script, args, options = {}) =>
  spawnSync("bash", [script, ...args], { encoding: "utf8", ...options });

/** Extracts a JSON stdout document from a spawned node script. */
const jsonStdout = (result) => JSON.parse(result.stdout);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * Builds a synthetic npm tarball fixture with the full distribution shape
 * (manifest metadata, README, CHANGELOG, dist output, managed contract
 * exports, compact sources, helper scripts). `mutate(packageDir)` runs before
 * packing so tests can strip or corrupt parts of the package.
 */
const makeFixtureTarball = (dir, { name = FAMILY, version = "0.1.0", mutate } = {}) => {
  const staging = mkdtempSync(path.join(tmpdir(), "release-fixture-"));
  const pkg = path.join(staging, "package");
  mkdirSync(path.join(pkg, "dist", "managed", "digital-passport-credential", "contract"), {
    recursive: true,
  });
  mkdirSync(path.join(pkg, "src"), { recursive: true });
  mkdirSync(path.join(pkg, "scripts"), { recursive: true });
  writeFileSync(
    path.join(pkg, "package.json"),
    `${JSON.stringify(
      {
        name,
        version,
        license: "Apache-2.0",
        description: "fixture package for release tooling tests",
        keywords: ["fixture"],
        homepage: "https://github.com/midnightntwrk/midnight-vc-passport#readme",
        bugs: { url: "https://github.com/midnightntwrk/midnight-vc-passport/issues" },
        repository: {
          type: "git",
          url: "git+https://github.com/midnightntwrk/midnight-vc-passport.git",
          directory: FAMILY_PATH,
        },
        publishConfig: { access: "public", registry: NPMJS },
        type: "module",
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(path.join(pkg, "README.md"), "# fixture\n");
  writeFileSync(path.join(pkg, "CHANGELOG.md"), "# fixture changelog\n");
  writeFileSync(path.join(pkg, "dist", "index.js"), "export {};\n");
  writeFileSync(
    path.join(pkg, "dist", "managed", "digital-passport-credential", "contract", "index.js"),
    "export {};\n",
  );
  writeFileSync(path.join(pkg, "src", "digital-passport-credential.compact"), "// fixture\n");
  writeFileSync(path.join(pkg, "scripts", "helper.mjs"), "export {};\n");
  mutate?.(pkg);
  const tarballName = `${name.replace(/^@/u, "").replace(/\//gu, "-")}-${version}.tgz`;
  const tarball = path.join(dir, tarballName);
  execFileSync("tar", ["-czf", tarball, "-C", staging, "package"]);
  rmSync(staging, { recursive: true, force: true });
  return tarball;
};

/**
 * A mockable, stateful `npm view`. Exact-version queries (`name@version`)
 * answer MOCK_VIEW_VERSION — as the full version document (with
 * `dist-tags`, `dist.integrity` from MOCK_VIEW_INTEGRITY and `dist.tarball`
 * from MOCK_VIEW_TARBALL) when no field is requested — or a recognised E404
 * when it is unset. Dist-tag answers read MOCK_TAGS_FILE (or MOCK_VIEW_TAGS).
 * Every call is appended to MOCK_VIEW_LOG when set.
 */
const MOCK_VIEW = (dir) => {
  const script = path.join(dir, "mock-view.mjs");
  writeFileSync(
    script,
    `${[
      "import { appendFileSync, existsSync, readFileSync } from 'node:fs';",
      "const args = process.argv.slice(2);",
      "if (process.env.MOCK_VIEW_LOG) appendFileSync(process.env.MOCK_VIEW_LOG, args.join(' ') + '\\n');",
      "if (process.env.MOCK_VIEW_MISSING) { console.error('npm error code E404'); process.exit(1); }",
      "if (process.env.MOCK_VIEW_BROKEN) { console.error('npm error code E500'); process.exit(1); }",
      "const target = args[0] ?? '';",
      "const field = args.slice(1).find((a) => !a.startsWith('--') && !/^https?:/u.test(a)) ?? '';",
      "const at = target.lastIndexOf('@');",
      "const versionQuery = at > 0 && target.slice(at + 1).includes('.');",
      "const readTags = () => {",
      "  const file = process.env.MOCK_TAGS_FILE;",
      "  if (file && existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));",
      "  return JSON.parse(process.env.MOCK_VIEW_TAGS ?? '{}');",
      "};",
      "if (versionQuery) {",
      "  const v = process.env.MOCK_VIEW_VERSION;",
      "  if (!v) { console.error('npm error code E404'); process.exit(1); }",
      "  if (field === 'version') { console.log(JSON.stringify(v)); process.exit(0); }",
      "  if (field) { console.error('unsupported mock query: ' + field); process.exit(1); }",
      "  console.log(JSON.stringify({",
      "    name: target.slice(0, at), version: v, 'dist-tags': readTags(),",
      "    dist: {",
      "      integrity: process.env.MOCK_VIEW_INTEGRITY ?? 'sha512-unset',",
      "      tarball: process.env.MOCK_VIEW_TARBALL ?? 'https://registry.npmjs.org/fixture/-/fixture.tgz',",
      "    },",
      "  }));",
      "} else if (field.startsWith('dist-tags')) {",
      "  const tags = readTags();",
      "  const key = field.includes('.') ? field.split('.')[1] : null;",
      "  const value = key ? tags[key] : tags;",
      "  if (value === undefined) { console.error('E404 Not Found'); process.exit(1); }",
      "  console.log(JSON.stringify(value));",
      "} else { console.error('unsupported mock query: ' + field); process.exit(1); }",
    ].join("\n")}\n`,
  );
  return script;
};

/**
 * Serves `bytes` over plain HTTP on 127.0.0.1 from a sibling process (so
 * spawnSync'd scripts can reach it). Resolves to `{ url, close }`.
 */
const serveBytes = async (dir, bytes, name = "served.tgz") => {
  const file = path.join(dir, `serve-${name}`);
  writeFileSync(file, bytes);
  const server = spawn(
    process.execPath,
    [
      "-e",
      [
        "const { createServer } = require('node:http');",
        "const { readFileSync } = require('node:fs');",
        "const body = readFileSync(process.argv[1]);",
        "const server = createServer((req, res) => {",
        "  if (req.url !== '/' + process.argv[2]) { res.writeHead(404); res.end(); return; }",
        "  res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': body.length });",
        "  res.end(body);",
        "});",
        "server.listen(0, '127.0.0.1', () => console.log(server.address().port));",
      ].join("\n"),
      file,
      name,
    ],
    { stdio: ["ignore", "pipe", "inherit"] },
  );
  const port = await new Promise((resolve, reject) => {
    server.stdout.once("data", (chunk) => resolve(Number(String(chunk).trim())));
    server.once("exit", (code) => reject(new Error(`test server exited with ${code}`)));
  });
  return { url: `http://127.0.0.1:${port}/${name}`, close: () => server.kill() };
};

/**
 * Repacks a fixture tarball's contents with different tar header metadata
 * (mtime, ownership) and gzip level: byte-different, content-identical.
 */
const repackWithDifferentMetadata = (tarball, out) => {
  const staging = mkdtempSync(path.join(tmpdir(), "release-repack-"));
  try {
    execFileSync("tar", ["-xzf", tarball, "-C", staging]);
    execFileSync("tar", [
      "--mtime=@1000000000",
      "--owner=4242",
      "--group=4242",
      "--numeric-owner",
      "-cf",
      path.join(staging, "repacked.tar"),
      "-C",
      staging,
      "package",
    ]);
    writeFileSync(out, gzipSync(readFileSync(path.join(staging, "repacked.tar")), { level: 1 }));
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
  return out;
};

// ---------------------------------------------------------------------------
// Version computation
// ---------------------------------------------------------------------------

test("version computation: channel schemes and npm tags", () => {
  assert.deepEqual(
    computeReleaseVersion({ channel: "rc", baseVersion: "0.1.0", rcIndex: 1 }),
    { version: "0.1.0-rc1", npmTag: "rc" },
  );
  assert.deepEqual(
    computeReleaseVersion({ channel: "rc", baseVersion: "0.1.0", rcIndex: 12 }),
    { version: "0.1.0-rc12", npmTag: "rc" },
  );
  assert.deepEqual(
    computeReleaseVersion({
      channel: "snapshot",
      baseVersion: "0.1.0",
      runNumber: "42",
      shortSha: "abcdef0",
    }),
    { version: "0.1.0-snapshot.42.abcdef0", npmTag: "snapshot" },
  );
  assert.deepEqual(computeReleaseVersion({ channel: "release", baseVersion: "0.2.0" }), {
    version: "0.2.0",
    npmTag: "latest",
  });
});

test("version computation: rejects malformed channels and rc indexes", () => {
  assert.throws(() => computeReleaseVersion({ channel: "nightly", baseVersion: "0.1.0" }));
  assert.throws(() => computeReleaseVersion({ channel: "rc", baseVersion: "0.1.0", rcIndex: 0 }));
  assert.throws(() => computeReleaseVersion({ channel: "rc", baseVersion: "0.1.0", rcIndex: "abc" }));
  assert.throws(() => computeReleaseVersion({ channel: "rc", baseVersion: "0.1.0", rcIndex: -1 }));
});

test("version computation: base-version agreement check", () => {
  assert.doesNotThrow(() =>
    assertBaseVersionAgreement("0.1.0", { [FAMILY]: "0.1.0" }),
  );
  assert.throws(() => assertBaseVersionAgreement("0.1.0", { [FAMILY]: "0.2.0" }));
  assert.throws(() => assertBaseVersionAgreement("0.1.0-rc1", { [FAMILY]: "0.1.0-rc1" }));
});

test("prepare-release-version: dry-run reports the rc and leaves manifests untouched", () => {
  const manifestPaths = [
    path.join(REPO_ROOT, "package.json"),
    path.join(REPO_ROOT, FAMILY_PATH, "package.json"),
  ];
  const before = manifestPaths.map((manifestPath) => readFileSync(manifestPath, "utf8"));

  const result = node([
    path.join(SCRIPTS, "prepare-release-version.mjs"),
    "--channel",
    "rc",
    "--rc-index",
    "1",
    "--dry-run",
    "--json",
  ]);
  assert.equal(result.status, 0, result.stderr);
  const payload = jsonStdout(result);
  assert.equal(payload.version, "0.1.0-rc1");
  assert.equal(payload.npmTag, "rc");
  assert.equal(payload.stamped, false);

  const after = manifestPaths.map((manifestPath) => readFileSync(manifestPath, "utf8"));
  assert.deepEqual(after, before, "dry-run must not touch the manifests");
});

test("prepare-release-version: snapshot dry-run carries the run/sha suffix", () => {
  const result = node([
    path.join(SCRIPTS, "prepare-release-version.mjs"),
    "--channel",
    "snapshot",
    "--dry-run",
    "--json",
  ]);
  assert.equal(result.status, 0, result.stderr);
  const payload = jsonStdout(result);
  assert.match(payload.version, /^0\.1\.0-snapshot\.\d+\.[0-9a-f]{7}$/u);
  assert.equal(payload.npmTag, "snapshot");
});

test("prepare-release-version: stamps only a sandboxed checkout", () => {
  const sandbox = mkdtempSync(path.join(tmpdir(), "release-version-sandbox-"));
  try {
    // Minimal repo skeleton: root + both workspace manifests + the tooling.
    mkdirSync(path.join(sandbox, FAMILY_PATH), { recursive: true });
    mkdirSync(path.join(sandbox, "packages", "smoke-consumer"), { recursive: true });
    cpSync(SCRIPTS, path.join(sandbox, "tooling", "scripts"), { recursive: true });
    cpSync(path.join(REPO_ROOT, "package.json"), path.join(sandbox, "package.json"));
    cpSync(
      path.join(REPO_ROOT, FAMILY_PATH, "package.json"),
      path.join(sandbox, FAMILY_PATH, "package.json"),
    );
    writeFileSync(
      path.join(sandbox, "packages", "smoke-consumer", "package.json"),
      `${JSON.stringify({ name: "smoke-consumer", version: "0.0.0", private: true }, null, 2)}\n`,
    );

    const result = node([
      path.join(sandbox, "tooling", "scripts", "prepare-release-version.mjs"),
      "--channel",
      "rc",
      "--rc-index",
      "3",
    ]);
    assert.equal(result.status, 0, result.stderr);

    const stampedRoot = JSON.parse(readFileSync(path.join(sandbox, "package.json"), "utf8"));
    const stampedPackage = JSON.parse(
      readFileSync(path.join(sandbox, FAMILY_PATH, "package.json"), "utf8"),
    );
    assert.equal(stampedRoot.version, "0.1.0-rc3");
    assert.equal(stampedPackage.version, "0.1.0-rc3");
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Workspace catalog
// ---------------------------------------------------------------------------

test("workspace catalog: the family package is the only publishable workspace", () => {
  const family = workspaceCatalog.find((workspace) => workspace.name === FAMILY);
  assert.equal(family?.path, FAMILY_PATH);
  assert.equal(family?.releaseStage, "supported");
  assert.equal(family?.publishable, true);

  const smoke = workspaceCatalog.find((workspace) => workspace.name === "smoke-consumer");
  assert.equal(smoke?.publishable, false, "the smoke consumer is private evidence tooling");

  assert.deepEqual(catalogViolations(), []);
});

test("workspace catalog: --check passes and path flags print exactly the family package", () => {
  const check = node([path.join(SCRIPTS, "workspace-catalog.mjs"), "--check"]);
  assert.equal(check.status, 0, check.stderr);

  const publishable = node([path.join(SCRIPTS, "workspace-catalog.mjs"), "--publishable-paths"]);
  assert.equal(publishable.status, 0, publishable.stderr);
  assert.deepEqual(publishable.stdout.trim().split("\n"), [FAMILY_PATH]);

  const packable = node([path.join(SCRIPTS, "workspace-catalog.mjs"), "--packable-paths"]);
  assert.equal(packable.status, 0, packable.stderr);
  assert.deepEqual(packable.stdout.trim().split("\n"), [FAMILY_PATH]);
});

// ---------------------------------------------------------------------------
// Publication context rules
// ---------------------------------------------------------------------------

const resolveContext = (env, args) =>
  bash(path.join(SCRIPTS, "release-resolve-context.sh"), args, {
    env: { ...process.env, ...env },
  });

test("release-resolve-context: dispatch-only enforcement and channel/branch rules", () => {
  const cases = [
    // [name, event, ref, args, expectedExit]
    ["rc from develop", "workflow_dispatch", "refs/heads/develop", ["--channel", "rc", "--rc-index", "1"], 0],
    ["rc from main", "workflow_dispatch", "refs/heads/main", ["--channel", "rc", "--rc-index", "2"], 0],
    ["release from main", "workflow_dispatch", "refs/heads/main", ["--channel", "release"], 0],
    ["snapshot from develop", "workflow_dispatch", "refs/heads/develop", ["--channel", "snapshot"], 0],
    ["snapshot from main rejected", "workflow_dispatch", "refs/heads/main", ["--channel", "snapshot"], 1],
    ["release from develop rejected", "workflow_dispatch", "refs/heads/develop", ["--channel", "release"], 1],
    ["rc from feature branch rejected", "workflow_dispatch", "refs/heads/feat/x", ["--channel", "rc"], 1],
    ["push event rejected", "push", "refs/heads/main", ["--channel", "release"], 1],
    ["pull_request event rejected", "pull_request", "refs/heads/main", ["--channel", "rc"], 1],
    ["rc index on snapshot rejected", "workflow_dispatch", "refs/heads/develop", ["--channel", "snapshot", "--rc-index", "1"], 1],
    ["rc index on release rejected", "workflow_dispatch", "refs/heads/main", ["--channel", "release", "--rc-index", "1"], 1],
    ["non-integer rc index rejected", "workflow_dispatch", "refs/heads/develop", ["--channel", "rc", "--rc-index", "abc"], 1],
    ["zero rc index rejected", "workflow_dispatch", "refs/heads/develop", ["--channel", "rc", "--rc-index", "0"], 1],
    ["unstable version rejected", "workflow_dispatch", "refs/heads/main", ["--channel", "release", "--version", "1.2.3-rc1"], 1],
    ["two-part version rejected", "workflow_dispatch", "refs/heads/main", ["--channel", "release", "--version", "1.2"], 1],
    ["stable version accepted", "workflow_dispatch", "refs/heads/main", ["--channel", "release", "--version", "0.2.0"], 0],
    ["tag ref rejected", "workflow_dispatch", "refs/tags/v1.0.0", ["--channel", "release"], 1],
  ];
  for (const [name, event, ref, args, expectedExit] of cases) {
    const result = resolveContext({ GITHUB_EVENT_NAME: event, GITHUB_REF: ref }, args);
    assert.equal(result.status, expectedExit, `${name}: ${result.stdout} ${result.stderr}`);
  }
});

test("release-resolve-context: snapshot is available from develop only", () => {
  const develop = resolveContext(
    { GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REF: "refs/heads/develop" },
    ["--channel", "snapshot"],
  );
  assert.equal(develop.status, 0, develop.stderr);
  assert.match(develop.stdout, /npm-tag=snapshot/u);
  assert.doesNotMatch(develop.stdout + develop.stderr, /distribution window/u);

  const main = resolveContext(
    { GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REF: "refs/heads/main" },
    ["--channel", "snapshot"],
  );
  assert.equal(main.status, 1);
  assert.match(main.stderr, /snapshot publications are only allowed from 'develop'/u);
});

test("release-resolve-context: emits the publication context", () => {
  const output = mkdtempSync(path.join(tmpdir(), "release-ctx-"));
  try {
    const outputFile = path.join(output, "ctx");
    const result = resolveContext(
      { GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REF: "refs/heads/develop", GITHUB_OUTPUT: outputFile },
      ["--channel", "rc", "--rc-index", "4", "--version", "0.1.0"],
    );
    assert.equal(result.status, 0, result.stderr);
    const emitted = Object.fromEntries(
      readFileSync(outputFile, "utf8")
        .trim()
        .split("\n")
        .map((line) => line.split("=")),
    );
    assert.equal(emitted.channel, "rc");
    assert.equal(emitted.branch, "develop");
    assert.equal(emitted["npm-tag"], "rc");
    assert.equal(emitted["base-version"], "0.1.0");
    assert.equal(emitted["rc-index"], "4");
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Payload identity (npm-package-identity.mjs)
// ---------------------------------------------------------------------------

test("npm-package-identity: identical integrity matches without a download", async () => {
  const work = mkdtempSync(path.join(tmpdir(), "identity-integrity-"));
  try {
    const tarball = makeFixtureTarball(work);
    const integrity = tarballIntegrity(readFileSync(tarball));
    assert.match(integrity, /^sha512-[A-Za-z0-9+/]+=*$/u);
    let downloads = 0;
    const result = await verifyPayloadIdentity({
      tarball,
      integrity,
      tarballUrl: "https://registry.npmjs.org/fixture/-/fixture.tgz",
      download: async () => {
        downloads += 1;
        return Buffer.alloc(0);
      },
    });
    assert.deepEqual(result, { match: true, method: "integrity", differences: [] });
    assert.equal(downloads, 0);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test("npm-package-identity: a byte-different, content-identical rebuild matches by content", async () => {
  const work = mkdtempSync(path.join(tmpdir(), "identity-content-"));
  try {
    const local = makeFixtureTarball(work);
    const remote = readFileSync(repackWithDifferentMetadata(local, path.join(work, "remote.tgz")));
    assert.notEqual(tarballIntegrity(readFileSync(local)), tarballIntegrity(remote));
    const result = await verifyPayloadIdentity({
      tarball: local,
      integrity: tarballIntegrity(remote),
      tarballUrl: "https://registry.npmjs.org/fixture/-/fixture.tgz",
      download: async () => remote,
    });
    assert.deepEqual(result, { match: true, method: "content", differences: [] });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test("npm-package-identity: changed content, extra, missing, and mode-changed files mismatch", async () => {
  const work = mkdtempSync(path.join(tmpdir(), "identity-mismatch-"));
  try {
    const local = makeFixtureTarball(work);
    const variants = [
      ["content differs", (pkg) => writeFileSync(path.join(pkg, "dist", "index.js"), "export const x = 1;\n")],
      ["only in the registry tarball", (pkg) => writeFileSync(path.join(pkg, "dist", "extra.js"), "export {};\n")],
      ["missing from the registry tarball", (pkg) => rmSync(path.join(pkg, "README.md"))],
      ["executable bit differs", (pkg) => chmodSync(path.join(pkg, "scripts", "helper.mjs"), 0o755)],
    ];
    for (const [expected, mutate] of variants) {
      const variantDir = mkdtempSync(path.join(work, "variant-"));
      const remote = readFileSync(makeFixtureTarball(variantDir, { mutate }));
      const result = await verifyPayloadIdentity({
        tarball: local,
        integrity: tarballIntegrity(remote),
        tarballUrl: "https://registry.npmjs.org/fixture/-/fixture.tgz",
        download: async () => remote,
      });
      assert.equal(result.match, false, expected);
      assert.equal(result.method, "content");
      assert.ok(result.differences.some((difference) => difference.includes(expected)), `${expected}: ${result.differences}`);
    }
    // A downloaded tarball that does not even match the registry's recorded
    // integrity is an error, never a comparison.
    await assert.rejects(
      verifyPayloadIdentity({
        tarball: local,
        integrity: "sha512-AAAA",
        tarballUrl: "https://registry.npmjs.org/fixture/-/fixture.tgz",
        download: async () => readFileSync(local),
      }),
      /does not match the registry's recorded integrity/u,
    );
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test("npm-package-identity: downloads are bounded in size and time, and locked to the registry", async () => {
  const url = "https://registry.npmjs.org/fixture/-/fixture.tgz";
  const streamed = (chunks) =>
    new Response(new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(chunk);
        }
        controller.close();
      },
    }));
  await assert.rejects(
    downloadTarball(url, { maxBytes: 8, fetchImpl: async () => streamed([new Uint8Array(6), new Uint8Array(6)]) }),
    /exceeds the 8-byte download limit/u,
  );
  await assert.rejects(
    downloadTarball(url, {
      maxBytes: 8,
      fetchImpl: async () => new Response("x", { headers: { "content-length": "999" } }),
    }),
    /exceeds the 8-byte download limit/u,
  );
  await assert.rejects(
    downloadTarball(url, {
      timeoutMs: 20,
      fetchImpl: (_url, { signal }) =>
        new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason))),
    }),
    /download failed/u,
  );
  await assert.rejects(
    downloadTarball(url, { fetchImpl: async () => new Response("gone", { status: 404 }) }),
    /HTTP 404/u,
  );
  await assert.rejects(downloadTarball("https://evil.example/fixture.tgz"), /must be served by https:\/\/registry\.npmjs\.org/u);
  await assert.rejects(downloadTarball("http://registry.npmjs.org/fixture.tgz"), /must be served by/u);
  const ok = await downloadTarball(url, { fetchImpl: async () => streamed([new Uint8Array([1, 2]), new Uint8Array([3])]) });
  assert.deepEqual([...ok], [1, 2, 3]);
});

// ---------------------------------------------------------------------------
// Publish-script contract
// ---------------------------------------------------------------------------

test("publish-script contract: registry lockdown, provenance, public access, tag, single publish, payload-checked no-op", () => {
  const script = readFileSync(path.join(SCRIPTS, "publish-npm-packages.sh"), "utf8");

  // Registry lockdown: the script hard-fails on any other registry.
  assert.match(script, /must be locked to https:\/\/registry\.npmjs\.org\//u);

  // Provenance-enabled, public-access, tagged publication with publish-time
  // lifecycle scripts disabled.
  assert.match(script, /--provenance/u);
  assert.match(script, /--access public/u);
  assert.match(script, /--tag "\$\{NPM_TAG\}"/u);
  assert.match(script, /--ignore-scripts/u);

  // Tokenless idempotent no-op, gated on payload identity.
  assert.match(script, /tokenless no-op/u);
  assert.match(script, /npm-package-identity\.mjs/u);
  // Dist-tag drift fails closed (trusted publishing cannot mutate dist-tags);
  // no dist-tag command exists in the script at all.
  assert.match(script, /cannot repair dist-tags/u);
  assert.doesNotMatch(script, /npm dist-tag|DIST_TAG_COMMAND/u);
  // The publisher never polls: the convergence gate is the only wait.
  assert.doesNotMatch(script, /NPM_VIEW_RETRIES|NPM_VIEW_INTERVAL|view_json_until|sleep /u);
  assert.equal(script.match(/^\s*npm publish /gmu)?.length, 1, "exactly one npm publish invocation");
  // Trusted publishing: an ambient npm token must be refused, never required.
  assert.match(script, /NODE_AUTH_TOKEN\/NPM_TOKEN must not be set/u);
  assert.doesNotMatch(script, /NODE_AUTH_TOKEN is not set/u);
});

test("publish-script: refuses non-npmjs registries, bad tags, and ambient npm tokens", () => {
  const work = mkdtempSync(path.join(tmpdir(), "publish-contract-"));
  try {
    makeFixtureTarball(work, { version: "9.9.9" });

    const locked = bash(path.join(SCRIPTS, "publish-npm-packages.sh"), ["--npm-tag", "rc", "--artifacts-dir", work], {
      env: { ...process.env, NPM_REGISTRY: "https://evil.example/" },
    });
    assert.equal(locked.status, 1, "a non-npmjs registry must fail before publishing");
    assert.match(locked.stderr, /locked to https:\/\/registry\.npmjs\.org\//u);

    const badTag = bash(path.join(SCRIPTS, "publish-npm-packages.sh"), ["--npm-tag", "nightly", "--artifacts-dir", work], {
      env: { ...process.env },
    });
    assert.equal(badTag.status, 1);
    assert.match(badTag.stderr, /unknown npm tag/u);

    // Trusted publishing: an ambient token must be refused — the GitHub OIDC
    // exchange is the only acceptable identity, and a stray developer token
    // must never silently override it.
    const withToken = bash(path.join(SCRIPTS, "publish-npm-packages.sh"), ["--npm-tag", "rc", "--artifacts-dir", work], {
      env: { ...process.env, NPM_REGISTRY: NPMJS, NODE_AUTH_TOKEN: "stray-developer-token" },
    });
    assert.equal(withToken.status, 1, "an ambient npm token must fail before publishing");
    assert.match(withToken.stderr, /must not be set/u);
    assert.match(withToken.stderr, /trusted publishing/u);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

/**
 * A publish sandbox: a fixture tarball, the mocked `npm view`, and an `npm`
 * PATH shim that records `publish` calls (failing them when
 * MOCK_PUBLISH_FAIL is set) so the real publish path runs offline.
 */
const makePublishSandbox = (prefix) => {
  const work = mkdtempSync(path.join(tmpdir(), prefix));
  const artifacts = path.join(work, "artifacts");
  mkdirSync(artifacts);
  const tarball = makeFixtureTarball(artifacts, { version: "9.9.9" });
  const mockView = MOCK_VIEW(work);
  const binDir = path.join(work, "bin");
  mkdirSync(binDir);
  const publishLog = path.join(work, "publish.log");
  const viewLog = path.join(work, "view.log");
  const tagsFile = path.join(work, "tags.json");
  writeFileSync(publishLog, "");
  writeFileSync(viewLog, "");
  writeFileSync(tagsFile, "{}");
  const shim = path.join(binDir, "npm");
  writeFileSync(
    shim,
    `${[
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      'if [ "${1:-}" = "publish" ]; then',
      "  printf '%s\\n' \"$*\" >> \"${MOCK_PUBLISH_LOG}\"",
      '  if [ -n "${MOCK_PUBLISH_FAIL:-}" ]; then echo "npm error code E403" >&2; exit 1; fi',
      "  exit 0",
      "fi",
      'echo "unsupported npm subcommand: $*" >&2',
      "exit 1",
    ].join("\n")}\n`,
  );
  chmodSync(shim, 0o755);
  const run = (extra = {}) =>
    bash(path.join(SCRIPTS, "publish-npm-packages.sh"), ["--npm-tag", "rc", "--artifacts-dir", artifacts], {
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH}`,
        NPM_VIEW_COMMAND: `node ${mockView}`,
        MOCK_VIEW_LOG: viewLog,
        MOCK_PUBLISH_LOG: publishLog,
        MOCK_TAGS_FILE: tagsFile,
        ...extra,
      },
    });
  const lines = (file) => readFileSync(file, "utf8").split("\n").filter(Boolean);
  return {
    work,
    tarball,
    tagsFile,
    run,
    publishCalls: () => lines(publishLog),
    viewCalls: () => lines(viewLog),
    cleanup: () => rmSync(work, { recursive: true, force: true }),
  };
};

test("publish-script: an accepted publish exits 0 without polling the registry", () => {
  const sandbox = makePublishSandbox("publish-accepted-");
  try {
    // The version is absent before and (still) after the publish: the
    // publisher must not wait for it — the convergence gate owns that.
    const result = sandbox.run();
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /accepted by the registry/u);
    assert.equal(sandbox.publishCalls().length, 1);
    assert.match(sandbox.publishCalls()[0], /--access public --tag rc --ignore-scripts --provenance/u);
    assert.equal(sandbox.viewCalls().length, 1, "only the preflight read may run");
  } finally {
    sandbox.cleanup();
  }
});

test("publish-script: a rejected publish fails after exactly one attempt", () => {
  const sandbox = makePublishSandbox("publish-rejected-");
  try {
    const result = sandbox.run({ MOCK_PUBLISH_FAIL: "1" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /npm publish was rejected/u);
    assert.match(result.stderr, /not retried/u);
    assert.equal(sandbox.publishCalls().length, 1, "npm publish must never be retried");
  } finally {
    sandbox.cleanup();
  }
});

test("publish-script: preflight of a present version requires payload identity and the dist-tag", async () => {
  const sandbox = makePublishSandbox("publish-preflight-");
  try {
    const packed = readFileSync(sandbox.tarball);
    const present = { MOCK_VIEW_VERSION: "9.9.9", MOCK_VIEW_INTEGRITY: tarballIntegrity(packed) };

    // Present + matching payload + matching tag → tokenless no-op.
    writeFileSync(sandbox.tagsFile, JSON.stringify({ latest: "9.8.0", rc: "9.9.9" }));
    const noop = sandbox.run(present);
    assert.equal(noop.status, 0, noop.stdout + noop.stderr);
    assert.match(noop.stdout, /tokenless no-op/u);
    assert.match(noop.stdout, /identical integrity/u);
    assert.equal(sandbox.publishCalls().length, 0);

    // Present + drifted tag → fails closed, no publish, no repair.
    writeFileSync(sandbox.tagsFile, JSON.stringify({ latest: "9.8.0", rc: "9.9.0" }));
    const drifted = sandbox.run(present);
    assert.equal(drifted.status, 1, drifted.stdout + drifted.stderr);
    assert.match(drifted.stderr, /already published but dist-tag 'rc' resolves to '9\.9\.0'/u);
    assert.match(drifted.stderr, /cannot repair dist-tags/u);
    assert.equal(sandbox.publishCalls().length, 0);

    // Present + different payload → fails closed before any publish (the
    // registry tarball is downloaded and compared by content).
    writeFileSync(sandbox.tagsFile, JSON.stringify({ latest: "9.8.0", rc: "9.9.9" }));
    const otherDir = mkdtempSync(path.join(sandbox.work, "other-"));
    const other = readFileSync(
      makeFixtureTarball(otherDir, {
        version: "9.9.9",
        mutate: (pkg) => writeFileSync(path.join(pkg, "dist", "index.js"), "export const tampered = true;\n"),
      }),
    );
    const server = await serveBytes(sandbox.work, other);
    try {
      const different = sandbox.run({
        MOCK_VIEW_VERSION: "9.9.9",
        MOCK_VIEW_INTEGRITY: tarballIntegrity(other),
        MOCK_VIEW_TARBALL: server.url,
      });
      assert.equal(different.status, 1, different.stdout + different.stderr);
      assert.match(different.stderr, /content differs/u);
      assert.match(different.stderr, /already published with a different payload/u);
      assert.equal(sandbox.publishCalls().length, 0);

      // … while a byte-different but content-identical rebuild is a no-op.
      const rebuilt = readFileSync(repackWithDifferentMetadata(sandbox.tarball, path.join(sandbox.work, "rebuilt.tgz")));
      const rebuiltServer = await serveBytes(sandbox.work, rebuilt, "rebuilt.tgz");
      try {
        const identical = sandbox.run({
          MOCK_VIEW_VERSION: "9.9.9",
          MOCK_VIEW_INTEGRITY: tarballIntegrity(rebuilt),
          MOCK_VIEW_TARBALL: rebuiltServer.url,
        });
        assert.equal(identical.status, 0, identical.stdout + identical.stderr);
        assert.match(identical.stdout, /content-identical rebuild/u);
        assert.equal(sandbox.publishCalls().length, 0);
      } finally {
        rebuiltServer.close();
      }
    } finally {
      server.close();
    }

    // A registry read failure other than E404 fails closed without publishing.
    const broken = sandbox.run({ MOCK_VIEW_BROKEN: "1" });
    assert.equal(broken.status, 1, broken.stdout + broken.stderr);
    assert.match(broken.stderr, /not a recognised E404/u);
    assert.equal(sandbox.publishCalls().length, 0);
  } finally {
    sandbox.cleanup();
  }
});
// ---------------------------------------------------------------------------
// Release package contract (sandboxed tarball fixtures)
// ---------------------------------------------------------------------------

test("release package contract: a complete fixture satisfies the contract", () => {
  const work = mkdtempSync(path.join(tmpdir(), "contract-ok-"));
  try {
    const tarball = makeFixtureTarball(work);
    const result = node([path.join(SCRIPTS, "check-release-package-contract.mjs"), "--tarball", tarball]);
    assert.equal(result.status, 0, result.stderr);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test("release package contract: a stripped tarball fails", () => {
  const work = mkdtempSync(path.join(tmpdir(), "contract-stripped-"));
  try {
    const tarball = makeFixtureTarball(work, {
      mutate: (pkg) => {
        rmSync(path.join(pkg, "CHANGELOG.md"));
      },
    });
    const result = node([path.join(SCRIPTS, "check-release-package-contract.mjs"), "--tarball", tarball]);
    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stderr, /CHANGELOG\.md is missing/u);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test("release package contract: emits a deterministic machine-readable report on pass and failure", () => {
  const work = mkdtempSync(path.join(tmpdir(), "contract-report-"));
  try {
    const tarball = makeFixtureTarball(work);
    const reportFile = path.join(work, "contract-report.json");
    const pass = node([
      path.join(SCRIPTS, "check-release-package-contract.mjs"),
      "--tarball",
      tarball,
      "--report",
      reportFile,
    ]);
    assert.equal(pass.status, 0, pass.stderr);
    const firstBytes = readFileSync(reportFile, "utf8");
    const report = JSON.parse(firstBytes);
    assert.equal(report.result, "pass");
    assert.equal(report.version, "0.1.0");
    assert.deepEqual(report.tarballs, [
      {
        tarball: "midnight-ntwrk-midnight-vc-passport-0.1.0.tgz",
        passed: true,
        violations: [],
      },
    ]);
    assert.match(pass.stdout, /report written to .*contract-report\.json/u);

    // Deterministic content: a rerun over the same inputs produces identical
    // bytes (no timestamps, stable ordering, stable key order).
    node([
      path.join(SCRIPTS, "check-release-package-contract.mjs"),
      "--tarball",
      tarball,
      "--report",
      reportFile,
    ]);
    assert.equal(readFileSync(reportFile, "utf8"), firstBytes);

    // The failure path emits the report too (before exiting 1) — the release
    // evidence carries which check failed, per tarball.
    const stripped = makeFixtureTarball(work, {
      version: "0.2.0",
      mutate: (pkg) => {
        rmSync(path.join(pkg, "CHANGELOG.md"));
      },
    });
    const failure = node([
      path.join(SCRIPTS, "check-release-package-contract.mjs"),
      "--tarball",
      stripped,
      "--report",
      reportFile,
    ]);
    assert.equal(failure.status, 1, failure.stdout);
    const failureReport = JSON.parse(readFileSync(reportFile, "utf8"));
    assert.equal(failureReport.result, "fail");
    assert.equal(failureReport.version, "0.2.0");
    assert.equal(failureReport.tarballs[0].passed, false);
    assert.ok(
      failureReport.tarballs[0].violations.some((violation) =>
        violation.includes("CHANGELOG.md is missing"),
      ),
    );
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test("release package contract: the default report path lands inside tooling/artifacts/", () => {
  // The workflow's evidence-artifact upload globs tooling/artifacts/ and the
  // GitHub-Release window attaches the report as a release asset: the
  // artifacts-dir (release) path must write it there — while an ad-hoc
  // --tarball check stays side-effect-free.
  const source = readFileSync(path.join(SCRIPTS, "check-release-package-contract.mjs"), "utf8");
  assert.match(source, /join\(repoRoot, "tooling", "artifacts", "contract-report\.json"\)/u);
  assert.match(source, /reportPathArg \?\? \(tarballMode \? null : DEFAULT_REPORT_PATH\)/u);
});

test("release package contract: managed source maps and dist gaps fail", () => {
  const work = mkdtempSync(path.join(tmpdir(), "contract-maps-"));
  try {
    const tarball = makeFixtureTarball(work, {
      mutate: (pkg) => {
        writeFileSync(
          path.join(pkg, "dist", "managed", "digital-passport-credential", "contract", "index.js.map"),
          "{}",
        );
      },
    });
    const result = node([path.join(SCRIPTS, "check-release-package-contract.mjs"), "--tarball", tarball]);
    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stderr, /managed-code source map is shipped/u);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test("release package contract: publication-metadata violations are named", () => {
  const work = mkdtempSync(path.join(tmpdir(), "contract-meta-"));
  try {
    const pkg = path.join(work, "package");
    mkdirSync(path.join(pkg, "dist", "managed", "c", "contract"), { recursive: true });
    mkdirSync(path.join(pkg, "src"), { recursive: true });
    mkdirSync(path.join(pkg, "scripts"), { recursive: true });
    writeFileSync(
      path.join(pkg, "package.json"),
      JSON.stringify({
        name: FAMILY,
        version: "0.1.0",
        repository: { url: "git+https://github.com/midnightntwrk/midnight-vc-passport.git", directory: "packages/wrong" },
        publishConfig: { access: "restricted", registry: "https://registry.evil.example/" },
      }),
    );
    writeFileSync(path.join(pkg, "README.md"), "# x");
    writeFileSync(path.join(pkg, "CHANGELOG.md"), "# x");
    writeFileSync(path.join(pkg, "dist", "index.js"), "");
    writeFileSync(path.join(pkg, "dist", "managed", "c", "contract", "index.js"), "");
    writeFileSync(path.join(pkg, "src", "x.compact"), "");
    writeFileSync(path.join(pkg, "scripts", "x.mjs"), "");

    const violations = contractViolations(pkg, { expectedRepositoryDirectory: FAMILY_PATH });
    assert.ok(violations.some((violation) => violation.includes("publishConfig.access")));
    assert.ok(violations.some((violation) => violation.includes("publishConfig.registry")));
    assert.ok(violations.some((violation) => violation.includes("repository.directory")));
    assert.ok(violations.some((violation) => violation.includes("description")));
    assert.ok(violations.some((violation) => violation.includes("keywords")));
    assert.ok(violations.some((violation) => violation.includes("homepage")));
    assert.ok(violations.some((violation) => violation.includes("bugs.url")));
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// npm release state (dist-tag snapshot / verify; fail-closed on drift)
// ---------------------------------------------------------------------------

test("npm-release-state: snapshot and verify under a mocked registry view, drift fails closed", () => {
  const work = mkdtempSync(path.join(tmpdir(), "release-state-"));
  try {
    const mockView = MOCK_VIEW(work);
    const stateFile = path.join(work, "state.json");
    const tagsFile = path.join(work, "tags.json");
    writeFileSync(tagsFile, JSON.stringify({ latest: "0.1.0", rc: "0.1.0-rc1" }));
    const baseEnv = {
      ...process.env,
      MOCK_TAGS_FILE: tagsFile,
    };

    const snapshot = node([path.join(SCRIPTS, "npm-release-state.mjs"), "--snapshot", "--out", stateFile, "--view-cmd", `node ${mockView}`], {
      env: baseEnv,
    });
    assert.equal(snapshot.status, 0, snapshot.stderr);
    const state = JSON.parse(readFileSync(stateFile, "utf8"));
    assert.deepEqual(state.packages[FAMILY].distTags, { latest: "0.1.0", rc: "0.1.0-rc1" });

    // Verifying the expected tag passes.
    const ok = node(
      [path.join(SCRIPTS, "npm-release-state.mjs"), "--verify", "--snapshot-file", stateFile, "--npm-tag", "rc", "--version", "0.1.0-rc1", "--protect-latest", "--view-cmd", `node ${mockView}`],
      { env: baseEnv },
    );
    assert.equal(ok.status, 0, ok.stderr);

    // Drifted tag: fails closed, and there is no repair mode to reach for —
    // trusted publishing cannot mutate dist-tags.
    const drifted = node(
      [path.join(SCRIPTS, "npm-release-state.mjs"), "--verify", "--snapshot-file", stateFile, "--npm-tag", "rc", "--version", "0.1.0-rc2", "--view-cmd", `node ${mockView}`],
      { env: baseEnv },
    );
    assert.equal(drifted.status, 1);
    assert.match(drifted.stderr, /dist-tag 'rc' resolves to 0\.1\.0-rc1/u);
    assert.match(drifted.stderr, /cannot repair dist-tags/u);
    const script = readFileSync(path.join(SCRIPTS, "npm-release-state.mjs"), "utf8");
    assert.doesNotMatch(script, /--repair/u);
    assert.doesNotMatch(script, /dist-tag-cmd/u);

    // latest protection: a moved latest during a non-release publication fails.
    writeFileSync(tagsFile, JSON.stringify({ latest: "0.2.0", rc: "0.1.0-rc1" }));
    const latestDrift = node(
      [path.join(SCRIPTS, "npm-release-state.mjs"), "--verify", "--snapshot-file", stateFile, "--npm-tag", "rc", "--version", "0.1.0-rc1", "--protect-latest", "--view-cmd", `node ${mockView}`],
      { env: baseEnv },
    );
    assert.equal(latestDrift.status, 1);
    assert.match(latestDrift.stderr, /'latest' moved/u);

    // Registry lockdown mirrors the publish script.
    const unlocked = node([path.join(SCRIPTS, "npm-release-state.mjs"), "--snapshot", "--out", stateFile, "--view-cmd", `node ${mockView}`, "--registry", "https://evil.example/"], {
      env: baseEnv,
    });
    assert.equal(unlocked.status, 1);
    assert.match(unlocked.stderr, /locked/u);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// First-publication registry state
// ---------------------------------------------------------------------------

test("npm-release-state: a not-yet-published package snapshots as empty dist-tags (E404)", () => {
  const work = mkdtempSync(path.join(tmpdir(), "release-state-first-"));
  try {
    const mockView = MOCK_VIEW(work);
    const stateFile = path.join(work, "state.json");
    const snapshot = node(
      [path.join(SCRIPTS, "npm-release-state.mjs"), "--snapshot", "--out", stateFile, "--view-cmd", `node ${mockView}`],
      { env: { ...process.env, MOCK_VIEW_MISSING: "1" } },
    );
    assert.equal(snapshot.status, 0, snapshot.stderr);
    const state = JSON.parse(readFileSync(stateFile, "utf8"));
    assert.deepEqual(state.packages[FAMILY].distTags, {});
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test("npm-release-state: first publication tolerates the registry auto-setting 'latest'", () => {
  const work = mkdtempSync(path.join(tmpdir(), "release-state-first-publish-"));
  try {
    const mockView = MOCK_VIEW(work);
    const stateFile = path.join(work, "state.json");
    const tagsFile = path.join(work, "tags.json");

    // Snapshot the never-published package (E404 → empty dist-tag state) …
    const snapshot = node(
      [path.join(SCRIPTS, "npm-release-state.mjs"), "--snapshot", "--out", stateFile, "--view-cmd", `node ${mockView}`],
      { env: { ...process.env, MOCK_VIEW_MISSING: "1" } },
    );
    assert.equal(snapshot.status, 0, snapshot.stderr);

    // … then the registry shows the post-first-publish state: npmjs sets both
    // the channel tag and `latest` to the just-published version. The
    // `--protect-latest` check must tolerate this — there was no `latest` to
    // protect before the first publication.
    writeFileSync(tagsFile, JSON.stringify({ latest: "0.1.0-rc1", rc: "0.1.0-rc1" }));
    const ok = node(
      [path.join(SCRIPTS, "npm-release-state.mjs"), "--verify", "--snapshot-file", stateFile, "--npm-tag", "rc", "--version", "0.1.0-rc1", "--protect-latest", "--view-cmd", `node ${mockView}`],
      { env: { ...process.env, MOCK_TAGS_FILE: tagsFile } },
    );
    assert.equal(ok.status, 0, ok.stderr);

    // But only when `latest` points at the version this run published.
    writeFileSync(tagsFile, JSON.stringify({ latest: "9.9.9", rc: "0.1.0-rc1" }));
    const foreign = node(
      [path.join(SCRIPTS, "npm-release-state.mjs"), "--verify", "--snapshot-file", stateFile, "--npm-tag", "rc", "--version", "0.1.0-rc1", "--protect-latest", "--view-cmd", `node ${mockView}`],
      { env: { ...process.env, MOCK_TAGS_FILE: tagsFile } },
    );
    assert.equal(foreign.status, 1);
    assert.match(foreign.stderr, /first publication set 'latest' to 9\.9\.9/u);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test("npm-release-state: --protect-latest without --version fails closed", () => {
  // The first-publication tolerance compares against the published version;
  // without --version the check would silently no-op, so the CLI contract
  // must reject the pairing instead (parseArgs runs before any file access).
  const result = node([
    path.join(SCRIPTS, "npm-release-state.mjs"),
    "--verify",
    "--snapshot-file",
    path.join(tmpdir(), "nonexistent-state.json"),
    "--protect-latest",
  ]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /--protect-latest requires --version/u);
});

test("npm-release-state: non-E404 registry errors still fail closed", () => {
  const work = mkdtempSync(path.join(tmpdir(), "release-state-broken-"));
  try {
    const mockView = MOCK_VIEW(work);
    const stateFile = path.join(work, "state.json");
    const snapshot = node(
      [path.join(SCRIPTS, "npm-release-state.mjs"), "--snapshot", "--out", stateFile, "--view-cmd", `node ${mockView}`],
      { env: { ...process.env, MOCK_VIEW_BROKEN: "1" } },
    );
    assert.equal(snapshot.status, 1);
    assert.match(snapshot.stderr, /registry view failed/u);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test("npm-release-state: an rc keeps 'latest' at the pre-existing prerelease (latest=0.1.0-rc3)", () => {
  // The real registry state since the first publication: npmjs assigned
  // 'latest' to the first-ever version (0.1.0-rc3), and it stays there until
  // the first `release` publication. An rc run must pass while 'latest' is
  // unchanged and fail the moment it moves.
  const work = mkdtempSync(path.join(tmpdir(), "release-state-rc3-"));
  try {
    const mockView = MOCK_VIEW(work);
    const stateFile = path.join(work, "state.json");
    const tagsFile = path.join(work, "tags.json");
    const env = { ...process.env, MOCK_TAGS_FILE: tagsFile };
    writeFileSync(tagsFile, JSON.stringify({ latest: "0.1.0-rc3", rc: "0.1.0-rc4" }));
    const snapshot = node(
      [path.join(SCRIPTS, "npm-release-state.mjs"), "--snapshot", "--out", stateFile, "--view-cmd", `node ${mockView}`],
      { env },
    );
    assert.equal(snapshot.status, 0, snapshot.stderr);

    const verify = () =>
      node(
        [path.join(SCRIPTS, "npm-release-state.mjs"), "--verify", "--snapshot-file", stateFile, "--npm-tag", "rc", "--version", "0.1.0-rc5", "--protect-latest", "--view-cmd", `node ${mockView}`],
        { env },
      );
    writeFileSync(tagsFile, JSON.stringify({ latest: "0.1.0-rc3", rc: "0.1.0-rc5" }));
    const unchanged = verify();
    assert.equal(unchanged.status, 0, unchanged.stderr);

    writeFileSync(tagsFile, JSON.stringify({ latest: "0.1.0-rc5", rc: "0.1.0-rc5" }));
    const moved = verify();
    assert.equal(moved.status, 1);
    assert.match(moved.stderr, /'latest' moved from 0\.1\.0-rc3 to 0\.1\.0-rc5/u);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Convergence gate (fake clock)
// ---------------------------------------------------------------------------

const GATE_VERSION = "0.1.0-rc5";
const E404_READ = { status: 1, stdout: "", stderr: "npm error code E404\nnpm error 404 No match found for version" };
const presentRead = (tags, overrides = {}) => ({
  status: 0,
  stderr: "",
  stdout: JSON.stringify({
    name: FAMILY,
    version: GATE_VERSION,
    "dist-tags": tags,
    dist: { integrity: "sha512-packed", tarball: "https://registry.npmjs.org/fixture/-/fixture.tgz" },
    ...overrides,
  }),
});

/**
 * Runs waitForVisible against a fake clock: `read(t)` answers the registry
 * read issued at fake time `t` seconds; `latency(t)` (seconds) advances the
 * clock during that read. Returns the outcome plus the observed sleeps.
 */
const runGate = async ({ read, latency = () => 0, npmTag = "rc", payloadMatch = true }) => {
  let clock = 0;
  const sleeps = [];
  const reads = [];
  const outcome = await waitForVisible({
    name: FAMILY,
    version: GATE_VERSION,
    npmTag,
    timeoutMs: 300_000,
    intervalMs: 30_000,
    now: () => clock,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
    view: () => {
      const t = clock / 1000;
      reads.push(t);
      clock += latency(t) * 1000;
      return read(t);
    },
    payload: async () =>
      payloadMatch
        ? { match: true, method: "integrity", differences: [] }
        : { match: false, method: "content", differences: ["package/dist/index.js: content differs"] },
    log: () => {},
  }).then(
    () => ({ ok: true }),
    (error) => ({ ok: false, error }),
  );
  return { ...outcome, sleeps, reads, elapsed: clock / 1000 };
};

test("wait-for-npm-packages: defaults are the 300s / 30s budget with a bounded request timeout", () => {
  const options = parseWaitArgs(["--version", GATE_VERSION, "--npm-tag", "rc"]);
  assert.equal(options.timeout, 300);
  assert.equal(options.interval, 30);
  assert.ok(options.requestTimeout > 0 && options.requestTimeout <= 30);
  assert.throws(() => parseWaitArgs(["--version", GATE_VERSION]), /--npm-tag is required/u);
  assert.throws(() => parseWaitArgs(["--version", GATE_VERSION, "--npm-tag", "rc", "--registry", "https://evil.example/"]), /locked/u);
  assert.throws(() => parseWaitArgs(["--version", GATE_VERSION, "--npm-tag", "rc", "--interval", "0"]), /--interval/u);
});

test("wait-for-npm-packages: visible at 240s succeeds", async () => {
  const run = await runGate({ read: (t) => (t >= 240 ? presentRead({ rc: GATE_VERSION, latest: "0.1.0-rc3" }) : E404_READ) });
  assert.equal(run.ok, true, run.error?.message);
  assert.equal(run.elapsed, 240);
  assert.equal(run.sleeps.length, 8);
  assert.ok(run.sleeps.every((ms) => ms === 30_000));
});

test("wait-for-npm-packages: a lagging dist-tag that converges succeeds", async () => {
  const run = await runGate({
    read: (t) => {
      if (t < 60) return E404_READ;
      return presentRead({ rc: t < 150 ? "0.1.0-rc4" : GATE_VERSION, latest: "0.1.0-rc3" });
    },
  });
  assert.equal(run.ok, true, run.error?.message);
  assert.equal(run.elapsed, 150);
});

test("wait-for-npm-packages: still absent at 300s times out", async () => {
  const run = await runGate({ read: () => E404_READ });
  assert.equal(run.ok, false);
  assert.match(run.error.message, /timed out after 300s/u);
  assert.match(run.error.message, /Accepted, propagation timed out/u);
  assert.equal(run.reads.at(-1), 300, "the last read happens at the deadline");
  assert.equal(run.sleeps.reduce((sum, ms) => sum + ms, 0), 300_000, "no sleeping past the deadline");
});

test("wait-for-npm-packages: evidence observed at 301s fails as late", async () => {
  // The read issued at the deadline takes one second and only then sees the
  // version: evidence after the deadline fails rather than passing.
  const run = await runGate({
    read: (t) => (t >= 300 ? presentRead({ rc: GATE_VERSION, latest: "0.1.0-rc3" }) : E404_READ),
    latency: (t) => (t >= 300 ? 1 : 0),
  });
  assert.equal(run.ok, false);
  assert.equal(run.elapsed, 301);
  assert.match(run.error.message, /301s after acceptance — after the 300s deadline/u);
});

test("wait-for-npm-packages: unexpected registry answers fail immediately without sleeping", async () => {
  const cases = [
    ["non-E404 error", { status: 1, stdout: "", stderr: "npm error code E500 Internal Server Error" }, /not a recognised E404/u],
    ["request timeout", { error: new Error("spawnSync npm ETIMEDOUT"), status: null }, /ETIMEDOUT/u],
    ["malformed JSON", { status: 0, stdout: "<html>not json</html>", stderr: "" }, /not valid JSON/u],
    ["missing integrity", presentRead({ rc: GATE_VERSION }, { dist: { tarball: "https://registry.npmjs.org/x.tgz" } }), /dist\.integrity/u],
    ["missing tarball", presentRead({ rc: GATE_VERSION }, { dist: { integrity: "sha512-packed" } }), /dist\.tarball/u],
    ["wrong version", presentRead({ rc: GATE_VERSION }, { version: "0.1.0-rc4" }), /malformed: version/u],
    ["missing dist-tags", presentRead(undefined), /missing dist-tags/u],
  ];
  for (const [label, answer, expected] of cases) {
    const run = await runGate({ read: () => answer });
    assert.equal(run.ok, false, label);
    assert.match(run.error.message, expected, label);
    assert.equal(run.sleeps.length, 0, `${label}: no sleeps`);
  }
});

test("wait-for-npm-packages: an rc owning 'latest' or a payload mismatch fails immediately", async () => {
  const latest = await runGate({ read: () => presentRead({ rc: GATE_VERSION, latest: GATE_VERSION }) });
  assert.equal(latest.ok, false);
  assert.match(latest.error.message, /must never own 'latest'/u);
  assert.equal(latest.sleeps.length, 0);

  // A release publication legitimately owns 'latest'.
  const release = await runGate({ npmTag: "latest", read: () => presentRead({ latest: GATE_VERSION }) });
  assert.equal(release.ok, true, release.error?.message);

  const mismatch = await runGate({ payloadMatch: false, read: () => presentRead({ rc: GATE_VERSION, latest: "0.1.0-rc3" }) });
  assert.equal(mismatch.ok, false);
  assert.match(mismatch.error.message, /not the packed payload/u);
  assert.equal(mismatch.sleeps.length, 0);
});

test("wait-for-npm-packages: the CLI checks the packed payload through a mocked view", () => {
  const work = mkdtempSync(path.join(tmpdir(), "wait-cli-"));
  try {
    const artifacts = path.join(work, "artifacts");
    mkdirSync(artifacts);
    const tarball = makeFixtureTarball(artifacts, { version: GATE_VERSION });
    const mockView = MOCK_VIEW(work);
    const args = ["--version", GATE_VERSION, "--npm-tag", "rc", "--artifacts-dir", artifacts, "--timeout", "1", "--interval", "1", "--view-cmd", `node ${mockView}`];
    const env = {
      ...process.env,
      MOCK_VIEW_VERSION: GATE_VERSION,
      MOCK_VIEW_TAGS: JSON.stringify({ rc: GATE_VERSION, latest: "0.1.0-rc3" }),
      MOCK_VIEW_INTEGRITY: tarballIntegrity(readFileSync(tarball)),
    };
    const visible = node([path.join(SCRIPTS, "wait-for-npm-packages.mjs"), ...args], { env });
    assert.equal(visible.status, 0, visible.stderr);
    assert.match(visible.stdout, /is Visible after/u);

    const absent = node([path.join(SCRIPTS, "wait-for-npm-packages.mjs"), ...args], { env: { ...env, MOCK_VIEW_VERSION: "" } });
    assert.equal(absent.status, 1);
    assert.match(absent.stderr, /timed out/u);

    const broken = node([path.join(SCRIPTS, "wait-for-npm-packages.mjs"), ...args], { env: { ...env, MOCK_VIEW_BROKEN: "1" } });
    assert.equal(broken.status, 1);
    assert.match(broken.stderr, /not a recognised E404/u);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
// ---------------------------------------------------------------------------
// Consumer test argument validation
// ---------------------------------------------------------------------------

test("test-release-package-consumers: registry-mode argument validation", () => {
  assert.throws(() => parseConsumerArgs(["--registry", NPMJS]), /together/u);
  assert.throws(() => parseConsumerArgs(["--version", "1.2.3"]), /together/u);
  assert.throws(() => parseConsumerArgs(["--registry", "http://insecure.example", "--version", "1.2.3"]), /https/u);
  assert.throws(() => parseConsumerArgs(["--registry", NPMJS, "--version", "not-a-version"]), /semantic version/u);
  assert.deepEqual(parseConsumerArgs(["--registry", NPMJS, "--version", "0.1.0-rc1"]).mode, "registry");
  assert.deepEqual(parseConsumerArgs([]).mode, "tarball");
});

test("test-release-package-consumers: the release-url mode is gone", () => {
  assert.throws(() => parseConsumerArgs(["--release-url", "https://example.com/x.tgz"]), /unknown argument --release-url/u);
  const result = node([path.join(SCRIPTS, "test-release-package-consumers.mjs"), "--release-url", "x"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /unknown argument --release-url/u);
});

test("test-release-package-consumers: registry mode installs the exact tarball URL with a run-private store and cache", async () => {
  const TARBALL_URL = "https://registry.npmjs.org/@midnight-ntwrk/midnight-vc-passport/-/midnight-vc-passport-0.1.0-rc5.tgz";
  // A stale, pre-seeded package-manager cache in the ambient locations must
  // never be the one the install reads.
  const ambient = mkdtempSync(path.join(tmpdir(), "consumer-stale-cache-"));
  writeFileSync(path.join(ambient, "stale-metadata.json"), JSON.stringify({ versions: ["0.1.0-rc4"] }));
  const seen = [];
  try {
    await testRegistry(NPMJS, "0.1.0-rc5", {
      resolveUrl: (registry, version) => {
        assert.equal(registry, NPMJS);
        assert.equal(version, "0.1.0-rc5");
        return TARBALL_URL;
      },
      install: async ({ cwd, env, specs }) => {
        const npmrc = readFileSync(path.join(cwd, ".npmrc"), "utf8");
        seen.push({ cwd, env, specs, npmrc });
        for (const dir of [env.npm_config_store_dir, env.npm_config_cache_dir]) {
          assert.ok(dir && existsSync(dir), "the run-private directory exists during the install");
          assert.deepEqual(readdirSync(dir), [], "the run-private store/cache starts empty");
          assert.ok(!dir.startsWith(ambient), "the ambient cache is never used");
          assert.ok(!dir.startsWith(cwd), "the store/cache lives outside the consumer project");
        }
      },
      roundTrip: () => {},
      sleep: async () => assert.fail("no retry expected"),
    });
    assert.equal(seen.length, 1);
    const [{ cwd, env, specs, npmrc }] = seen;
    assert.deepEqual(specs, [TARBALL_URL, "@midnight-ntwrk/midnight-js-network-id"]);
    assert.equal(env.npm_config_prefer_offline, "false");
    assert.ok(npmrc.split("\n").includes(`store-dir=${env.npm_config_store_dir}`), npmrc);
    assert.ok(npmrc.split("\n").includes(`cache-dir=${env.npm_config_cache_dir}`), npmrc);
    assert.match(npmrc, /prefer-offline=false/u);
    // Removed in finally.
    for (const dir of [cwd, env.npm_config_store_dir, env.npm_config_cache_dir]) {
      assert.equal(existsSync(dir), false, `${dir} must be removed after the run`);
    }
    // The real URL resolution asks the registry for fresh metadata.
    const source = readFileSync(path.join(SCRIPTS, "test-release-package-consumers.mjs"), "utf8");
    assert.match(source, /"dist\.tarball",\s*"--json",\s*"--prefer-online"/u);
  } finally {
    rmSync(ambient, { recursive: true, force: true });
  }
});

test("test-release-package-consumers: registry installs retry up to 3 attempts, 10s apart", async () => {
  const deps = (failures) => {
    const state = { installs: 0, sleeps: [], roundTrips: 0 };
    return {
      state,
      options: {
        resolveUrl: () => "https://registry.npmjs.org/fixture/-/fixture.tgz",
        install: async () => {
          state.installs += 1;
          if (state.installs <= failures) {
            throw new Error(`ERR_PNPM_FETCH_404 (attempt ${state.installs})`);
          }
        },
        roundTrip: () => {
          state.roundTrips += 1;
        },
        sleep: async (ms) => {
          state.sleeps.push(ms);
        },
      },
    };
  };

  const recovered = deps(1);
  await testRegistry(NPMJS, "0.1.0-rc5", recovered.options);
  assert.equal(recovered.state.installs, 2);
  assert.deepEqual(recovered.state.sleeps, [10_000]);
  assert.equal(recovered.state.roundTrips, 1);

  const exhausted = deps(3);
  await assert.rejects(testRegistry(NPMJS, "0.1.0-rc5", exhausted.options), /failed after 3 attempt\(s\)/u);
  assert.equal(exhausted.state.installs, 3);
  assert.deepEqual(exhausted.state.sleeps, [10_000, 10_000]);
  assert.equal(exhausted.state.roundTrips, 0);
});
test("test-release-package-consumers: clean projects mirror the workspace release-age policy", () => {
  // The real workspace: floor and first-party exclusion mirrored, plus the
  // package under test (registry mode installs it moments after publishing).
  const policy = releaseAgePolicy();
  assert.ok(Number.isInteger(policy.minimumReleaseAge) && policy.minimumReleaseAge > 0);
  assert.ok(policy.minimumReleaseAgeExclude.includes("@midnight-ntwrk/credential-compact"));
  assert.ok(policy.minimumReleaseAgeExclude.includes(FAMILY));

  // Fail closed without a floor.
  const work = mkdtempSync(path.join(tmpdir(), "consumer-policy-"));
  try {
    const noFloor = path.join(work, "pnpm-workspace.yaml");
    writeFileSync(noFloor, "packages:\n  - packages/*\n");
    assert.throws(() => releaseAgePolicy(noFloor), /no minimumReleaseAge floor/u);
    writeFileSync(noFloor, "minimumReleaseAge: 10080\n");
    assert.deepEqual(releaseAgePolicy(noFloor).minimumReleaseAgeExclude, [FAMILY]);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test("test-release-package-consumers: tarball installs use a short relative path (ENAMETOOLONG guard)", () => {
  const source = readFileSync(
    path.join(SCRIPTS, "test-release-package-consumers.mjs"),
    "utf8",
  );
  // The tarball must be copied into the isolated project and installed by
  // relative path: pnpm derives store filenames from the full tarball path,
  // and CI's long artifacts directory overflows the filename limit.
  assert.match(source, /cpSync\(tarball, path\.join\(isolated, tarballName\)\)/u);
  assert.match(source, /"add", `\.\/\$\{tarballName\}`/u);
  assert.doesNotMatch(source, /"add", tarball,/u);
});

test("test-release-package-consumers: unreadable tarball manifests fail closed", () => {
  const work = mkdtempSync(path.join(tmpdir(), "consumer-manifest-"));
  try {
    // Not a tarball at all.
    const garbage = path.join(work, "garbage.tgz");
    writeFileSync(garbage, "this is not a tarball\n");
    assert.throws(() => readTarballManifest(garbage), /cannot read package\/package\.json/u);

    // A structurally valid tarball that does not carry package/package.json.
    const stripped = makeFixtureTarball(work, {
      mutate: (pkg) => {
        rmSync(path.join(pkg, "package.json"));
      },
    });
    assert.throws(() => readTarballManifest(stripped), /cannot read package\/package\.json/u);

    // A manifest that is present but not valid JSON.
    const malformed = makeFixtureTarball(work, {
      mutate: (pkg) => {
        writeFileSync(path.join(pkg, "package.json"), "{not json");
      },
    });
    assert.throws(() => readTarballManifest(malformed), /is not valid JSON/u);

    // The happy path still round-trips through the family manifest.
    assert.equal(readTarballManifest(makeFixtureTarball(work)).name, FAMILY);

    // The tarball mode routes every tarball through the publishable catalog
    // before it may print PASS — an unknown manifest name must fail closed
    // instead of silently downgrading to an install-only check.
    const source = readFileSync(
      path.join(SCRIPTS, "test-release-package-consumers.mjs"),
      "utf8",
    );
    assert.match(source, /publishableNames\.has\(manifest\.name\)/u);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// SBOM generation
// ---------------------------------------------------------------------------

test("generate-release-sbom: emits a dependency-free SPDX document per tarball", () => {
  const work = mkdtempSync(path.join(tmpdir(), "sbom-"));
  try {
    const tarball = makeFixtureTarball(work, { name: "@fixture/sbom-pkg", version: "2.3.4" });
    const outDir = path.join(work, "sbom-out");
    const result = node(
      [path.join(SCRIPTS, "generate-release-sbom.mjs"), "--artifacts-dir", work, "--out-dir", outDir],
    );
    assert.equal(result.status, 0, result.stderr);

    const files = readdirSync(outDir).filter((file) => file.endsWith(".spdx.json"));
    assert.equal(files.length, 1);
    const document = JSON.parse(readFileSync(path.join(outDir, files[0]), "utf8"));
    assert.equal(document.spdxVersion, "SPDX-2.3");
    assert.equal(document.dataLicense, "CC0-1.0");
    assert.equal(document.packages[0].name, "@fixture/sbom-pkg");
    assert.equal(document.packages[0].versionInfo, "2.3.4");
    assert.equal(document.packages[0].filesAnalyzed, true);
    assert.match(document.packages[0].packageVerificationCode.packageVerificationCodeValue, /^[0-9a-f]{40}$/u);
    // The purl must be spec-compliant for scoped packages: `@` percent-encoded,
    // the scope separator kept literal — `pkg:npm/%40fixture/sbom-pkg@2.3.4`,
    // never `pkg:npm/fixture%2Fsbom-pkg@2.3.4`.
    assert.equal(
      document.packages[0].externalRefs[0].referenceLocator,
      "pkg:npm/%40fixture/sbom-pkg@2.3.4",
    );

    // The checksum matches the tarball bytes.
    const expectedSha = createHash("sha256").update(readFileSync(tarball)).digest("hex");
    assert.equal(
      document.packages[0].checksums.find((checksum) => checksum.algorithm === "SHA256").checksumValue,
      expectedSha,
    );

    // The verification code is reproducible from the extracted contents.
    const extract = mkdtempSync(path.join(tmpdir(), "sbom-extract-"));
    try {
      execFileSync("tar", ["-xzf", tarball, "-C", extract]);
      assert.equal(
        packageVerificationCode(path.join(extract, "package")),
        document.packages[0].packageVerificationCode.packageVerificationCodeValue,
      );
    } finally {
      rmSync(extract, { recursive: true, force: true });
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test("generate-release-sbom: tarballs never contaminate each other's verification codes", () => {
  const work = mkdtempSync(path.join(tmpdir(), "sbom-cross-"));
  try {
    // The first tarball carries an extra file that the second package lacks;
    // both share the generator's single work directory.
    const firstTarball = makeFixtureTarball(work, {
      name: "@fixture/sbom-first",
      version: "1.0.0",
      mutate: (pkg) =>
        writeFileSync(path.join(pkg, "dist", "only-first-package.txt"), "stale leftover\n"),
    });
    const secondTarball = makeFixtureTarball(work, {
      name: "@fixture/sbom-second",
      version: "2.0.0",
    });
    const outDir = path.join(work, "sbom-out");
    const result = node(
      [path.join(SCRIPTS, "generate-release-sbom.mjs"), "--artifacts-dir", work, "--out-dir", outDir],
    );
    assert.equal(result.status, 0, result.stderr);

    const documents = readdirSync(outDir)
      .filter((file) => file.endsWith(".spdx.json"))
      .map((file) => JSON.parse(readFileSync(path.join(outDir, file), "utf8")));
    assert.equal(documents.length, 2);
    const byName = new Map(documents.map((document) => [document.packages[0].name, document]));

    // Each document must describe exactly its own tarball's contents: extract
    // each tarball into a fresh directory and compare verification codes and
    // analyzed file counts. A stale leftover file from an earlier extraction
    // in the shared work dir would change both values.
    const countFiles = (dir) =>
      readdirSync(dir, { withFileTypes: true }).reduce(
        (total, entry) =>
          entry.isDirectory()
            ? total + countFiles(path.join(dir, entry.name))
            : total + (entry.isFile() ? 1 : 0),
        0,
      );
    for (const [tarball, name] of [
      [firstTarball, "@fixture/sbom-first"],
      [secondTarball, "@fixture/sbom-second"],
    ]) {
      const document = byName.get(name);
      assert.ok(document, `missing SPDX document for ${name}`);
      const extract = mkdtempSync(path.join(tmpdir(), "sbom-cross-extract-"));
      try {
        execFileSync("tar", ["-xzf", tarball, "-C", extract]);
        assert.equal(
          packageVerificationCode(path.join(extract, "package")),
          document.packages[0].packageVerificationCode.packageVerificationCodeValue,
          `${name}: verification code must be computed only from its own tarball contents`,
        );
        const ownFileCount = countFiles(path.join(extract, "package"));
        assert.ok(
          document.comment.includes(`(${ownFileCount} files analyzed`),
          `${name}: analyzed file count must not include files from other tarballs`,
        );
      } finally {
        rmSync(extract, { recursive: true, force: true });
      }
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Publication workflow guard (mutation tests for check-security-workflows)
// ---------------------------------------------------------------------------

test("publish workflow guard: the real workflow satisfies the dedicated assertions", () => {
  const workflow = parseYaml(
    readFileSync(path.join(REPO_ROOT, ".github/workflows/publish.yml"), "utf8"),
  );
  assert.deepEqual(assertPublishWorkflow(workflow, ".github/workflows/publish.yml"), []);
});

test("publish workflow guard: mutated workflows fail (push trigger, widened or narrowed permissions, foreign registry, missing gate, missing CLI floor)", () => {
  const base = parseYaml(
    readFileSync(path.join(REPO_ROOT, ".github/workflows/publish.yml"), "utf8"),
  );

  const withPushTrigger = structuredClone(base);
  withPushTrigger.on.push = { branches: ["main"] };
  assert.ok(
    assertPublishWorkflow(withPushTrigger, "publish.yml").some((violation) =>
      violation.includes("workflow_dispatch only"),
    ),
  );

  // Registry-only permission shape, at job and workflow level: widened …
  const REGISTRY_GRANT = "exactly contents: read and id-token: write";
  const grants = [
    ["widened", { contents: "read", "id-token": "write", packages: "write" }],
    ["narrowed", { contents: "read" }],
    ["contents: write", { contents: "write", "id-token": "write" }],
    ["window grant", { contents: "write", "id-token": "write", attestations: "write" }],
  ];
  for (const [label, permissions] of grants) {
    const jobLevel = structuredClone(base);
    jobLevel.jobs.publish.permissions = permissions;
    assert.ok(
      assertPublishWorkflow(jobLevel, "publish.yml").some((violation) =>
        violation.includes(`job publish must grant ${REGISTRY_GRANT}`),
      ),
      `job-level ${label} grant must fail`,
    );
    const workflowLevel = structuredClone(base);
    workflowLevel.permissions = permissions;
    assert.ok(
      assertPublishWorkflow(workflowLevel, "publish.yml").some((violation) =>
        violation.includes(`workflow permissions must grant ${REGISTRY_GRANT}`),
      ),
      `workflow-level ${label} grant must fail`,
    );
  }

  // The trusted-publishing environment gate must never be dropped.
  const environmentless = structuredClone(base);
  delete environmentless.jobs.publish.environment;
  assert.ok(
    assertPublishWorkflow(environmentless, "publish.yml").some((violation) =>
      violation.includes("environment: npm-release"),
    ),
  );

  // No token may ever be reintroduced — not even as a step env reference.
  const withToken = structuredClone(base);
  const publishStep = withToken.jobs.publish.steps.find((step) =>
    String(step.run ?? "").includes("publish-npm-packages.sh"),
  );
  publishStep.env = { ...publishStep.env, NODE_AUTH_TOKEN: "${{ secrets.MIDNIGHTCI_NPMJS_TOKEN }}" };
  assert.ok(
    assertPublishWorkflow(withToken, "publish.yml").some((violation) =>
      violation.includes("must not reference any secret or npm token"),
    ),
  );

  const foreignRegistry = structuredClone(base);
  foreignRegistry.env.NPM_REGISTRY = "https://registry.evil.example/";
  assert.ok(
    assertPublishWorkflow(foreignRegistry, "publish.yml").some((violation) =>
      violation.includes("locked to https://registry.npmjs.org/"),
    ),
  );

  const gateless = structuredClone(base);
  gateless.jobs.publish.steps = gateless.jobs.publish.steps.filter(
    (step) => !String(step.run ?? "").includes("release-resolve-context.sh"),
  );
  assert.ok(
    assertPublishWorkflow(gateless, "publish.yml").some((violation) =>
      violation.includes("release-resolve-context.sh"),
    ),
  );

  const wrongChannels = structuredClone(base);
  wrongChannels.on.workflow_dispatch.inputs.channel.options = ["snapshot", "rc"];
  assert.ok(
    assertPublishWorkflow(wrongChannels, "publish.yml").some((violation) =>
      violation.includes("snapshot|rc|release"),
    ),
  );

  // The npm CLI trusted-publishing floor check must stay: an older CLI
  // cannot exchange the GitHub OIDC token and the publish step would fail
  // opaquely at the registry.
  const floorless = structuredClone(base);
  floorless.jobs.publish.steps = floorless.jobs.publish.steps.filter(
    (step) => !String(step.run ?? "").includes("supports trusted publishing"),
  );
  assert.ok(
    assertPublishWorkflow(floorless, "publish.yml").some((violation) =>
      violation.includes("npm CLI supports trusted publishing"),
    ),
  );

  // Template-injection regression: a ${{ }} expansion inside a run: script
  // must fail the guard even when everything else is intact.
  const inlineExpansion = structuredClone(base);
  const gateStep = inlineExpansion.jobs.publish.steps.find((step) =>
    String(step.run ?? "").includes("release-resolve-context.sh"),
  );
  gateStep.run =
    'bash tooling/scripts/release-resolve-context.sh --channel "${{ inputs.channel }}"';
  assert.ok(
    assertPublishWorkflow(inlineExpansion, "publish.yml").some((violation) =>
      violation.includes("inside run:"),
    ),
  );

  // An unpinned action ref must fail the external-action pinning assertions
  // the CI lane runs over the same file — while the real workflow stays clean.
  const unpinned = structuredClone(base);
  const checkoutStep = unpinned.jobs.publish.steps.find((step) =>
    String(step.uses ?? "").startsWith("actions/checkout@"),
  );
  checkoutStep.uses = "actions/checkout@v7.0.1";
  assert.ok(
    externalActionPinningViolations(unpinned, "publish.yml").some((violation) =>
      violation.includes("must pin actions/checkout@v7.0.1 to a full commit SHA"),
    ),
  );
  assert.deepEqual(externalActionPinningViolations(base, "publish.yml"), []);
});

test("publish workflow guard: reintroducing best-effort publication or the GitHub-Release path fails", () => {
  const base = parseYaml(
    readFileSync(path.join(REPO_ROOT, ".github/workflows/publish.yml"), "utf8"),
  );
  const stepById = (workflow, id) => workflow.jobs.publish.steps.find((step) => step.id === id);
  for (const id of ["publish", "converge", "dist-tags", "registry-test"]) {
    assert.ok(stepById(base, id), `the workflow must carry the step id '${id}'`);
  }
  const violationsOf = (mutate) => {
    const mutated = structuredClone(base);
    mutate(mutated);
    return assertPublishWorkflow(mutated, "publish.yml");
  };
  const fixtures = [
    ["continue-on-error on publish", (w) => { stepById(w, "publish")["continue-on-error"] = true; }, "must not carry continue-on-error"],
    ["continue-on-error on converge", (w) => { stepById(w, "converge")["continue-on-error"] = true; }, "must not carry continue-on-error"],
    ["continue-on-error on registry-test", (w) => { stepById(w, "registry-test")["continue-on-error"] = true; }, "must not carry continue-on-error"],
    ["guarded converge", (w) => { stepById(w, "converge").if = "steps.publish.outcome == 'success'"; }, "must not be conditioned on steps.publish.outcome"],
    ["guarded dist-tags", (w) => { stepById(w, "dist-tags").if = "${{ steps.publish.outcome == 'success' }}"; }, "must not be conditioned on steps.publish.outcome"],
    ["renamed publish id", (w) => { stepById(w, "publish").id = "npm"; }, "must carry id: publish"],
    ["tag input", (w) => { w.on.workflow_dispatch.inputs.tag = { type: "string", required: true }; }, "must not declare a 'tag' input"],
    ["inputs.tag reference", (w) => { stepById(w, "publish").env.RELEASE_TAG = "${{ inputs.tag }}"; }, "must not reference inputs.tag"],
    [
      "attestation step",
      (w) => {
        w.jobs.publish.steps.push({
          name: "Attest",
          uses: "actions/attest-build-provenance@4d101475d8b20a2381f78447822ac1eab6504dd8",
          with: { "subject-path": "tooling/artifacts/npm/*.tgz" },
        });
      },
      "must not attest GitHub-Release assets",
    ],
    ["gh release step", (w) => { w.jobs.publish.steps.push({ name: "Release", run: 'gh release create "$TAG" tooling/artifacts/npm/*.tgz' }); }, "must not create or upload a GitHub Release"],
    ["release publisher step", (w) => { w.jobs.publish.steps.push({ name: "Release", run: "node tooling/scripts/publish-github-release.mjs publish" }); }, "must not create or upload a GitHub Release"],
  ];
  for (const [label, mutate, expected] of fixtures) {
    assert.ok(
      violationsOf(mutate).some((violation) => violation.includes(expected)),
      `${label} must fail with '${expected}'`,
    );
  }
});

/** Runs the workflow's summary script with the given step outcomes. */
const runSummary = (outcomes) => {
  const workflow = parseYaml(readFileSync(path.join(REPO_ROOT, ".github/workflows/publish.yml"), "utf8"));
  const step = workflow.jobs.publish.steps.find((candidate) => candidate.name === "Write the publication summary");
  const work = mkdtempSync(path.join(tmpdir(), "publish-summary-"));
  try {
    const script = path.join(work, "summary.sh");
    const summary = path.join(work, "summary.md");
    writeFileSync(script, step.run);
    writeFileSync(summary, "");
    const result = bash(script, [], {
      env: {
        ...process.env,
        GITHUB_STEP_SUMMARY: summary,
        NPM_REGISTRY: NPMJS,
        RELEASE_CHANNEL: "rc",
        RELEASE_BRANCH: "develop",
        RELEASE_VERSION: "0.1.0-rc5",
        RELEASE_NPM_TAG: "rc",
        PUBLISH_OUTCOME: outcomes[0],
        CONVERGE_OUTCOME: outcomes[1],
        DIST_TAGS_OUTCOME: outcomes[2],
        REGISTRY_TEST_OUTCOME: outcomes[3],
      },
    });
    assert.equal(result.status, 0, result.stderr);
    return readFileSync(summary, "utf8");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
};

test("publish workflow summary: classifies every outcome combination", () => {
  const workflow = parseYaml(readFileSync(path.join(REPO_ROOT, ".github/workflows/publish.yml"), "utf8"));
  const step = workflow.jobs.publish.steps.find((candidate) => candidate.name === "Write the publication summary");
  assert.equal(step.if, "always()");
  // Step outcomes reach the script through env only.
  assert.doesNotMatch(step.run, /steps\./u);
  assert.deepEqual(
    [step.env.PUBLISH_OUTCOME, step.env.CONVERGE_OUTCOME, step.env.DIST_TAGS_OUTCOME, step.env.REGISTRY_TEST_OUTCOME],
    [
      "${{ steps.publish.outcome }}",
      "${{ steps.converge.outcome }}",
      "${{ steps.dist-tags.outcome }}",
      "${{ steps.registry-test.outcome }}",
    ],
  );

  const cases = [
    [["skipped", "skipped", "skipped", "skipped"], "Rejected", /not attempted/u],
    [["", "", "", ""], "Rejected", /not attempted/u],
    [["failure", "skipped", "skipped", "skipped"], "Rejected", /npm publish failed/u],
    [["cancelled", "skipped", "skipped", "skipped"], "Rejected", /inspect the registry/u],
    [["success", "failure", "skipped", "skipped"], "Accepted, propagation timed out", /may still appear/u],
    [["success", "cancelled", "skipped", "skipped"], "Accepted, propagation timed out", /converge: cancelled/u],
    [["success", "success", "failure", "skipped"], "Visible, verification failed", /dist-tags: failure/u],
    [["success", "success", "success", "failure"], "Visible, verification failed", /registry consumer test: failure/u],
    [["success", "success", "success", "success"], "Verified", /published: Visible/u],
  ];
  for (const [outcomes, expected, detail] of cases) {
    const text = runSummary(outcomes);
    const label = outcomes.join("/");
    assert.ok(text.includes(`outcome: **${expected}**`), `${label}: ${text}`);
    assert.match(text, detail, label);
    if (expected === "Verified") {
      assert.doesNotMatch(text, /Before retrying/u, label);
    } else {
      // Retry guidance for every non-Verified outcome, and "published" is
      // reserved for Verified.
      assert.match(text, /Versions are immutable/u, label);
      assert.match(text, /Inspect the registry before re-dispatching/u, label);
      assert.match(text, /never republishes an existing version/u, label);
      assert.doesNotMatch(text, /\bpublished\b/iu, label);
    }
    if (expected === "Accepted, propagation timed out") {
      assert.doesNotMatch(text, /nothing (was|is) published|not published/iu, label);
    }
  }
});
test("publish workflow guard: the npm trusted-publishing CLI gate is active", () => {
  const workflow = parseYaml(
    readFileSync(path.join(REPO_ROOT, ".github/workflows/publish.yml"), "utf8"),
  );
  const gateSteps = Object.values(workflow.jobs ?? {})
    .flatMap((job) => job.steps ?? [])
    .filter((step) => typeof step.run === "string" && step.run.includes("supports trusted publishing"));
  assert.equal(gateSteps.length, 1, "the npm CLI trusted-publishing gate step must be active");
  assert.match(
    gateSteps[0].run,
    />= 11\.5\.1/u,
    "the gate must enforce the npm CLI floor npm's trusted publishing requires",
  );
});

// ---------------------------------------------------------------------------
// Guard import sanity (the full mutation tests live with the workflow checks)
// ---------------------------------------------------------------------------

test("release scripts are byte-identical between catalog and disk (guard rails)", () => {
  for (const script of [
    "workspace-catalog.mjs",
    "prepare-release-version.mjs",
    "release-resolve-context.sh",
    "pack-artifacts.sh",
    "check-release-package-contract.mjs",
    "test-release-package-consumers.mjs",
    "publish-npm-packages.sh",
    "wait-for-npm-packages.mjs",
    "npm-release-state.mjs",
    "generate-release-sbom.mjs",
    "npm-package-identity.mjs",
  ]) {
    assert.ok(existsSync(path.join(SCRIPTS, script)), `${script} must exist`);
  }
  // The GitHub-Release window's companions are gone for good.
  for (const script of ["verify-release-tag.mjs", "publish-github-release.mjs"]) {
    assert.equal(existsSync(path.join(SCRIPTS, script)), false, `${script} must not exist`);
  }
});
