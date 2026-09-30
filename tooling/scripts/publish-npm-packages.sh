#!/usr/bin/env bash
# This file is part of midnightntwrk/midnight-vc-passport.
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

# npm publication (npm-publication: "npmjs-only publication with trusted
# publishing" and "Dist-tag safety and idempotent reruns"). Ported from
# midnight-verifiable-credentials. Preflights and publishes only: the run's
# packed-and-tested tarballs go to the public npmjs registry only, with public
# access, the channel's dist-tag, and provenance — authenticated by npm
# Trusted Publishing (the GitHub Actions OIDC exchange under `id-token:
# write`; no npm token exists, and none may be supplied). `npm publish` runs
# at most once per absent tarball and is never retried; exit 0 means the
# version was Accepted (or was already present — a no-op), nothing more.
# Visibility is established by the single convergence gate
# (wait-for-npm-packages.mjs), never here.
#
# Preflight for an already-present version: the registry payload must be the
# packed payload (npm-package-identity.mjs: integrity, then a content
# comparison) and the requested dist-tag must already resolve to it — a
# tokenless idempotent no-op. Anything else fails before any publish: a
# different payload, or a drifted dist-tag (the trusted-publishing identity
# cannot mutate dist-tags; repair belongs to a human with registry authority
# — see the runbook's escalation path). A registry read failure other than a
# recognised E404 also fails closed.
#
#   usage: publish-npm-packages.sh --npm-tag <snapshot|rc|latest> [--artifacts-dir <dir>]
#
# Env:
#   NPM_REGISTRY            must be https://registry.npmjs.org/ (locked)
#   NPM_VIEW_COMMAND        (tests only) mocked `npm view`

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

# Mockable registry view command (tooling tests); real runs use npm.
VIEW_COMMAND="${NPM_VIEW_COMMAND:-npm view}"

# Trusted publishing: authentication comes from the GitHub Actions OIDC
# exchange (npm >= 11.5.1 with `id-token: write`); an ambient npm token must
# never be present, and none is required. The ambient-environment check keeps
# a stray developer token from silently overriding the trusted identity.
if [ -n "${NODE_AUTH_TOKEN:-}${NPM_TOKEN:-}" ]; then
  fail "NODE_AUTH_TOKEN/NPM_TOKEN must not be set: publication authenticates through npm trusted publishing (OIDC), not a token"
fi

shopt -s nullglob
TARBALLS=("${ARTIFACTS_DIR}"/*.tgz)
shopt -u nullglob
[ "${#TARBALLS[@]}" -gt 0 ] || fail "no packed tarballs found in ${ARTIFACTS_DIR} (run artifacts:pack first)"

VIEW_ERR="$(mktemp)"
trap 'rm -f "${VIEW_ERR}"' EXIT

# view_version_doc <name@version> — prints the exact-version registry
# document and returns 0 when present, returns 3 on a recognised E404 (the
# version is absent), and fails the run on any other registry error.
view_version_doc() {
  local target="$1" out
  if out="$(${VIEW_COMMAND} "${target}" --json --registry "${NPM_REGISTRY}" 2>"${VIEW_ERR}")"; then
    printf '%s' "${out}"
    return 0
  fi
  if grep -q 'E404' "${VIEW_ERR}" || printf '%s' "${out}" | grep -q '"E404"'; then
    return 3
  fi
  fail "registry read failed for ${target} (not a recognised E404; refusing to publish): $(cat "${VIEW_ERR}") ${out}"
}

# doc_field <json> <dotted.path> — prints a string field of a registry
# document, or nothing when it is absent.
doc_field() {
  node -e 'const doc = JSON.parse(process.argv[1]); const v = process.argv[2].split(".").reduce((o, k) => (o == null ? undefined : o[k]), doc); if (typeof v === "string") console.log(v);' "$1" "$2"
}

PUBLISHED=0
NOOP=0
for TARBALL in "${TARBALLS[@]}"; do
  NAME_VERSION="$(tar -xzOf "${TARBALL}" package/package.json | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const m=JSON.parse(d);console.log(m.name+' '+m.version)})")"
  NAME="${NAME_VERSION% *}"
  VERSION="${NAME_VERSION#* }"
  echo "publish-npm-packages: ${NAME}@${VERSION} (tag ${NPM_TAG}) from $(basename "${TARBALL}")"

  DOC_STATUS=0
  DOC="$(view_version_doc "${NAME}@${VERSION}")" || DOC_STATUS=$?
  # view_version_doc runs in a subshell: its fail() only ends that subshell,
  # so anything other than present (0) or absent (3) must stop the run here.
  case "${DOC_STATUS}" in
    0 | 3) ;;
    *) exit 1 ;;
  esac
  if [ "${DOC_STATUS}" -eq 0 ]; then
    # Idempotent tokenless no-op: the version is already on the registry —
    # versions are immutable and `npm publish` would fail anyway. The run
    # proceeds only when the registry payload is the packed payload and the
    # requested dist-tag already resolves to this version.
    [ "$(doc_field "${DOC}" version)" = "${VERSION}" ] ||
      fail "registry metadata for ${NAME}@${VERSION} is malformed (no matching version field)"
    INTEGRITY="$(doc_field "${DOC}" dist.integrity)"
    TARBALL_URL="$(doc_field "${DOC}" dist.tarball)"
    [ -n "${INTEGRITY}" ] && [ -n "${TARBALL_URL}" ] ||
      fail "registry metadata for ${NAME}@${VERSION} is malformed (missing dist.integrity or dist.tarball)"
    node "${SCRIPT_DIR}/npm-package-identity.mjs" --tarball "${TARBALL}" --integrity "${INTEGRITY}" --tarball-url "${TARBALL_URL}" ||
      fail "${NAME}@${VERSION} is already published with a different payload than $(basename "${TARBALL}") — versions are immutable; refusing to continue"
    CURRENT_TAG="$(doc_field "${DOC}" "dist-tags.${NPM_TAG}")"
    if [ "${CURRENT_TAG}" = "${VERSION}" ]; then
      echo "publish-npm-packages: ${NAME}@${VERSION} already published with the packed payload and dist-tag '${NPM_TAG}' — tokenless no-op"
    else
      fail "${NAME}@${VERSION} is already published but dist-tag '${NPM_TAG}' resolves to '${CURRENT_TAG:-<unset>}' — the trusted-publishing identity cannot repair dist-tags; escalate to an npm organization owner (see docs/guides/npmjs-publication.md)"
    fi
    NOOP=$((NOOP + 1))
    continue
  fi

  # Trusted publishing: no token — npm exchanges the GitHub OIDC identity
  # for a short-lived publish credential. Access and the channel's dist-tag
  # ride on this invocation; --ignore-scripts keeps the packed (already
  # built and contract-checked) tarball from executing lifecycle scripts at
  # publish time. Invoked exactly once and never retried: a failure is
  # Rejected, and recovery is a re-dispatch starting from a fresh preflight.
  npm publish "${TARBALL}" \
    --registry "${NPM_REGISTRY}" \
    --access public \
    --tag "${NPM_TAG}" \
    --ignore-scripts \
    --provenance ||
    fail "npm publish was rejected for ${NAME}@${VERSION} (not retried; inspect the registry before re-dispatching)"
  echo "publish-npm-packages: ${NAME}@${VERSION} accepted by the registry (visibility is verified by the convergence gate)"
  PUBLISHED=$((PUBLISHED + 1))
done

echo "publish-npm-packages: done — ${PUBLISHED} accepted, ${NOOP} no-op (registry ${NPM_REGISTRY})"
