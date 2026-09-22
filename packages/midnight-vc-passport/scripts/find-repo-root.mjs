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

// Locates the workspace root for this standalone repository.
//
// Adapted from the monorepo prototype's helper for the pnpm + turbo workspace
// used here. Unlike the monorepo (whose root manifest carries a `workspaces`
// array), this repository declares its workspaces in `pnpm-workspace.yaml`, so
// the root is detected from either marker. The helper is self-contained and
// network-free; it only walks parent directories.

import { readFile } from "node:fs/promises";
import path from "node:path";

const isWorkspaceRoot = async (dir) => {
  try {
    const packageJson = JSON.parse(
      await readFile(path.join(dir, "package.json"), "utf8"),
    );
    if (Array.isArray(packageJson.workspaces)) {
      return true;
    }
  } catch (error) {
    if (!(error instanceof Error) || error.code !== "ENOENT") {
      throw error;
    }
  }

  // pnpm workspace marker (this repository).
  try {
    await readFile(path.join(dir, "pnpm-workspace.yaml"), "utf8");
    return true;
  } catch (error) {
    if (!(error instanceof Error) || error.code !== "ENOENT") {
      throw error;
    }
  }

  return false;
};

export const findRepoRoot = async (startDir) => {
  let currentDir = path.resolve(startDir);

  while (true) {
    if (await isWorkspaceRoot(currentDir)) {
      return currentDir;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      throw new Error(
        "Could not locate the workspace root (no package.json workspaces or pnpm-workspace.yaml found)",
      );
    }
    currentDir = parentDir;
  }
};
