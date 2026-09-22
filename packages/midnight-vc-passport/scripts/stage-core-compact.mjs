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

// Stages the generic VC/VP core compact sources from the installed
// `@midnight-ntwrk/credential-compact` package into a local include path
// (`../core-compact-staging/`, relative to `src/digital-passport-credential.compact`)
// so the compact compiler can resolve the core `include` without depending on
// compact 0.31.1's package-include syntax.
//
// This is the build-time staging fallback selected by the OpenSpec change
// `extract-digital-passport-credential` (Spike Outcome 1.2/1.3, design D7/D8):
// it is independent of compact 0.31.1's package-specifier or node_modules-relative
// include syntax. A clean confirmation of a direct include syntax under the
// current toolchain will downgrade the build to a direct include and drop this
// staging step.
//
// The staged sources are a build artifact: they are git-ignored, excluded from
// the published tarball (`files` lists only `src/**/*.compact`), and regenerated
// on every `compact` run.

import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(scriptDir, "..");
const stagingDir = path.resolve(packageRoot, "core-compact-staging");

// Resolve the installed core package's exported compact entry from this
// package's own manifest so the staging works under pnpm's symlinked
// node_modules layout. The core package exports `./credentials.compact`
// (pointing at its `dist/credentials.compact`); resolving that subpath locates
// the canonical published compact sources without depending on a `package.json`
// subpath (which the core exports map does not expose).
const require = createRequire(path.join(packageRoot, "package.json"));
const sourceEntry = require.resolve(
  "@midnight-ntwrk/credential-compact/credentials.compact",
);
const compactRoot = path.dirname(sourceEntry);
const sourceTree = path.join(compactRoot, "credentials");

if (!fs.existsSync(sourceEntry)) {
  throw new Error(`Core compact entry not found: ${sourceEntry}`);
}
if (!fs.existsSync(sourceTree)) {
  throw new Error(`Core compact tree not found: ${sourceTree}`);
}

// Regenerate the staging directory from scratch on every run.
fs.rmSync(stagingDir, { recursive: true, force: true });
fs.mkdirSync(stagingDir, { recursive: true });

fs.copyFileSync(sourceEntry, path.join(stagingDir, "credentials.compact"));

const copyDir = (src, dest) => {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(from, to);
    } else if (entry.isFile() && entry.name.endsWith(".compact")) {
      fs.copyFileSync(from, to);
    }
  }
};
copyDir(sourceTree, path.join(stagingDir, "credentials"));

const copied = fs
  .readdirSync(stagingDir, { recursive: true })
  .filter((p) => String(p).endsWith(".compact")).length;

console.info(
  `Staged ${copied} core compact source(s) from ${path.relative(packageRoot, compactRoot)} into ${path.relative(packageRoot, stagingDir)}`,
);
