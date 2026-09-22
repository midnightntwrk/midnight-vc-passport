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

// Release SBOM generation (npm-publication: "Release evidence"). Ported from
// midnight-verifiable-credentials. Emits one dependency-free SPDX 2.3 JSON
// document per packed tarball: the package identity, checksums, and a package
// verification code computed from the tarball contents themselves (no
// dependency-graph resolution — the SBOM describes exactly the tested bytes).
//
// CLI:
//   generate-release-sbom.mjs [--artifacts-dir <dir>] [--out-dir <dir>]

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const NPM_PUBLIC_REGISTRY = "https://registry.npmjs.org/";

const walk = (dir) => {
  const entries = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      entries.push(...walk(fullPath));
    } else if (entry.isFile()) {
      entries.push(fullPath);
    }
  }
  return entries;
};

const toPosix = (filePath) => filePath.split(path.sep).join("/");

const sha256 = (filePath) =>
  createHash("sha256").update(readFileSync(filePath)).digest("hex");

const sha1 = (filePath) =>
  createHash("sha1").update(readFileSync(filePath)).digest("hex");

/** SPDX packageVerificationCode: SHA1 over the sorted per-file SHA1 values. */
export const packageVerificationCode = (packageRoot) => {
  const files = walk(packageRoot)
    .map((file) => ({ relative: toPosix(path.relative(packageRoot, file)), digest: sha1(file) }))
    .sort((a, b) => (a.relative < b.relative ? -1 : a.relative > b.relative ? 1 : 0));
  return createHash("sha1")
    .update(files.map((file) => file.digest).join(""))
    .digest("hex");
};

/** Builds the SPDX 2.3 document for one tarball. */
export const sbomForTarball = (tarball, workDir) => {
  // The work dir may be shared across tarballs; tar extraction overwrites
  // matching paths but never deletes leftovers, so clear any previous
  // extraction first — otherwise stale files would contaminate the next
  // tarball's verification code and file count.
  rmSync(path.join(workDir, "package"), { recursive: true, force: true });
  execFileSync("tar", ["-xzf", tarball, "-C", workDir]);
  const packageRoot = path.join(workDir, "package");
  const manifest = JSON.parse(readFileSync(path.join(packageRoot, "package.json"), "utf8"));
  const tarballSha = sha256(tarball);
  const verificationCode = packageVerificationCode(packageRoot);
  const fileCount = walk(packageRoot).length;
  // The purl spec form for a scoped npm package is `pkg:npm/%40scope/name@ver`
  // (the `@` percent-encoded, the scope separator kept literal), while the
  // documentNamespace needs only a URI-safe unique path segment.
  const namespaceName = manifest.name.startsWith("@")
    ? `${manifest.name.slice(1).replace("/", "%2F")}`
    : manifest.name;
  const purlName = manifest.name.replace(/^@/u, "%40");

  return {
    spdxVersion: "SPDX-2.3",
    dataLicense: "CC0-1.0",
    SPDXID: "SPDXRef-DOCUMENT",
    name: `sbom-${manifest.name.replace(/^@/u, "").replace(/\//gu, "-")}-${manifest.version}`,
    documentNamespace: `https://midnightntwrk.github.io/midnight-verifiable-credential-digital-passport/spdx/releases/${namespaceName}/${manifest.version}/${tarballSha.slice(0, 16)}`,
    creationInfo: {
      created: new Date().toISOString(),
      creators: ["Tool: generate-release-sbom.mjs", "Organization: Midnight Foundation"],
    },
    packages: [
      {
        name: manifest.name,
        versionInfo: manifest.version,
        SPDXID: "SPDXRef-Package-Family",
        supplier: "Organization: Midnight Foundation",
        downloadLocation: `${NPM_PUBLIC_REGISTRY}${manifest.name}/-/${path.basename(tarball)}`,
        filesAnalyzed: true,
        packageVerificationCode: { packageVerificationCodeValue: verificationCode },
        licenseConcluded: "Apache-2.0",
        licenseDeclared: "Apache-2.0",
        copyrightText: "Copyright (C) Midnight Foundation",
        description:
          manifest.description ?? "Digital-passport verifiable credential family for Midnight",
        checksums: [
          { algorithm: "SHA256", checksumValue: tarballSha },
        ],
        externalRefs: [
          {
            referenceCategory: "PACKAGE-MANAGER",
            referenceType: "purl",
            referenceLocator: `pkg:npm/${purlName}@${manifest.version}`,
          },
        ],
        annotations: [],
      },
    ],
    relationships: [
      {
        spdxElementId: "SPDXRef-DOCUMENT",
        relationshipType: "DESCRIBES",
        relatedSpdxElement: "SPDXRef-Package-Family",
      },
    ],
    // Extra (non-normative) provenance hint: the analyzed file count and the
    // tarball the SBOM was generated from.
    comment: `Generated from the release tarball ${path.basename(tarball)} (${fileCount} files analyzed; dependency-free: no dependency graph is asserted).`,
  };
};

const isMain =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  const args = process.argv.slice(2);
  let artifactsDir = null;
  let outDir = null;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--artifacts-dir") {
      artifactsDir = args[++index];
    } else if (args[index] === "--out-dir") {
      outDir = args[++index];
    } else {
      console.error(`[generate-release-sbom] unknown argument ${args[index]}`);
      process.exit(2);
    }
  }

  artifactsDir ??= path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../artifacts/npm",
  );
  outDir ??= path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../artifacts/sbom",
  );

  if (!existsSync(artifactsDir)) {
    console.error(`[generate-release-sbom] no artifacts directory at ${artifactsDir} (run artifacts:pack first)`);
    process.exit(2);
  }
  const tarballs = readdirSync(artifactsDir)
    .filter((file) => file.endsWith(".tgz"))
    .map((file) => path.join(artifactsDir, file));
  if (tarballs.length === 0) {
    console.error(`[generate-release-sbom] no tarballs found in ${artifactsDir}`);
    process.exit(1);
  }

  mkdirSync(outDir, { recursive: true });
  const work = mkdtempSync(path.join(tmpdir(), "release-sbom-"));
  try {
    for (const tarball of tarballs) {
      const document = sbomForTarball(tarball, work);
      const outPath = path.join(
        outDir,
        `${path.basename(tarball).replace(/\.tgz$/u, "")}.spdx.json`,
      );
      writeFileSync(outPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
      console.log(
        `[generate-release-sbom] ${path.basename(outPath)} (version ${document.packages[0].versionInfo}, verification code ${document.packages[0].packageVerificationCode.packageVerificationCodeValue.slice(0, 12)}…)`,
      );
    }
    console.log(`[generate-release-sbom] ${tarballs.length} SPDX document(s) written to ${outDir}`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
