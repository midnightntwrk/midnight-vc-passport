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
// lanes" — release tooling regressions fail CI). Ported and extended from
// midnight-verifiable-credentials. Covers version computation, the workspace
// catalog, publication context rules, the publish-script contract (registry
// lockdown, provenance flag, tokenless idempotent no-op, fail-closed
// dist-tag drift), the release
// package contract over sandboxed tarball fixtures, SBOM generation, the
// consumer-test argument validation and release-url mode, and — for the
// GitHub-Release distribution window — the operator-tag reconciliation, the
// release publisher (sums, body, create/no-op/drift), and the window
// workflow-guard mutations. Everything runs offline: registry views
// are mocked and tarballs are fixtures.

import { spawn, spawnSync } from "node:child_process";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
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
  expectedReleaseTag,
} from "./prepare-release-version.mjs";
import { contractViolations } from "./check-release-package-contract.mjs";
import { catalogViolations, workspaceCatalog } from "./workspace-catalog.mjs";
import { parseConsumerArgs, readTarballManifest, releaseAgePolicy } from "./test-release-package-consumers.mjs";
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

/** A mockable, stateful `npm view`: dist-tag answers read MOCK_TAGS_FILE. */
const MOCK_VIEW = (dir) => {
  const script = path.join(dir, "mock-view.mjs");
  writeFileSync(
    script,
    `${[
      "import { existsSync, readFileSync } from 'node:fs';",
      "const args = process.argv.slice(2);",
      "if (process.env.MOCK_VIEW_MISSING) { console.error('npm error code E404'); process.exit(1); }",
      "if (process.env.MOCK_VIEW_BROKEN) { console.error('npm error code E500'); process.exit(1); }",,
      "const target = args[0] ?? ''",
      "const field = args.slice(1).find((a) => !a.startsWith('--') && !/^https?:/u.test(a)) ?? '';",
      "const versionQuery = target.slice(target.lastIndexOf('@') + 1).includes('.');",
      "const readTags = () => {",
      "  const file = process.env.MOCK_TAGS_FILE;",
      "  if (file && existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));",
      "  return JSON.parse(process.env.MOCK_VIEW_TAGS ?? '{}');",
      "};",
      "if (field === 'version' || versionQuery) {",
      "  const v = process.env.MOCK_VIEW_VERSION;",
      "  if (!v) { console.error('E404 Not Found'); process.exit(1); }",
      "  console.log(JSON.stringify(v));",
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
    // WINDOW (temporary): snapshot fails closed on every branch (run-number-
    // stamped versions cannot be operator-tagged); the branch rule below it
    // stays intact for the window exit.
    ["snapshot from develop rejected (window)", "workflow_dispatch", "refs/heads/develop", ["--channel", "snapshot"], 1],
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

test("release-resolve-context: snapshot rejection names the window restriction (pre-build)", () => {
  // WINDOW (temporary): the failure must carry the window-specific message
  // (not the generic branch rule) so the operator knows why — and the channel
  // input itself keeps offering snapshot|rc|release (checker-pinned).
  const rejected = resolveContext(
    { GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REF: "refs/heads/develop" },
    ["--channel", "snapshot"],
  );
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /not available during the GitHub-Release distribution window/u);
  assert.match(rejected.stderr, /cannot be pre-tagged/u);

  // rc/release are unaffected by the guard.
  const rc = resolveContext(
    { GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REF: "refs/heads/develop" },
    ["--channel", "rc", "--rc-index", "1"],
  );
  assert.equal(rc.status, 0, rc.stderr);
  assert.doesNotMatch(rc.stdout + rc.stderr, /distribution window/u);
  const release = resolveContext(
    { GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REF: "refs/heads/main" },
    ["--channel", "release"],
  );
  assert.equal(release.status, 0, release.stderr);
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
// Release tag reconciliation (GitHub-Release distribution window)
// ---------------------------------------------------------------------------

/**
 * A sandboxed git repo carrying the tooling scripts and agreeing manifests,
 * with one initial commit on HEAD. Returns the sandbox and its HEAD sha.
 */
const makeTagSandbox = () => {
  const sandbox = mkdtempSync(path.join(tmpdir(), "release-tag-sandbox-"));
  mkdirSync(path.join(sandbox, FAMILY_PATH), { recursive: true });
  mkdirSync(path.join(sandbox, "packages", "smoke-consumer"), { recursive: true });
  cpSync(SCRIPTS, path.join(sandbox, "tooling", "scripts"), { recursive: true });
  writeFileSync(
    path.join(sandbox, "package.json"),
    `${JSON.stringify({ name: "sandbox-root", version: "0.1.0", private: true }, null, 2)}\n`,
  );
  writeFileSync(
    path.join(sandbox, FAMILY_PATH, "package.json"),
    `${JSON.stringify(
      { name: FAMILY, version: "0.1.0", private: false },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    path.join(sandbox, "packages", "smoke-consumer", "package.json"),
    `${JSON.stringify({ name: "smoke-consumer", version: "0.0.0", private: true }, null, 2)}\n`,
  );
  execFileSync("git", ["init", "-q"], { cwd: sandbox });
  execFileSync("git", ["add", "-A"], { cwd: sandbox });
  execFileSync(
    "git",
    ["-c", "user.name=Release Tooling Test", "-c", "user.email=tooling@test.invalid", "commit", "-qm", "initial"],
    { cwd: sandbox },
  );
  const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: sandbox, encoding: "utf8" }).trim();
  return { sandbox, sha };
};

const tagScriptIn = (sandbox) => path.join(sandbox, "tooling", "scripts", "verify-release-tag.mjs");

test("verify-release-tag: the happy path reconciles a tag at the dispatch commit", () => {
  const { sandbox, sha } = makeTagSandbox();
  try {
    execFileSync("git", ["tag", "v0.1.0-rc1"], { cwd: sandbox });
    const result = node([
      tagScriptIn(sandbox),
      "--tag",
      "v0.1.0-rc1",
      "--channel",
      "rc",
      "--rc-index",
      "1",
      "--sha",
      sha,
    ]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /reconciled/u);

    // An annotated tag peels to the same commit and reconciles too.
    execFileSync(
      "git",
      ["-c", "user.name=Release Tooling Test", "-c", "user.email=tooling@test.invalid", "tag", "-a", "-m", "v0.1.0", "v0.1.0"],
      { cwd: sandbox },
    );
    const annotated = node([
      tagScriptIn(sandbox),
      "--tag",
      "v0.1.0",
      "--channel",
      "release",
      "--sha",
      sha,
    ]);
    assert.equal(annotated.status, 0, annotated.stderr);
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test("verify-release-tag: missing tag fails closed before anything else", () => {
  const { sandbox, sha } = makeTagSandbox();
  try {
    const result = node([
      tagScriptIn(sandbox),
      "--tag",
      "v0.1.0-rc1",
      "--channel",
      "rc",
      "--sha",
      sha,
    ]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /does not exist in the repository/u);
    assert.match(result.stderr, /create and push/u);
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test("verify-release-tag: a tag on the wrong commit fails closed", () => {
  const { sandbox, sha } = makeTagSandbox();
  try {
    // A second commit: the tag marks it, but the dispatch was made from the
    // first commit — the reconciliation must name both shas.
    writeFileSync(path.join(sandbox, "second.txt"), "second commit\n");
    execFileSync("git", ["add", "-A"], { cwd: sandbox });
    execFileSync(
      "git",
      ["-c", "user.name=Release Tooling Test", "-c", "user.email=tooling@test.invalid", "commit", "-qm", "second"],
      { cwd: sandbox },
    );
    execFileSync("git", ["tag", "v0.1.0-rc1"], { cwd: sandbox });
    const result = node([
      tagScriptIn(sandbox),
      "--tag",
      "v0.1.0-rc1",
      "--channel",
      "rc",
      "--rc-index",
      "1",
      "--sha",
      sha,
    ]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /points at commit [0-9a-f]{40} but the dispatch commit is/u);
    // The name itself reconciles; only the commit mismatches.
    assert.doesNotMatch(result.stderr, /does not match the resolved channel version/u);
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test("verify-release-tag: tag/version drift fails closed", () => {
  const { sandbox, sha } = makeTagSandbox();
  try {
    // The tag exists at the dispatch commit, but rc_index defaults to 1 —
    // v0.1.0-rc2 is the wrong version for this dispatch.
    execFileSync("git", ["tag", "v0.1.0-rc2"], { cwd: sandbox });
    const result = node([
      tagScriptIn(sandbox),
      "--tag",
      "v0.1.0-rc2",
      "--channel",
      "rc",
      "--sha",
      sha,
    ]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /does not match the resolved channel version \(expected 'v0\.1\.0-rc1'/u);

    // The correct rc_index reconciles the same tag.
    const ok = node([
      tagScriptIn(sandbox),
      "--tag",
      "v0.1.0-rc2",
      "--channel",
      "rc",
      "--rc-index",
      "2",
      "--sha",
      sha,
    ]);
    assert.equal(ok.status, 0, ok.stderr);
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test("verify-release-tag: snapshot and malformed inputs fail closed", () => {
  const { sandbox, sha } = makeTagSandbox();
  try {
    const snapshot = node([
      tagScriptIn(sandbox),
      "--tag",
      "v0.1.0",
      "--channel",
      "snapshot",
      "--sha",
      sha,
    ]);
    assert.equal(snapshot.status, 1);
    assert.match(snapshot.stderr, /not available during the GitHub-Release distribution window/u);

    const noTag = node([tagScriptIn(sandbox), "--channel", "rc", "--sha", sha]);
    assert.equal(noTag.status, 1);
    assert.match(noTag.stderr, /--tag is required/u);

    const unknown = node([tagScriptIn(sandbox), "--tag", "v0.1.0", "--channel", "rc", "--wat"]);
    assert.equal(unknown.status, 1);
    assert.match(unknown.stderr, /unknown argument/u);

    execFileSync("git", ["tag", "v0.1.0"], { cwd: sandbox });
    const noSha = node([tagScriptIn(sandbox), "--tag", "v0.1.0", "--channel", "release"], {
      env: { ...process.env, GITHUB_SHA: "" },
    });
    assert.equal(noSha.status, 1);
    assert.match(noSha.stderr, /no dispatch commit/u);

    // The manifest base version is the source of truth: a disagreeing
    // --base-version confirmation fails closed (the tag exists and points at
    // HEAD, so the disagreement is the only violation).
    const disagreed = node([
      tagScriptIn(sandbox),
      "--tag",
      "v0.1.0",
      "--channel",
      "release",
      "--base-version",
      "9.9.9",
      "--sha",
      sha,
    ]);
    assert.equal(disagreed.status, 1);
    assert.match(disagreed.stderr, /disagrees with the manifest base version/u);
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test("verify-release-tag: the tag scheme is shared with prepare-release-version", () => {
  // The reconciliation imports the scheme (never duplicating it): the
  // exported helper must reject snapshot and derive the same tags the
  // version computation produces.
  assert.equal(expectedReleaseTag({ channel: "release", baseVersion: "0.2.0" }), "v0.2.0");
  assert.equal(expectedReleaseTag({ channel: "rc", baseVersion: "0.2.0", rcIndex: 7 }), "v0.2.0-rc7");
  assert.throws(() => expectedReleaseTag({ channel: "snapshot", baseVersion: "0.2.0" }), /cannot be pre-tagged/u);
});

// ---------------------------------------------------------------------------
// Publish-script contract
// ---------------------------------------------------------------------------

test("publish-script contract: registry lockdown, provenance, public access, tag, tokenless no-op, fail-closed drift", () => {
  const script = readFileSync(path.join(SCRIPTS, "publish-npm-packages.sh"), "utf8");

  // Registry lockdown: the script hard-fails on any other registry.
  assert.match(script, /must be locked to https:\/\/registry\.npmjs\.org\//u);

  // Provenance-enabled, public-access, tagged publication with publish-time
  // lifecycle scripts disabled.
  assert.match(script, /--provenance/u);
  assert.match(script, /--access public/u);
  assert.match(script, /--tag "\$\{NPM_TAG\}"/u);
  assert.match(script, /--ignore-scripts/u);

  // Tokenless idempotent no-op for an already-published version.
  assert.match(script, /tokenless no-op/u);
  // Dist-tag drift fails closed (trusted publishing cannot mutate dist-tags);
  // no dist-tag command exists in the script at all.
  assert.match(script, /cannot repair dist-tags/u);
  assert.doesNotMatch(script, /npm dist-tag|DIST_TAG_COMMAND/u);
  // Tarball-then-version verification after publish.
  assert.match(script, /post-publish verification/u);
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

test("publish-script: tokenless no-op and fail-closed drift under a mocked registry view", () => {
  const work = mkdtempSync(path.join(tmpdir(), "publish-noop-"));
  try {
    makeFixtureTarball(work, { version: "9.9.9" });
    const mockView = MOCK_VIEW(work);
    const tagsFile = path.join(work, "tags.json");
    writeFileSync(tagsFile, JSON.stringify({ latest: "9.8.0", rc: "9.9.9" }));

    const common = {
      ...process.env,
      NPM_VIEW_COMMAND: `node ${mockView}`,
      MOCK_VIEW_VERSION: "9.9.9",
      MOCK_TAGS_FILE: tagsFile,
    };

    // A pure no-op: version published, tag already correct — and no token in
    // the environment anywhere.
    const noop = bash(
      path.join(SCRIPTS, "publish-npm-packages.sh"),
      ["--npm-tag", "rc", "--artifacts-dir", work],
      { env: common },
    );
    assert.equal(noop.status, 0, noop.stdout + noop.stderr);
    assert.match(noop.stdout, /tokenless no-op/u);
    assert.doesNotMatch(noop.stdout, /npm publish/u);

    // The version is already published but the `rc` dist-tag has drifted to
    // an older release: the run must fail closed (trusted publishing cannot
    // mutate dist-tags) instead of repairing.
    writeFileSync(tagsFile, JSON.stringify({ latest: "9.8.0", rc: "9.9.0" }));
    const drifted = bash(
      path.join(SCRIPTS, "publish-npm-packages.sh"),
      ["--npm-tag", "rc", "--artifacts-dir", work],
      { env: common },
    );
    assert.equal(drifted.status, 1, drifted.stdout + drifted.stderr);
    assert.match(drifted.stderr, /already published but dist-tag 'rc' resolves to '9\.9\.0'/u);
    assert.match(drifted.stderr, /cannot repair dist-tags/u);
    assert.doesNotMatch(drifted.stderr + drifted.stdout, /dist-tag add/u);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

/**
 * Builds an `npm` PATH shim for exercising the real publish path of
 * publish-npm-packages.sh without touching the network: `publish` calls are
 * recorded, `view` calls are served by a lagging mock whose version queries
 * E404 for the first `versionLag` calls before resolving to `version`.
 */
const makeLaggingNpm = (dir, { version, versionLag }) => {
  const binDir = path.join(dir, "bin");
  mkdirSync(binDir, { recursive: true });
  const pollsFile = path.join(dir, "version-polls");
  const publishLog = path.join(dir, "publish.log");
  const tagsFile = path.join(dir, "tags.json");
  writeFileSync(pollsFile, "0");
  writeFileSync(publishLog, "");
  writeFileSync(tagsFile, "{}");
  const lagView = path.join(dir, "lag-view.mjs");
  writeFileSync(
    lagView,
    `${[
      "import { readFileSync, writeFileSync } from 'node:fs';",
      "const args = process.argv.slice(2);",
      "const target = args[0] ?? '';",
      "const field = args.slice(1).find((a) => !a.startsWith('--') && !/^https?:/u.test(a)) ?? '';",
      "const versionQuery = target.includes('@') && target.slice(target.lastIndexOf('@') + 1).includes('.');",
      "if (field === 'version' || versionQuery) {",
      "  const polls = Number(readFileSync(process.env.MOCK_POLLS_FILE, 'utf8')) + 1;",
      "  writeFileSync(process.env.MOCK_POLLS_FILE, String(polls));",
      `  if (polls <= ${versionLag}) { console.error('E404 Not Found'); process.exit(1); }`,
      `  console.log(JSON.stringify(${JSON.stringify(version)}));`,
      "} else if (field.startsWith('dist-tags')) {",
      "  const tags = JSON.parse(readFileSync(process.env.MOCK_TAGS_FILE, 'utf8'));",
      "  const key = field.split('.')[1];",
      "  const value = tags[key];",
      "  if (value === undefined) { console.error('E404 Not Found'); process.exit(1); }",
      "  console.log(JSON.stringify(value));",
      "} else { console.error('unsupported mock query: ' + field); process.exit(1); }",
    ].join("\n")}\n`,
  );
  const shim = path.join(binDir, "npm");
  writeFileSync(
    shim,
    `${[
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      'if [ "${1:-}" = "publish" ]; then',
      "  printf '%s\\n' \"$*\" >> \"${MOCK_PUBLISH_LOG}\"",
      "  exit 0",
      'elif [ "${1:-}" = "view" ]; then',
      '  exec node "${MOCK_LAG_VIEW}" "${@:2}"',
      "else",
      '  echo "unsupported npm subcommand: $*" >&2',
      "  exit 1",
      "fi",
    ].join("\n")}\n`,
  );
  chmodSync(shim, 0o755);
  return {
    pollsFile,
    publishLog,
    env: (extra = {}) => ({
      ...process.env,
      PATH: `${binDir}:${process.env.PATH}`,
      MOCK_POLLS_FILE: pollsFile,
      MOCK_PUBLISH_LOG: publishLog,
      MOCK_LAG_VIEW: lagView,
      MOCK_TAGS_FILE: tagsFile,
      ...extra,
    }),
  };
};

test("publish-script: post-publish verification retries through registry propagation lag", () => {
  const work = mkdtempSync(path.join(tmpdir(), "publish-retry-"));
  try {
    makeFixtureTarball(work, { version: "9.9.9" });
    // Version queries E404 for the first three polls: the pre-publish check
    // (poll 1) takes the publish path, and post-publish verification must
    // retry through polls 2–3 before the version becomes visible on poll 4.
    const mock = makeLaggingNpm(work, { version: "9.9.9", versionLag: 3 });
    const result = bash(
      path.join(SCRIPTS, "publish-npm-packages.sh"),
      ["--npm-tag", "rc", "--artifacts-dir", work],
      {
        env: mock.env({ NPM_VIEW_RETRIES: "4", NPM_VIEW_INTERVAL: "0" }),
      },
    );
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /published and verified/u);
    assert.match(result.stderr, /polling again/u);
    assert.match(
      readFileSync(mock.publishLog, "utf8"),
      /--tag rc --ignore-scripts --provenance/u,
      "the tarball must have been published exactly once",
    );
    assert.equal(readFileSync(mock.pollsFile, "utf8"), "4");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test("publish-script: post-publish verification fails closed only after the retry budget", () => {
  const work = mkdtempSync(path.join(tmpdir(), "publish-budget-"));
  try {
    makeFixtureTarball(work, { version: "9.9.9" });
    // The version never becomes visible: verification must poll the full
    // budget, then fail — while the publish itself did happen (the failure
    // message must point at propagation, not at publication).
    const mock = makeLaggingNpm(work, { version: "9.9.9", versionLag: Infinity });
    const result = bash(
      path.join(SCRIPTS, "publish-npm-packages.sh"),
      ["--npm-tag", "rc", "--artifacts-dir", work],
      {
        env: mock.env({ NPM_VIEW_RETRIES: "3", NPM_VIEW_INTERVAL: "0" }),
      },
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /post-publish verification failed/u);
    assert.match(result.stderr, /did not become visible/u);
    assert.match(readFileSync(mock.publishLog, "utf8"), /--tag rc --ignore-scripts --provenance/u);
    assert.equal(readFileSync(mock.pollsFile, "utf8"), "4");
  } finally {
    rmSync(work, { recursive: true, force: true });
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

// ---------------------------------------------------------------------------
// Registry propagation wait
// ---------------------------------------------------------------------------

test("wait-for-npm-packages: resolves via a mocked view and times out on absence", () => {
  const work = mkdtempSync(path.join(tmpdir(), "wait-npm-"));
  try {
    const mockView = MOCK_VIEW(work);
    const visible = node(
      [path.join(SCRIPTS, "wait-for-npm-packages.mjs"), "--version", "0.1.0-rc1", "--npm-tag", "rc", "--view-cmd", `node ${mockView}`],
      { env: { ...process.env, MOCK_VIEW_VERSION: "0.1.0-rc1", MOCK_VIEW_TAGS: '{"rc":"0.1.0-rc1"}' } },
    );
    assert.equal(visible.status, 0, visible.stderr);
    assert.match(visible.stdout, /dist-tag 'rc'/u);

    const missingTag = node(
      [path.join(SCRIPTS, "wait-for-npm-packages.mjs"), "--version", "0.1.0-rc1", "--npm-tag", "rc", "--timeout", "1", "--interval", "1", "--view-cmd", `node ${mockView}`],
      { env: { ...process.env, MOCK_VIEW_VERSION: "0.1.0-rc1", MOCK_VIEW_TAGS: "{}" } },
    );
    assert.equal(missingTag.status, 1);
    assert.match(missingTag.stderr, /timed out/u);

    const absent = node(
      [
        path.join(SCRIPTS, "wait-for-npm-packages.mjs"),
        "--version",
        "0.1.0-rc1",
        "--npm-tag",
        "rc",
        "--timeout",
        "1",
        "--interval",
        "1",
        "--view-cmd",
        `node ${mockView}`,
      ],
      { env: { ...process.env, MOCK_VIEW_VERSION: "" } },
    );
    assert.equal(absent.status, 1);
    assert.match(absent.stderr, /timed out/u);

    const unlocked = node(
      [path.join(SCRIPTS, "wait-for-npm-packages.mjs"), "--version", "0.1.0-rc1", "--npm-tag", "rc", "--registry", "https://evil.example/", "--view-cmd", `node ${mockView}`],
      { env: { ...process.env, MOCK_VIEW_VERSION: "0.1.0-rc1" } },
    );
    assert.equal(unlocked.status, 1);

    const untagged = node(
      [path.join(SCRIPTS, "wait-for-npm-packages.mjs"), "--version", "0.1.0-rc1", "--view-cmd", `node ${mockView}`],
      { env: { ...process.env, MOCK_VIEW_VERSION: "0.1.0-rc1" } },
    );
    assert.equal(untagged.status, 1);
    assert.match(untagged.stderr, /--npm-tag is required/u);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test("wait-for-npm-packages: waits for the dist-tag to catch up with the version", () => {
  const work = mkdtempSync(path.join(tmpdir(), "wait-tag-"));
  try {
    const tagsFile = path.join(work, "tags.json");
    const pollsFile = path.join(work, "polls");
    writeFileSync(tagsFile, JSON.stringify({ rc: "0.0.9" }));
    writeFileSync(pollsFile, "0");
    // The version becomes visible at poll 2, but the dist-tag write only
    // propagates at poll 3: the waiter must keep polling both, since the
    // very next workflow step gates on the dist-tag.
    const mockView = path.join(work, "mock-view.mjs");
    writeFileSync(
      mockView,
      `${[
        "import { readFileSync, writeFileSync } from 'node:fs';",
        "const args = process.argv.slice(2);",
        "const target = args[0] ?? '';",
        "const field = args.slice(1).find((a) => !a.startsWith('--') && !/^https?:/u.test(a)) ?? '';",
        "const versionQuery = target.includes('@') && target.slice(target.lastIndexOf('@') + 1).includes('.');",
        "if (field === 'version' || versionQuery) {",
        "  const polls = Number(readFileSync(process.env.MOCK_POLLS_FILE, 'utf8')) + 1;",
        "  writeFileSync(process.env.MOCK_POLLS_FILE, String(polls));",
        "  if (polls < 2) { console.error('E404 Not Found'); process.exit(1); }",
        "  if (polls === 3) {",
        "    const tags = JSON.parse(readFileSync(process.env.MOCK_TAGS_FILE, 'utf8'));",
        "    tags.rc = '0.1.0-rc1';",
        "    writeFileSync(process.env.MOCK_TAGS_FILE, JSON.stringify(tags));",
        "  }",
        "  console.log(JSON.stringify('0.1.0-rc1'));",
        "} else if (field.startsWith('dist-tags')) {",
        "  const tags = JSON.parse(readFileSync(process.env.MOCK_TAGS_FILE, 'utf8'));",
        "  const key = field.split('.')[1];",
        "  const value = tags[key];",
        "  if (value === undefined) { console.error('E404 Not Found'); process.exit(1); }",
        "  console.log(JSON.stringify(value));",
        "} else { console.error('unsupported mock query: ' + field); process.exit(1); }",
      ].join("\n")}\n`,
    );
    const result = node(
      [
        path.join(SCRIPTS, "wait-for-npm-packages.mjs"),
        "--version",
        "0.1.0-rc1",
        "--npm-tag",
        "rc",
        "--timeout",
        "10",
        "--interval",
        "0",
        "--view-cmd",
        `node ${mockView}`,
      ],
      { env: { ...process.env, MOCK_POLLS_FILE: pollsFile, MOCK_TAGS_FILE: tagsFile } },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /dist-tag 'rc'/u);
    assert.ok(
      Number(readFileSync(pollsFile, "utf8")) >= 3,
      "the waiter must keep polling while the dist-tag lags the version",
    );
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

test("test-release-package-consumers: release-url argument validation (WINDOW)", () => {
  const RELEASE_ASSET =
    "https://github.com/midnightntwrk/midnight-vc-passport/releases/download/v0.1.0-rc1/midnight-ntwrk-midnight-vc-passport-0.1.0-rc1.tgz";
  assert.deepEqual(parseConsumerArgs(["--release-url", RELEASE_ASSET]).mode, "release-url");
  // Plain http is only for localhost test harnesses.
  assert.deepEqual(
    parseConsumerArgs(["--release-url", "http://127.0.0.1:8080/asset.tgz"]).mode,
    "release-url",
  );
  assert.deepEqual(
    parseConsumerArgs(["--release-url", "http://localhost:8080/asset.tgz"]).mode,
    "release-url",
  );
  assert.throws(() => parseConsumerArgs(["--release-url", "http://example.com/asset.tgz"]), /https/u);
  assert.throws(() => parseConsumerArgs(["--release-url", "https://example.com/asset.tar"]), /\.tgz/u);
  assert.throws(() => parseConsumerArgs(["--release-url", "not a url"]), /must be a URL/u);
  assert.throws(
    () =>
      parseConsumerArgs([
        "--release-url",
        RELEASE_ASSET,
        "--registry",
        NPMJS,
        "--version",
        "0.1.0",
      ]),
    /cannot be combined/u,
  );
  assert.throws(
    () => parseConsumerArgs(["--release-url", RELEASE_ASSET, "--artifacts-dir", "/tmp"]),
    /cannot be combined/u,
  );
});

test("test-release-package-consumers: release-url mode round-trips against a local HTTP-served tarball", async () => {
  const work = mkdtempSync(path.join(tmpdir(), "consumer-release-url-"));
  const tarballPath = makeFixtureTarball(work, { version: "0.1.0-rc1" });
  const tarballBytes = readFileSync(tarballPath);
  const expectedSha = createHash("sha256").update(tarballBytes).digest("hex");
  // The asset server runs as its own process (a sibling of the spawned
  // consumer script, mirroring how CI serves a real release download).
  const assetPath = `/${path.basename(tarballPath)}`;
  const serverScript = path.join(work, "asset-server.mjs");
  writeFileSync(
    serverScript,
    `${[
      "import http from 'node:http';",
      "import { readFileSync } from 'node:fs';",
      `const bytes = readFileSync(${JSON.stringify(tarballPath)});`,
      `const assetPath = ${JSON.stringify(assetPath)};`,
      "const server = http.createServer((request, response) => {",
      "  if (request.url === assetPath) {",
      "    response.writeHead(200, { 'content-type': 'application/gzip' });",
      "    response.end(bytes);",
      "  } else {",
      "    response.writeHead(404);",
      "    response.end();",
      "  }",
      "});",
      "server.listen(0, '127.0.0.1', () => { process.stdout.write(String(server.address().port)); });",
    ].join("\n")}\n`,
  );
  const server = spawn("node", [serverScript], { stdio: ["ignore", "pipe", "inherit"] });
  try {
    const port = await new Promise((resolve, reject) => {
      server.stdout.once("data", (chunk) => resolve(String(chunk).trim()));
      server.once("error", reject);
    });
    const url = `http://127.0.0.1:${port}${assetPath}`;

    // A mockable `pnpm` (the makeLaggingNpm pattern): `add <url> <network-id>`
    // fetches the URL — proving the harness installs from the served release
    // asset, bytes verified by digest — and places the extracted package into
    // the clean project's node_modules, exactly where the round-trip looks.
    const binDir = path.join(work, "bin");
    mkdirSync(binDir, { recursive: true });
    const installLog = path.join(work, "install.log");
    writeFileSync(installLog, "");
    const installer = path.join(work, "mock-pnpm-install.mjs");
    writeFileSync(
      installer,
      `${[
        "import { execFileSync } from 'node:child_process';",
        "import { createHash } from 'node:crypto';",
        "import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync, cpSync } from 'node:fs';",
        "import { tmpdir } from 'node:os';",
        "import path from 'node:path';",
        "const args = process.argv.slice(2);",
        "const url = args.find((argument) => argument.startsWith('http'));",
        "if (!url) { throw new Error('no URL in ' + JSON.stringify(args)); }",
        "const response = await fetch(url);",
        "if (!response.ok) { throw new Error('server returned ' + response.status); }",
        "const bytes = Buffer.from(await response.arrayBuffer());",
        "const digest = createHash('sha256').update(bytes).digest('hex');",
        "if (digest !== process.env.MOCK_EXPECTED_SHA) { throw new Error('served bytes drifted from the fixture tarball'); }",
        "const extract = mkdtempSync(path.join(tmpdir(), 'release-url-extract-'));",
        "writeFileSync(path.join(extract, 'asset.tgz'), bytes);",
        "execFileSync('tar', ['-xzf', path.join(extract, 'asset.tgz'), '-C', extract]);",
        "const manifest = JSON.parse(readFileSync(path.join(extract, 'package', 'package.json'), 'utf8'));",
        "const target = path.join(process.cwd(), 'node_modules', manifest.name);",
        "mkdirSync(target, { recursive: true });",
        "cpSync(path.join(extract, 'package'), target, { recursive: true });",
        "rmSync(extract, { recursive: true, force: true });",
      ].join("\n")}\n`,
    );
    const shim = path.join(binDir, "pnpm");
    writeFileSync(
      shim,
      `${[
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        'if [ "${1:-}" = "add" ]; then',
        "  shift",
        '  printf \'%s\\n\' "$*" >> "${MOCK_PNPM_LOG}"',
        '  exec node "${MOCK_PNPM_INSTALL}" "$@"',
        "else",
        '  echo "unsupported pnpm subcommand: $*" >&2',
        "  exit 1",
        "fi",
      ].join("\n")}\n`,
    );
    chmodSync(shim, 0o755);

    // A stub round-trip (RELEASE_CONSUMER_ROUND_TRIP test hook) that verifies
    // the installed package landed in the clean project from the served URL.
    const stubRoundTrip = path.join(work, "stub-round-trip.mjs");
    writeFileSync(
      stubRoundTrip,
      `${[
        "import { readFileSync } from 'node:fs';",
        `const manifest = JSON.parse(readFileSync('node_modules/${FAMILY}/package.json', 'utf8'));`,
        `if (manifest.name !== ${JSON.stringify(FAMILY)}) { throw new Error('installed ' + manifest.name); }`,
        `if (manifest.version !== '0.1.0-rc1') { throw new Error('installed ' + manifest.version); }`,
        "console.log('stub round-trip: installed manifest reconciles');",
      ].join("\n")}\n`,
    );

    const result = node(
      [path.join(SCRIPTS, "test-release-package-consumers.mjs"), "--release-url", url],
      {
        env: {
          ...process.env,
          PATH: `${binDir}:${process.env.PATH}`,
          MOCK_PNPM_LOG: installLog,
          MOCK_PNPM_INSTALL: installer,
          MOCK_EXPECTED_SHA: expectedSha,
          RELEASE_CONSUMER_ROUND_TRIP: stubRoundTrip,
        },
      },
    );
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /release-url consumer: PASS/u);
    assert.match(result.stdout, /stub round-trip/u);
    const installArgs = readFileSync(installLog, "utf8");
    assert.ok(
      installArgs.includes(url),
      `the install must reference the release URL (got: ${installArgs.trim()})`,
    );
    assert.ok(
      installArgs.includes("@midnight-ntwrk/midnight-js-network-id"),
      "the install must add the network-id helper alongside the URL dependency",
    );

    // The mode proves the channel end-to-end: a 404 URL must fail the run,
    // not silently skip the install.
    const broken = node(
      [
        path.join(SCRIPTS, "test-release-package-consumers.mjs"),
        "--release-url",
        `http://127.0.0.1:${port}/missing.tgz`,
      ],
      {
        env: {
          ...process.env,
          PATH: `${binDir}:${process.env.PATH}`,
          MOCK_PNPM_LOG: installLog,
          MOCK_PNPM_INSTALL: installer,
          MOCK_EXPECTED_SHA: expectedSha,
          RELEASE_CONSUMER_ROUND_TRIP: stubRoundTrip,
        },
      },
    );
    assert.notEqual(broken.status, 0);
    assert.match(broken.stderr + broken.stdout, /server returned 404|exited with status/u);
  } finally {
    server.kill();
    rmSync(work, { recursive: true, force: true });
  }
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
// GitHub-Release publication (window): sums, body, create/no-op/drift
// ---------------------------------------------------------------------------

/** A mockable `gh` for the release-publication script: `create`/`upload`
 * record their command line and hash exactly the files they receive,
 * resolved relative to their cwd (the artifacts dir — like real gh, no
 * subdirectory probing); `view` validates its --json fields against the
 * fields real `gh release view` supports and serves the recorded state, so
 * a rerun after create naturally no-ops unless the state is mutated. */
const MOCK_GH = (dir) => {
  const script = path.join(dir, "mock-gh.mjs");
  writeFileSync(
    script,
    `${[
      "import { createHash } from 'node:crypto';",
      "import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';",
      "import path from 'node:path';",
      "const args = process.argv.slice(2);",
      "const [, sub, tag] = args;",
      "const stateFile = process.env.MOCK_GH_STATE;",
      "const logFile = process.env.MOCK_GH_LOG;",
      "const readState = () =>",
      "  existsSync(stateFile)",
      "    ? JSON.parse(readFileSync(stateFile, 'utf8'))",
      "    : { exists: false, assets: [] };",
      "const save = (state) => writeFileSync(stateFile, JSON.stringify(state));",
      "const filesOf = (rest) => {",
      "  const files = [];",
      "  while (rest.length > 0 && !rest[0].startsWith('--')) files.push(rest.shift());",
      "  return files;",
      "};",
      "const resolveAsset = (name) => {",
      "  const resolved = path.resolve(process.cwd(), name);",
      "  if (!existsSync(resolved)) throw new Error('no such asset on disk: ' + name);",
      "  return resolved;",
      "};",
      "const digestOf = (file) =>",
      "  'sha256:' + createHash('sha256').update(readFileSync(resolveAsset(file))).digest('hex');",
      "const assetFiles = (allArgs) => filesOf(allArgs.slice(3));",
      "if (sub === 'view') {",
      "  const state = readState();",
      "  const supportedFields = ['assets', 'isPrerelease'];",
      "  const fieldsArg = args[args.indexOf('--json') + 1] ?? '';",
      "  const requested = fieldsArg.split(',').filter(Boolean);",
      "  const unsupported = requested.filter((field) => !supportedFields.includes(field));",
      "  if (unsupported.length > 0) {",
      "    console.error('unknown JSON field: ' + unsupported.join(', '));",
      "    process.exit(1);",
      "  }",
      "  if (!state.exists || state.tag !== tag) { console.error('release not found'); process.exit(1); }",
      "  const payload = {};",
      "  for (const field of requested) payload[field] = state[field];",
      "  console.log(JSON.stringify(payload));",
      "} else if (sub === 'create') {",
      "  appendFileSync(logFile, JSON.stringify(args) + '\\n');",
      "  const files = assetFiles(args);",
      "  const isPrerelease = args.includes('--prerelease');",
      "  save({",
      "    exists: true,",
      "    tag,",
      "    assets: files.map((file) => ({ name: path.basename(file), digest: digestOf(file) })),",
      "    isPrerelease,",
      "  });",
      "} else if (sub === 'upload') {",
      "  appendFileSync(logFile, JSON.stringify(args) + '\\n');",
      "  const files = assetFiles(args);",
      "  const state = readState();",
      "  state.assets.push(",
      "    ...files.map((file) => ({ name: path.basename(file), digest: digestOf(file) })),",
      "  );",
      "  save(state);",
      "} else {",
      "  console.error('unsupported gh subcommand: ' + sub);",
      "  process.exit(1);",
      "}",
    ].join("\n")}\n`,
  );
  return script;
};

/** A minimal release artifact set: tarball, SBOM, and contract report. */
const makeReleaseArtifacts = (dir, { version = "0.1.0-rc1" } = {}) => {
  const npmDir = path.join(dir, "npm");
  const sbomDir = path.join(dir, "sbom");
  mkdirSync(npmDir, { recursive: true });
  mkdirSync(sbomDir, { recursive: true });
  const tarball = makeFixtureTarball(npmDir, { version });
  const sbomName = `${path.basename(tarball).replace(/\.tgz$/u, "")}.spdx.json`;
  writeFileSync(
    path.join(sbomDir, sbomName),
    `${JSON.stringify({ spdxVersion: "SPDX-2.3", packages: [{ name: FAMILY, versionInfo: version }] }, null, 2)}\n`,
  );
  writeFileSync(
    path.join(dir, "contract-report.json"),
    `${JSON.stringify({ result: "pass", version, tarballs: [{ tarball: path.basename(tarball), passed: true, violations: [] }] }, null, 2)}\n`,
  );
  return { tarball, sbomName };
};

test("publish-github-release: prepare writes deterministic SHA256SUMS and body", () => {
  const work = mkdtempSync(path.join(tmpdir(), "release-gh-prepare-"));
  try {
    const { tarball, sbomName } = makeReleaseArtifacts(work);
    const prepared = node([
      path.join(SCRIPTS, "publish-github-release.mjs"),
      "prepare",
      "--tag",
      "v0.1.0-rc1",
      "--channel",
      "rc",
      "--repo",
      "midnightntwrk/midnight-vc-passport",
      "--artifacts-dir",
      work,
    ]);
    assert.equal(prepared.status, 0, prepared.stderr);

    const sumsPath = path.join(work, "SHA256SUMS");
    const first = readFileSync(sumsPath, "utf8");
    const entries = first.trim().split("\n");
    assert.equal(entries.length, 3, "sums cover tarball + SBOM + contract report");
    const names = entries.map((entry) => entry.split(/\s+/u)[1]);
    assert.deepEqual(names, [names[0], ...names.slice(1)].sort());
    assert.ok(names.includes(path.basename(tarball)));
    assert.ok(names.includes(sbomName));
    assert.ok(names.includes("contract-report.json"));
    for (const entry of entries) {
      const [digest, name] = entry.split(/\s+/u);
      const onDisk = ["SHA256SUMS", "contract-report.json"].includes(name)
        ? path.join(work, name)
        : name.endsWith(".spdx.json")
          ? path.join(work, "sbom", name)
          : path.join(work, "npm", name);
      assert.equal(
        digest,
        createHash("sha256").update(readFileSync(onDisk)).digest("hex"),
        `${name} digest must match its bytes`,
      );
    }

    const body = readFileSync(path.join(work, "release-body.md"), "utf8");
    assert.match(body, /0\.1\.0-rc1 \(rc\)/u);
    assert.match(
      body,
      /https:\/\/github\.com\/midnightntwrk\/midnight-vc-passport\/releases\/download\/v0\.1\.0-rc1\/midnight-ntwrk-midnight-vc-passport-0\.1\.0-rc1\.tgz/u,
    );
    assert.match(body, /sha256sum --check SHA256SUMS/u);
    assert.match(body, /gh attestation verify --repo midnightntwrk\/midnight-vc-passport/u);
    assert.match(body, /\/CHANGELOG\.md\)/u);

    // Deterministic: a rerun produces identical bytes.
    node([
      path.join(SCRIPTS, "publish-github-release.mjs"),
      "prepare",
      "--tag",
      "v0.1.0-rc1",
      "--channel",
      "rc",
      "--repo",
      "midnightntwrk/midnight-vc-passport",
      "--artifacts-dir",
      work,
    ]);
    assert.equal(readFileSync(sumsPath, "utf8"), first);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test("publish-github-release: publish creates an rc prerelease, then reruns as a verified no-op", () => {
  const work = mkdtempSync(path.join(tmpdir(), "release-gh-publish-"));
  try {
    const { tarball, sbomName } = makeReleaseArtifacts(work);
    const mockGh = MOCK_GH(work);
    const stateFile = path.join(work, "gh-state.json");
    const logFile = path.join(work, "gh.log");
    writeFileSync(logFile, "");
    const output = path.join(work, "github-output");
    const env = {
      ...process.env,
      GH_COMMAND: `node ${mockGh}`,
      MOCK_GH_STATE: stateFile,
      MOCK_GH_LOG: logFile,
      GH_TOKEN: "dummy",
    };
    const runPublish = (extra = []) =>
      node(
        [
          path.join(SCRIPTS, "publish-github-release.mjs"),
          "publish",
          "--tag",
          "v0.1.0-rc1",
          "--channel",
          "rc",
          "--repo",
          "midnightntwrk/midnight-vc-passport",
          "--artifacts-dir",
          work,
          ...extra,
        ],
        { env },
      );

    // prepare must run first: publish without sums fails closed.
    const unprepared = runPublish();
    assert.equal(unprepared.status, 1, "publish before prepare must fail");
    assert.match(unprepared.stderr, /SHA256SUMS is missing/u);

    node([
      path.join(SCRIPTS, "publish-github-release.mjs"),
      "prepare",
      "--tag",
      "v0.1.0-rc1",
      "--channel",
      "rc",
      "--repo",
      "midnightntwrk/midnight-vc-passport",
      "--artifacts-dir",
      work,
    ]);

    const created = runPublish(["--github-output", output]);
    assert.equal(created.status, 0, created.stdout + created.stderr);
    const commands = readFileSync(logFile, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    const create = commands.find((command) => command[1] === "create");
    assert.ok(create, "the release must be created");
    assert.ok(create.includes("--prerelease"), "rc creates a prerelease (never latest)");
    assert.ok(!create.includes("--latest"));
    assert.ok(create.includes("--verify-tag"), "create must not move the operator tag");
    assert.ok(create.includes("release-body.md"), "create attaches the generated body");
    for (const asset of ["SHA256SUMS", "contract-report.json"]) {
      assert.ok(create.includes(asset), `create must upload ${asset}`);
    }
    // Subdirectory assets must be passed relative to the artifacts dir
    // (gh's cwd): bare basenames would not resolve on a real runner.
    assert.ok(
      create.includes(`npm/${path.basename(tarball)}`),
      "create must pass the tarball as an artifacts-dir-relative path",
    );
    assert.ok(
      create.includes(`sbom/${sbomName}`),
      "create must pass the SBOM as an artifacts-dir-relative path",
    );
    assert.match(created.stdout, /release-url=https:\/\/github\.com\/midnightntwrk\/midnight-vc-passport\/releases\/download\/v0\.1\.0-rc1\/midnight-ntwrk-midnight-vc-passport-0\.1\.0-rc1\.tgz/u);
    assert.match(readFileSync(output, "utf8"), /^release-url=https:\/\//u);

    // Idempotent rerun: identical assets → verified no-op, no second create/upload.
    const rerun = runPublish();
    assert.equal(rerun.status, 0, rerun.stdout + rerun.stderr);
    assert.match(rerun.stdout, /no-op/u);
    const commandsAfter = readFileSync(logFile, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(
      commandsAfter.filter((command) => command[1] === "create" || command[1] === "upload").length,
      1,
      "the rerun must not create or upload anything",
    );

    // Digest drift on an existing asset fails closed (never --clobber).
    const state = JSON.parse(readFileSync(stateFile, "utf8"));
    state.assets[0].digest = "sha256:" + "0".repeat(64);
    writeFileSync(stateFile, JSON.stringify(state));
    const drifted = runPublish();
    assert.equal(drifted.status, 1);
    assert.match(drifted.stderr, /drifted/u);
    assert.doesNotMatch(readFileSync(logFile, "utf8"), /--clobber/u);

    // Channel semantics on a rerun: restore correct digests for every
    // asset, then flip isPrerelease — a release wrongly not marked prerelease
    // must fail for the rc channel.
    const locationOf = (name) =>
      ["SHA256SUMS", "contract-report.json"].includes(name)
        ? path.join(work, name)
        : name.endsWith(".spdx.json")
          ? path.join(work, "sbom", name)
          : path.join(work, "npm", name);
    const flipped = JSON.parse(readFileSync(stateFile, "utf8"));
    for (const asset of flipped.assets) {
      asset.digest =
        "sha256:" + createHash("sha256").update(readFileSync(locationOf(asset.name))).digest("hex");
    }
    flipped.isPrerelease = false;
    writeFileSync(stateFile, JSON.stringify(flipped));
    const wrongShape = runPublish();
    assert.equal(wrongShape.status, 1);
    assert.match(wrongShape.stderr, /isPrerelease/u);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test("publish-github-release: a partial upload is completed by a rerun, drift is not", () => {
  const work = mkdtempSync(path.join(tmpdir(), "release-gh-partial-"));
  try {
    makeReleaseArtifacts(work, { version: "0.1.0" });
    const mockGh = MOCK_GH(work);
    const stateFile = path.join(work, "gh-state.json");
    const logFile = path.join(work, "gh.log");
    writeFileSync(logFile, "");
    const env = {
      ...process.env,
      GH_COMMAND: `node ${mockGh}`,
      MOCK_GH_STATE: stateFile,
      MOCK_GH_LOG: logFile,
      GH_TOKEN: "dummy",
    };
    const REPO = "midnightntwrk/midnight-vc-passport";
    node([path.join(SCRIPTS, "publish-github-release.mjs"), "prepare", "--tag", "v0.1.0", "--channel", "release", "--repo", REPO, "--artifacts-dir", work]);
    const created = node([
      path.join(SCRIPTS, "publish-github-release.mjs"),
      "publish",
      "--tag",
      "v0.1.0",
      "--channel",
      "release",
      "--repo",
      REPO,
      "--artifacts-dir",
      work,
    ], { env });
    assert.equal(created.status, 0, created.stdout + created.stderr);
    const createCommand = JSON.parse(readFileSync(logFile, "utf8").trim().split("\n")[0]);
    assert.ok(createCommand.includes("--latest"), "the release channel marks latest");
    assert.ok(!createCommand.includes("--prerelease"));
    // Simulate a partial upload: drop one asset from the recorded state.
    const state = JSON.parse(readFileSync(stateFile, "utf8"));
    const dropped = state.assets.pop();
    const droppedPath = ["SHA256SUMS", "contract-report.json"].includes(dropped.name)
      ? dropped.name
      : dropped.name.endsWith(".spdx.json")
        ? `sbom/${dropped.name}`
        : `npm/${dropped.name}`;
    writeFileSync(stateFile, JSON.stringify(state));
    const completed = node([
      path.join(SCRIPTS, "publish-github-release.mjs"),
      "publish",
      "--tag",
      "v0.1.0",
      "--channel",
      "release",
      "--repo",
      REPO,
      "--artifacts-dir",
      work,
    ], { env });
    assert.equal(completed.status, 0, completed.stdout + completed.stderr);
    const lines = readFileSync(logFile, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    const upload = lines.find((command) => command[1] === "upload");
    assert.ok(upload, "the missing asset must be uploaded");
    assert.deepEqual(upload.slice(3, -2), [droppedPath], "only the missing asset is uploaded, as an artifacts-dir-relative path (no clobber)");
    assert.equal(
      lines.filter((command) => command[1] === "create").length,
      1,
      "a rerun never recreates the release",
    );

    // An unexpected extra asset on the release fails closed as drift.
    const withExtra = JSON.parse(readFileSync(stateFile, "utf8"));
    withExtra.assets.push({ name: "planted.tgz", digest: "sha256:" + "1".repeat(64) });
    writeFileSync(stateFile, JSON.stringify(withExtra));
    const extra = node([
      path.join(SCRIPTS, "publish-github-release.mjs"),
      "publish",
      "--tag",
      "v0.1.0",
      "--channel",
      "release",
      "--repo",
      REPO,
      "--artifacts-dir",
      work,
    ], { env });
    assert.equal(extra.status, 1);
    assert.match(extra.stderr, /unexpected asset 'planted\.tgz'/u);
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

  // WINDOW (temporary) permission shape: widened …
  const WINDOW_GRANT = "exactly contents: write, id-token: write, and attestations: write";
  const widened = structuredClone(base);
  widened.jobs.publish.permissions = {
    contents: "write",
    "id-token": "write",
    attestations: "write",
    packages: "write",
  };
  assert.ok(
    assertPublishWorkflow(widened, "publish.yml").some((violation) =>
      violation.includes(WINDOW_GRANT),
    ),
  );

  // … and narrowed (a dropped or downgraded grant must fail just the same —
  // including the registry-only shape the window-exit change restores).
  const narrowed = structuredClone(base);
  narrowed.jobs.publish.permissions = { contents: "write", "id-token": "write" };
  assert.ok(
    assertPublishWorkflow(narrowed, "publish.yml").some((violation) =>
      violation.includes(WINDOW_GRANT),
    ),
  );
  const registryOnly = structuredClone(base);
  registryOnly.jobs.publish.permissions = { contents: "read", "id-token": "write" };
  assert.ok(
    assertPublishWorkflow(registryOnly, "publish.yml").some((violation) =>
      violation.includes(WINDOW_GRANT),
    ),
  );
  const readContents = structuredClone(base);
  readContents.jobs.publish.permissions = {
    contents: "read",
    "id-token": "write",
    attestations: "write",
  };
  assert.ok(
    assertPublishWorkflow(readContents, "publish.yml").some((violation) =>
      violation.includes(WINDOW_GRANT),
    ),
  );

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

test("publish workflow guard: window mutations fail (template injection in a release step, unpinned action, missing or late tag reconciliation, missing tag input, missing or late release steps, fail-closed or unguarded npm steps)", () => {
  const base = parseYaml(
    readFileSync(path.join(REPO_ROOT, ".github/workflows/publish.yml"), "utf8"),
  );

  // A release step interpolating ${{ }} inside run: (here: the release-create
  // invocation) must fail the template-hygiene assertion.
  const releaseInjection = structuredClone(base);
  const createStep = releaseInjection.jobs.publish.steps.find((step) =>
    String(step.run ?? "").includes("publish-github-release.mjs publish"),
  );
  assert.ok(createStep, "the window workflow must carry the release-create step");
  createStep.run =
    'node tooling/scripts/publish-github-release.mjs publish --tag "${{ inputs.tag }}" --channel "$RELEASE_CHANNEL" --repo "$GITHUB_REPOSITORY"';
  assert.ok(
    assertPublishWorkflow(releaseInjection, "publish.yml").some((violation) =>
      violation.includes("inside run:"),
    ),
  );

  // An unpinned action ref (the attestation action, here) must fail the
  // external-action pinning assertions the CI lane runs over the same file.
  const unpinned = structuredClone(base);
  const attestStep = unpinned.jobs.publish.steps.find((step) =>
    String(step.uses ?? "").startsWith("actions/attest-build-provenance@"),
  );
  assert.ok(attestStep, "the window workflow must carry the attestation step");
  attestStep.uses = "actions/attest-build-provenance@v4.2.2";
  assert.ok(
    externalActionPinningViolations(unpinned, "publish.yml").some((violation) =>
      violation.includes("must pin actions/attest-build-provenance@v4.2.2 to a full commit SHA"),
    ),
  );
  // … while the real workflow stays clean.
  assert.deepEqual(externalActionPinningViolations(base, "publish.yml"), []);

  // Removing the tag-reconciliation step must fail the window assertion …
  const reconcileless = structuredClone(base);
  reconcileless.jobs.publish.steps = reconcileless.jobs.publish.steps.filter(
    (step) => !String(step.run ?? "").includes("verify-release-tag.mjs"),
  );
  assert.ok(
    assertPublishWorkflow(reconcileless, "publish.yml").some((violation) =>
      violation.includes("verify-release-tag.mjs"),
    ),
  );

  // … and so must moving it after tool setup / the repository gate (drift
  // would burn the expensive steps before failing).
  const lateReconcile = structuredClone(base);
  const steps = lateReconcile.jobs.publish.steps;
  const reconcileIndex = steps.findIndex((step) =>
    String(step.run ?? "").includes("verify-release-tag.mjs"),
  );
  const [reconcileStep] = steps.splice(reconcileIndex, 1);
  const gateIndex = steps.findIndex(
    (step) => String(step.run ?? "").includes("pnpm run all"),
  );
  // Insert AFTER the repository gate: drift would burn the expensive steps.
  steps.splice(gateIndex + 1, 0, reconcileStep);
  assert.ok(
    assertPublishWorkflow(lateReconcile, "publish.yml").some((violation) =>
      violation.includes("before the repository gate"),
    ),
  );

  // The operator tag input must stay required.
  const tagless = structuredClone(base);
  delete tagless.on.workflow_dispatch.inputs.tag;
  assert.ok(
    assertPublishWorkflow(tagless, "publish.yml").some((violation) =>
      violation.includes("required string input 'tag'"),
    ),
  );
  const optionalTag = structuredClone(base);
  optionalTag.on.workflow_dispatch.inputs.tag.required = false;
  assert.ok(
    assertPublishWorkflow(optionalTag, "publish.yml").some((violation) =>
      violation.includes("required string input 'tag'"),
    ),
  );

  // Every GitHub-Release step must be present …
  for (const needle of ["publish-github-release.mjs prepare", "publish-github-release.mjs publish", "--release-url"]) {
    const missing = structuredClone(base);
    missing.jobs.publish.steps = missing.jobs.publish.steps.filter(
      (step) => !String(step.run ?? "").includes(needle),
    );
    assert.ok(
      assertPublishWorkflow(missing, "publish.yml").some((violation) =>
        violation.includes("must run the GitHub-Release step"),
      ),
      `removing '${needle}' must fail the window assertion`,
    );
  }
  const attestless = structuredClone(base);
  attestless.jobs.publish.steps = attestless.jobs.publish.steps.filter(
    (step) => !String(step.uses ?? "").startsWith("actions/attest-build-provenance@"),
  );
  assert.ok(
    assertPublishWorkflow(attestless, "publish.yml").some((violation) =>
      violation.includes("'actions/attest-build-provenance'"),
    ),
  );

  // … and precede the npm attempt (the Release must never depend on npm).
  const lateRelease = structuredClone(base);
  const lateSteps = lateRelease.jobs.publish.steps;
  const createIndex = lateSteps.findIndex((step) =>
    String(step.run ?? "").includes("publish-github-release.mjs publish"),
  );
  const [lateCreate] = lateSteps.splice(createIndex, 1);
  lateSteps.splice(
    lateSteps.findIndex((step) => String(step.run ?? "").includes("publish-npm-packages.sh")) + 1,
    0,
    lateCreate,
  );
  assert.ok(
    assertPublishWorkflow(lateRelease, "publish.yml").some((violation) =>
      violation.includes("before the npm publish"),
    ),
  );

  // The npm publish must stay best-effort during the window …
  const failClosed = structuredClone(base);
  const npmStep = failClosed.jobs.publish.steps.find((step) =>
    String(step.run ?? "").includes("publish-npm-packages.sh"),
  );
  delete npmStep["continue-on-error"];
  assert.ok(
    assertPublishWorkflow(failClosed, "publish.yml").some((violation) =>
      violation.includes("must be best-effort"),
    ),
  );

  // … and every downstream registry step must be guarded on its outcome.
  for (const needle of ["wait-for-npm-packages.mjs", "--verify --snapshot-file", "--registry \"$NPM_REGISTRY\" --version"]) {
    const unguarded = structuredClone(base);
    const step = unguarded.jobs.publish.steps.find((candidate) =>
      String(candidate.run ?? "").includes(needle),
    );
    assert.ok(step, `the window workflow must carry the registry step '${needle}'`);
    delete step.if;
    assert.ok(
      assertPublishWorkflow(unguarded, "publish.yml").some((violation) =>
        violation.includes("steps.publish.outcome == 'success'"),
      ),
      `an unguarded '${needle}' step must fail the window assertion`,
    );
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
    // WINDOW (temporary): GitHub-Release distribution companions.
    "verify-release-tag.mjs",
    "publish-github-release.mjs",
  ]) {
    assert.ok(existsSync(path.join(SCRIPTS, script)), `${script} must exist`);
  }
});
