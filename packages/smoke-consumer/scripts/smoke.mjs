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

// Consumer smoke orchestrator. Packs the built family package into a tarball,
// creates a clean project, installs that tarball with registry-only transitive
// resolution, copies in the round-trip runner, and executes it. This proves a
// fresh consumer can install and use the family package exactly as published
// (package-distribution: "Consumer consumability evidence").
//
// The core contract layer is published as @midnight-ntwrk/credential-compact,
// so the isolated install resolves every dependency (core + runtime) from the
// npm registry — this is a genuine registry-resolution proof, not a staged one.

import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..'); // packages/smoke-consumer/scripts -> repo root
const FAMILY = '@midnight-ntwrk/midnight-verifiable-credential-digital-passport';
const NETWORK_ID = '@midnight-ntwrk/midnight-js-network-id';

function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    ...options,
  });
  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
  if (result.status !== 0) {
    throw new Error(`\`${[cmd, ...args].join(' ')}\` exited with status ${result.status}`);
  }
  return result;
}

const isolated = mkdtempSync(join(tmpdir(), 'dp-smoke-'));
console.log(`smoke: clean consumer project at ${isolated}`);
try {
  // Pack the built family tarball directly into the isolated project so its
  // location is deterministic. `pnpm pack` runs the family's `prepack` (build),
  // so the tarball always reflects the current compact sources + dist output.
  console.log('smoke: packing the built family tarball');
  run('pnpm', ['--filter', FAMILY, 'pack', '--pack-destination', isolated], { cwd: repoRoot });

  const tarball = readdirSync(isolated).find((entry) => entry.endsWith('.tgz'));
  if (!tarball) {
    throw new Error('smoke: `pnpm pack` produced no tarball');
  }
  const tarballPath = join(isolated, tarball);
  console.log(`smoke: using tarball ${tarballPath}`);

  writeFileSync(
    join(isolated, 'package.json'),
    `${JSON.stringify(
      // Pin the same pnpm as the repository so Corepack resolves a consistent
      // version (pnpm 11 moved some settings out of package.json).
      {
        name: 'smoke-consumer-isolated',
        version: '0.0.0',
        private: true,
        type: 'module',
        packageManager: 'pnpm@10.34.1',
      },
      null,
      2,
    )}\n`,
  );

  console.log('smoke: installing the family tarball with registry-only transitive resolution');
  run('pnpm', ['add', tarballPath, NETWORK_ID], { cwd: isolated });

  cpSync(join(here, 'round-trip.mjs'), join(isolated, 'round-trip.mjs'));
  console.log('smoke: running the issuance/presentation/verification round-trip');
  run('node', ['round-trip.mjs'], { cwd: isolated });

  console.log('\nsmoke: PASS — boundary evidence recorded');
} finally {
  rmSync(isolated, { recursive: true, force: true });
}
