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

// Strips `//# sourceMappingURL=` comments from the compact-compiler-generated
// managed JavaScript. Managed source maps are deliberately not shipped (per the
// package-distribution spec: the tarball carries no managed-code source maps),
// so they are removed from the source tree right after compilation and before
// the TypeScript build copies `src/managed` into `dist`.
//
// Ported as-is from the monorepo prototype: the helper is already self-contained
// (it resolves only against this package's own `src/managed` directory).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const managedDir = path.resolve(rootDir, "..", "src", "managed");

const walk = (dir) => {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    // Managed source maps are deliberately not shipped (package-distribution
    // spec). Remove the `.map` files entirely so the build's `cp -R src/managed
    // dist` cannot carry them into the published tarball.
    if (entry.name.endsWith(".map")) {
      fs.rmSync(fullPath, { force: true });
      continue;
    }
    if (!entry.name.endsWith(".js")) {
      continue;
    }

    const content = fs.readFileSync(fullPath, "utf8");
    const next = content.replace(/\n\/\/# sourceMappingURL=.*$/m, "");
    if (next !== content) {
      fs.writeFileSync(fullPath, next, "utf8");
    }
  }
};

if (fs.existsSync(managedDir)) {
  walk(managedDir);
}
