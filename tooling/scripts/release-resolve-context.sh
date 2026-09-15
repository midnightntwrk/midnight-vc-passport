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

# Publication context resolution (npm-publication: "Publication channels and
# branch gating"). Ported from midnight-verifiable-credentials. Runs FIRST in
# the publish workflow: every gate below fails the run before any build, pack,
# or publish step executes.
#
#   usage: release-resolve-context.sh --channel <snapshot|rc|release> \
#            [--version <base>] [--rc-index <n>]
#
# Env:
#   GITHUB_EVENT_NAME  must be workflow_dispatch (manual dispatch only)
#   GITHUB_REF         the dispatch ref (refs/heads/<branch>)
#   GITHUB_OUTPUT      (optional) receives channel/branch/npm-tag/base-version
#
# Rules:
#   - publication only through manual dispatch (no push/PR/schedule events)
#   - snapshot: develop only
#   - rc:       develop or main
#   - release:  main only
#   - rc_index: positive integer, and only valid for the rc channel
#   - version:  optional stable semantic version

set -euo pipefail

fail() {
  echo "release-resolve-context: $*" >&2
  exit 1
}

CHANNEL=""
BASE_VERSION=""
RC_INDEX=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --channel)
      [ "$#" -ge 2 ] || fail "--channel requires a value"
      CHANNEL="$2"
      shift 2
      ;;
    --version)
      [ "$#" -ge 2 ] || fail "--version requires a value"
      BASE_VERSION="$2"
      shift 2
      ;;
    --rc-index)
      [ "$#" -ge 2 ] || fail "--rc-index requires a value"
      RC_INDEX="$2"
      shift 2
      ;;
    *)
      fail "unknown argument: $1"
      ;;
  esac
done

[ -n "$CHANNEL" ] || fail "--channel is required (snapshot | rc | release)"
case "$CHANNEL" in
  snapshot | rc | release) ;;
  *)
    fail "unknown channel '$CHANNEL' (expected snapshot, rc, or release)"
    ;;
esac

# Manual dispatch only: no automated (push-event) publication may exist.
if [ -z "${GITHUB_EVENT_NAME:-}" ]; then
  fail "GITHUB_EVENT_NAME is not set; this script runs inside the publish workflow"
fi
if [ "${GITHUB_EVENT_NAME}" != "workflow_dispatch" ]; then
  fail "publication is only possible through manual workflow dispatch (got event '${GITHUB_EVENT_NAME}')"
fi

if [ -z "${GITHUB_REF:-}" ]; then
  fail "GITHUB_REF is not set; cannot determine the dispatch branch"
fi
case "${GITHUB_REF}" in
  refs/heads/*) ;;
  *)
    fail "publication must be dispatched from a branch (got ref '${GITHUB_REF}')"
    ;;
esac
BRANCH="${GITHUB_REF#refs/heads/}"

case "${CHANNEL}:${BRANCH}" in
  snapshot:develop) ;;
  rc:develop | rc:main) ;;
  release:main) ;;
  *)
    case "${CHANNEL}" in
      snapshot) fail "snapshot publications are only allowed from 'develop' (got '${BRANCH}')" ;;
      rc) fail "rc publications are only allowed from 'develop' or 'main' (got '${BRANCH}')" ;;
      release) fail "release publications are only allowed from 'main' (got '${BRANCH}')" ;;
    esac
    ;;
esac

if [ -n "${RC_INDEX}" ]; then
  if [ "${CHANNEL}" != "rc" ]; then
    fail "rc_index is only valid for the rc channel (channel is '${CHANNEL}')"
  fi
  if ! [[ "${RC_INDEX}" =~ ^[1-9][0-9]*$ ]]; then
    fail "rc_index must be a positive integer (got '${RC_INDEX}')"
  fi
else
  if [ "${CHANNEL}" = "rc" ]; then
    RC_INDEX="1"
  fi
fi

if [ -n "${BASE_VERSION}" ]; then
  if ! [[ "${BASE_VERSION}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    fail "version must be a stable semantic version (got '${BASE_VERSION}')"
  fi
fi

case "${CHANNEL}" in
  snapshot) NPM_TAG="snapshot" ;;
  rc) NPM_TAG="rc" ;;
  release) NPM_TAG="latest" ;;
esac

emit() {
  echo "$1"
  if [ -n "${GITHUB_OUTPUT:-}" ]; then
    echo "$1" >>"${GITHUB_OUTPUT}"
  fi
}

emit "channel=${CHANNEL}"
emit "branch=${BRANCH}"
emit "npm-tag=${NPM_TAG}"
if [ -n "${BASE_VERSION}" ]; then
  emit "base-version=${BASE_VERSION}"
fi
if [ -n "${RC_INDEX}" ]; then
  emit "rc-index=${RC_INDEX}"
fi

echo "release-resolve-context: channel=${CHANNEL} branch=${BRANCH} npm-tag=${NPM_TAG}${BASE_VERSION:+ base-version=${BASE_VERSION}}${RC_INDEX:+ rc-index=${RC_INDEX}}"
