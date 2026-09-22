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

# npm publication (npm-publication: "Registry publication with provenance" and
# "Dist-tag safety and idempotency"). Ported from midnight-verifiable-credentials.
# Publishes the run's packed-and-tested tarballs to the public npmjs registry
# only, with public access, the channel's dist-tag, and provenance. Re-running
# for an already-published version and dist-tag is an idempotent no-op; a
# drifted dist-tag is repaired rather than republished (versions are immutable).
#
#   usage: publish-npm-packages.sh --npm-tag <snapshot|rc|latest> [--artifacts-dir <dir>]
#
# Env:
#   NPM_REGISTRY            must be https://registry.npmjs.org/ (locked)
#   NODE_AUTH_TOKEN         the org npm automation token (via .npmrc; never an argument)
#   NPM_VIEW_COMMAND        (tests only) mocked `npm view`
#   NPM_DIST_TAG_COMMAND    (tests only) mocked `npm dist-tag`
#   NPM_VIEW_RETRIES        verification poll attempts before failing (default 12)
#   NPM_VIEW_INTERVAL       seconds between verification polls (default 5)

set -euo pipefail

fail() {
  echo "publish-npm-packages: $*" >&2
  exit 1
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
cd "${REPO_ROOT}"

NPM_TAG=""
ARTIFACTS_DIR="${REPO_ROOT}/tooling/artifacts/npm"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --npm-tag)
      [ "$#" -ge 2 ] || fail "--npm-tag requires a value"
      NPM_TAG="$2"
      shift 2
      ;;
    --artifacts-dir)
      [ "$#" -ge 2 ] || fail "--artifacts-dir requires a value"
      ARTIFACTS_DIR="$2"
      if [[ "${ARTIFACTS_DIR}" != /* ]]; then
        ARTIFACTS_DIR="${REPO_ROOT}/${ARTIFACTS_DIR}"
      fi
      shift 2
      ;;
    *)
      fail "unknown argument: $1"
      ;;
  esac
done

[ -n "${NPM_TAG}" ] || fail "--npm-tag is required (snapshot | rc | latest)"
case "${NPM_TAG}" in
  snapshot | rc | latest) ;;
  *) fail "unknown npm tag '${NPM_TAG}'" ;;
esac

# Registry lockdown: the publish step may only ever talk to the public npmjs
# registry. Any other configured registry fails the run before publishing.
NPM_REGISTRY="${NPM_REGISTRY:-https://registry.npmjs.org/}"
[ "${NPM_REGISTRY}" = "https://registry.npmjs.org/" ] ||
  fail "NPM_REGISTRY must be locked to https://registry.npmjs.org/ (got '${NPM_REGISTRY}')"

# Mockable registry view commands (tooling tests); real runs use npm.
VIEW_COMMAND="${NPM_VIEW_COMMAND:-npm view}"
DIST_TAG_COMMAND="${NPM_DIST_TAG_COMMAND:-npm dist-tag}"

# Post-publish verification budget: registry visibility lags behind a
# successful publish (the dedicated wait-for-npm-packages.mjs workflow step
# exists for the same propagation lag), so verification polls instead of
# failing on the first absent answer.
VIEW_RETRIES="${NPM_VIEW_RETRIES:-12}"
VIEW_INTERVAL="${NPM_VIEW_INTERVAL:-5}"
case "${VIEW_RETRIES}" in '' | *[!0-9]*) fail "NPM_VIEW_RETRIES must be a positive integer (got '${VIEW_RETRIES}')" ;; esac
[ "${VIEW_RETRIES}" -ge 1 ] || fail "NPM_VIEW_RETRIES must be a positive integer (got '${VIEW_RETRIES}')"
case "${VIEW_INTERVAL}" in '' | *[!0-9]*) fail "NPM_VIEW_INTERVAL must be a non-negative integer of seconds (got '${VIEW_INTERVAL}')" ;; esac

# The token is consumed through .npmrc / the environment only — never workflow
# inputs, command arguments, repository files, or logs.
[ -n "${NODE_AUTH_TOKEN:-}" ] || fail "NODE_AUTH_TOKEN is not set; refusing to publish"

shopt -s nullglob
TARBALLS=("${ARTIFACTS_DIR}"/*.tgz)
shopt -u nullglob
[ "${#TARBALLS[@]}" -gt 0 ] || fail "no packed tarballs found in ${ARTIFACTS_DIR} (run artifacts:pack first)"

view_json() {
  # view_json <name> <field> — prints the JSON-decoded value, or nothing when
  # the version is not visible yet.
  local name="$1" field="$2" out
  if out="$(${VIEW_COMMAND} "${name}" "${field}" --json --registry "${NPM_REGISTRY}" 2>/dev/null)"; then
    node -e "const v = JSON.parse(process.argv[1]); if (v !== undefined && v !== null) console.log(v);" "${out}" 2>/dev/null || true
  fi
  return 0
}

view_json_until() {
  # view_json_until <name> <field> <expected> <what> — polls view_json until
  # it prints <expected>, within the bounded propagation budget above. A
  # single immediate check would report false failures while the registry
  # catches up with a publish or dist-tag write that already succeeded.
  local name="$1" field="$2" expected="$3" what="$4" attempt value
  for attempt in $(seq 1 "${VIEW_RETRIES}"); do
    value="$(view_json "${name}" "${field}")"
    if [ "${value}" = "${expected}" ]; then
      return 0
    fi
    if [ "${attempt}" -lt "${VIEW_RETRIES}" ]; then
      echo "publish-npm-packages: ${what} not yet visible on the registry (got '${value:-<unset>}'), polling again in ${VIEW_INTERVAL}s (${attempt}/${VIEW_RETRIES})" >&2
      sleep "${VIEW_INTERVAL}"
    fi
  done
  echo "publish-npm-packages: ${what} never converged to '${expected}' within $((VIEW_RETRIES * VIEW_INTERVAL))s of polling" >&2
  return 1
}

PUBLISHED=0
NOOP=0
for TARBALL in "${TARBALLS[@]}"; do
  NAME_VERSION="$(tar -xzOf "${TARBALL}" package/package.json | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const m=JSON.parse(d);console.log(m.name+' '+m.version)})")"
  NAME="${NAME_VERSION% *}"
  VERSION="${NAME_VERSION#* }"
  echo "publish-npm-packages: ${NAME}@${VERSION} (tag ${NPM_TAG}) from $(basename "${TARBALL}")"

  VISIBLE="$(view_json "${NAME}@${VERSION}" version)"
  if [ -n "${VISIBLE}" ]; then
    # Idempotent no-op: the version is already on the registry. Verify (and if
    # needed repair) the dist-tag instead of republishing — versions are
    # immutable and `npm publish` would fail anyway.
    CURRENT_TAG="$(view_json "${NAME}" "dist-tags.${NPM_TAG}")" || CURRENT_TAG=""
    if [ "${CURRENT_TAG}" = "${VERSION}" ]; then
      echo "publish-npm-packages: ${NAME}@${VERSION} already published with dist-tag '${NPM_TAG}' — no-op"
    else
      echo "publish-npm-packages: ${NAME}@${VERSION} already published but dist-tag '${NPM_TAG}' resolves to '${CURRENT_TAG:-<unset>}' — repairing"
      ${DIST_TAG_COMMAND} add "${NAME}@${VERSION}" "${NPM_TAG}" --registry "${NPM_REGISTRY}"
      view_json_until "${NAME}" "dist-tags.${NPM_TAG}" "${VERSION}" "dist-tag '${NPM_TAG}' for ${NAME} after repair" ||
        fail "dist-tag repair for ${NAME} '${NPM_TAG}' did not take effect (still not '${VERSION}' after $((VIEW_RETRIES * VIEW_INTERVAL))s)"
    fi
    NOOP=$((NOOP + 1))
    continue
  fi

  npm publish "${TARBALL}" \
    --registry "${NPM_REGISTRY}" \
    --access public \
    --tag "${NPM_TAG}" \
    --provenance

  # Tarball-then-version verification: the registry must now resolve the
  # exact version that was packed in this run — polled, because visibility
  # lags behind a successful publish.
  view_json_until "${NAME}@${VERSION}" version "${VERSION}" "version ${NAME}@${VERSION}" ||
    fail "post-publish verification failed: ${NAME}@${VERSION} did not become visible on ${NPM_REGISTRY} within $((VIEW_RETRIES * VIEW_INTERVAL))s (propagation lag; check the registry before re-dispatching — versions are immutable and a rerun is an idempotent no-op)"
  echo "publish-npm-packages: ${NAME}@${VERSION} published and verified"
  PUBLISHED=$((PUBLISHED + 1))
done

echo "publish-npm-packages: done — ${PUBLISHED} published, ${NOOP} no-op (registry ${NPM_REGISTRY})"
