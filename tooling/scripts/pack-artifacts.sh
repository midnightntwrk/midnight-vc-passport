#!/usr/bin/env bash
# This file is part of midnightntwrk/midnight-verifiable-credential-digital-passport.
# Copyright (C) Midnight Foundation
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
# http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

# Artifact packing (npm-publication: "Pre-publication gate"). Ported from
# midnight-verifiable-credentials. Packs every publishable workspace (per the
# workspace catalog) into tooling/artifacts/npm, checks the tarball count,
# verifies the release package contract over the packed tarballs, and runs the
# clean-consumer installation tests against them. Only tarballs that pass this
# script in the same run are publishable.
#
#   usage: pack-artifacts.sh [--artifacts-dir <dir>]

set -euo pipefail

fail() {
  echo "pack-artifacts: $*" >&2
  exit 1
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
cd "${REPO_ROOT}"

ARTIFACTS_DIR="${REPO_ROOT}/tooling/artifacts/npm"
if [ "${1:-}" = "--artifacts-dir" ] && [ -n "${2:-}" ]; then
  ARTIFACTS="$2"
  if [[ "${ARTIFACTS}" = /* ]]; then
    ARTIFACTS_DIR="${ARTIFACTS}"
  else
    ARTIFACTS_DIR="${REPO_ROOT}/${ARTIFACTS}"
  fi
  shift 2
fi
[ "$#" -eq 0 ] || fail "unknown arguments: $*"

# Publishable workspaces come from the catalog: private workspaces (such as
# the smoke consumer) are never packed for publication.
mapfile -t PUBLISHABLE_PATHS < <(node "${SCRIPT_DIR}/workspace-catalog.mjs" --publishable-paths)
[ "${#PUBLISHABLE_PATHS[@]}" -gt 0 ] || fail "the workspace catalog lists no publishable packages"

rm -rf "${ARTIFACTS_DIR}"
mkdir -p "${ARTIFACTS_DIR}"

PACKED=0
for WORKSPACE_PATH in "${PUBLISHABLE_PATHS[@]}"; do
  NAME="$(node -e "console.log(require('${REPO_ROOT}/${WORKSPACE_PATH}/package.json').name)")"
  echo "pack-artifacts: packing ${NAME} (${WORKSPACE_PATH})"
  pnpm --filter "${NAME}" pack --pack-destination "${ARTIFACTS_DIR}"
  PACKED=$((PACKED + 1))
done

# Tarball-count check: exactly one tarball per publishable workspace.
shopt -s nullglob
TARBALLS=("${ARTIFACTS_DIR}"/*.tgz)
shopt -u nullglob
if [ "${#TARBALLS[@]}" -ne "${PACKED}" ]; then
  fail "expected ${PACKED} tarball(s) in ${ARTIFACTS_DIR}, found ${#TARBALLS[@]}"
fi

echo "pack-artifacts: verifying the release package contract"
node "${SCRIPT_DIR}/check-release-package-contract.mjs" --artifacts-dir "${ARTIFACTS_DIR}"

echo "pack-artifacts: running clean-consumer tests against the packed tarballs"
node "${SCRIPT_DIR}/test-release-package-consumers.mjs" --artifacts-dir "${ARTIFACTS_DIR}"

echo "pack-artifacts: ${#TARBALLS[@]} tarball(s) packed, contract-checked, and consumer-tested in ${ARTIFACTS_DIR}"
