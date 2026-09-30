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

// Payload identity (npm-publication: "Verified post-publication registry
// checks" — payload identity). Modelled on midnight-did's
// verify-npm-package-identity.mjs. Shared by the publisher preflight
// (publish-npm-packages.sh) and the convergence gate
// (wait-for-npm-packages.mjs): a registry version is the packed payload when
// its recorded `dist.integrity` equals the packed tarball's `sha512-`
// integrity, or — when a rebuild is byte-different — when the registry
// tarball's package contents are identical entry by entry (paths, bytes, and
// the executable bit; tar header mtime/ownership are ignored). Any other
// difference is a mismatch and fails closed.
//
// CLI:
//   npm-package-identity.mjs --tarball <packed.tgz> --integrity <sri> --tarball-url <url>
//     exit 0: identical payload; exit 1: mismatch or error (reason on stderr)

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";

/** Upper bound on a registry tarball download (the packed package is ~10 KiB). */
export const MAX_TARBALL_BYTES = 50 * 1024 * 1024;
/** Upper bound on the registry tarball download time. */
export const DOWNLOAD_TIMEOUT_MS = 60_000;

const REGISTRY_TARBALL_ORIGIN = "https://registry.npmjs.org";
// Plain http is accepted only for localhost test harnesses.
const LOCAL_TEST_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/u;

/** The `sha512-<base64>` subresource integrity of a tarball's bytes. */
export const tarballIntegrity = (bytes) =>
  `sha512-${createHash("sha512").update(bytes).digest("base64")}`;

const readString = (block, offset, length) => {
  const slice = block.subarray(offset, offset + length);
  const end = slice.indexOf(0);
  return slice.subarray(0, end === -1 ? slice.length : end).toString("utf8");
};

const readOctal = (block, offset, length) => {
  const text = readString(block, offset, length).trim();
  if (text === "") {
    return 0;
  }
  if (!/^[0-7]+$/u.test(text)) {
    throw new Error(`malformed tar header field '${text}'`);
  }
  return Number.parseInt(text, 8);
};

const parsePax = (data) => {
  const records = {};
  let rest = data.toString("utf8");
  while (rest.length > 0) {
    const space = rest.indexOf(" ");
    const length = Number(rest.slice(0, space));
    if (space === -1 || !Number.isInteger(length) || length <= 0) {
      throw new Error("malformed pax extended header");
    }
    const record = rest.slice(space + 1, length - 1);
    const equals = record.indexOf("=");
    records[record.slice(0, equals)] = record.slice(equals + 1);
    rest = rest.slice(length);
  }
  return records;
};

/**
 * The regular-file entries of a gzipped tar archive, keyed by path:
 * `{ type, data, executable, linkname }`. Directory entries and pax/GNU
 * metadata records are folded away; any other entry type is kept (with its
 * type) so that a symlink or device node never compares equal to a file.
 */
export const readTarballEntries = (bytes) => {
  const tar = gunzipSync(bytes);
  const entries = new Map();
  let offset = 0;
  let longName = null;
  let pax = {};
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) {
      break;
    }
    const size = readOctal(header, 124, 12);
    const type = String.fromCharCode(header[156] || 0x30);
    const dataStart = offset + 512;
    const data = tar.subarray(dataStart, dataStart + size);
    if (data.length !== size) {
      throw new Error("truncated tar archive");
    }
    offset = dataStart + Math.ceil(size / 512) * 512;

    if (type === "L") {
      longName = readString(data, 0, data.length);
      continue;
    }
    if (type === "x") {
      pax = parsePax(data);
      continue;
    }
    if (type === "g") {
      continue;
    }
    const prefix = readString(header, 345, 155);
    const name = readString(header, 0, 100);
    const entryPath = pax.path ?? longName ?? (prefix ? `${prefix}/${name}` : name);
    const linkname = pax.linkpath ?? readString(header, 157, 100);
    longName = null;
    pax = {};
    if (type === "5") {
      continue;
    }
    const normalized = path.posix.normalize(entryPath).replace(/^\.\//u, "");
    entries.set(normalized, {
      type: type === "\0" ? "0" : type,
      data: Buffer.from(data),
      executable: (readOctal(header, 100, 8) & 0o111) !== 0,
      linkname,
    });
  }
  return entries;
};

/**
 * Entry-by-entry comparison of two gzipped package tarballs. Returns the list
 * of differences (empty when the package contents are identical).
 */
export const compareTarballContents = (localBytes, remoteBytes) => {
  const local = readTarballEntries(localBytes);
  const remote = readTarballEntries(remoteBytes);
  const differences = [];
  for (const [entryPath, entry] of local) {
    const other = remote.get(entryPath);
    if (!other) {
      differences.push(`${entryPath}: missing from the registry tarball`);
      continue;
    }
    if (entry.type !== other.type || entry.linkname !== other.linkname) {
      differences.push(`${entryPath}: entry type differs`);
    } else if (!entry.data.equals(other.data)) {
      differences.push(`${entryPath}: content differs`);
    } else if (entry.executable !== other.executable) {
      differences.push(`${entryPath}: executable bit differs`);
    }
  }
  for (const entryPath of remote.keys()) {
    if (!local.has(entryPath)) {
      differences.push(`${entryPath}: only in the registry tarball`);
    }
  }
  return differences;
};

const assertTarballUrl = (url) => {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`registry tarball URL is not a URL (got ${url})`);
  }
  const registryOrigin = parsed.protocol === "https:" && parsed.origin === REGISTRY_TARBALL_ORIGIN;
  const localHarness = parsed.protocol === "http:" && LOCAL_TEST_HOST.test(parsed.host);
  if (!registryOrigin && !localHarness) {
    throw new Error(
      `registry tarball URL must be served by ${REGISTRY_TARBALL_ORIGIN}/ (got ${url})`,
    );
  }
};

/**
 * Downloads a registry tarball with bounded size and time; throws on any
 * failure (non-2xx, oversize, timeout).
 */
export const downloadTarball = async (
  url,
  { maxBytes = MAX_TARBALL_BYTES, timeoutMs = DOWNLOAD_TIMEOUT_MS, fetchImpl = fetch } = {},
) => {
  assertTarballUrl(url);
  const signal = AbortSignal.timeout(timeoutMs);
  let response;
  try {
    response = await fetchImpl(url, { signal, redirect: "error" });
  } catch (error) {
    throw new Error(`registry tarball download failed for ${url}: ${error.message}`);
  }
  if (!response.ok) {
    throw new Error(`registry tarball download failed for ${url}: HTTP ${response.status}`);
  }
  const declared = Number(response.headers?.get?.("content-length") ?? Number.NaN);
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error(`registry tarball ${url} exceeds the ${maxBytes}-byte download limit`);
  }
  const chunks = [];
  let total = 0;
  try {
    for await (const chunk of response.body) {
      total += chunk.length;
      if (total > maxBytes) {
        throw new Error(`registry tarball ${url} exceeds the ${maxBytes}-byte download limit`);
      }
      chunks.push(Buffer.from(chunk));
    }
  } catch (error) {
    if (/download limit/u.test(error.message)) {
      throw error;
    }
    throw new Error(`registry tarball download failed for ${url}: ${error.message}`);
  }
  return Buffer.concat(chunks);
};

/**
 * Decides whether registry metadata describes the packed tarball. Returns
 * `{ match, method, differences }` — `method` is `integrity` when the
 * recorded integrity is identical, `content` when the registry tarball had to
 * be downloaded and compared. Throws on a download or archive error.
 */
export const verifyPayloadIdentity = async ({ tarball, integrity, tarballUrl, download = downloadTarball }) => {
  const localBytes = Buffer.isBuffer(tarball) ? tarball : readFileSync(tarball);
  if (typeof integrity !== "string" || !integrity.startsWith("sha512-")) {
    throw new Error(`registry integrity must be a sha512- value (got ${integrity})`);
  }
  if (tarballIntegrity(localBytes) === integrity) {
    return { match: true, method: "integrity", differences: [] };
  }
  const remoteBytes = await download(tarballUrl);
  if (tarballIntegrity(remoteBytes) !== integrity) {
    throw new Error(`the downloaded registry tarball does not match the registry's recorded integrity (${tarballUrl})`);
  }
  const differences = compareTarballContents(localBytes, remoteBytes);
  return { match: differences.length === 0, method: "content", differences };
};

const parseArgs = (argv) => {
  const options = { tarball: null, integrity: null, tarballUrl: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--tarball") {
      options.tarball = argv[++index];
    } else if (arg === "--integrity") {
      options.integrity = argv[++index];
    } else if (arg === "--tarball-url") {
      options.tarballUrl = argv[++index];
    } else {
      throw new Error(`unknown argument ${arg}`);
    }
  }
  for (const [flag, value] of [["--tarball", options.tarball], ["--integrity", options.integrity], ["--tarball-url", options.tarballUrl]]) {
    if (!value) {
      throw new Error(`${flag} is required`);
    }
  }
  return options;
};

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  const result = await verifyPayloadIdentity(options);
  if (!result.match) {
    for (const difference of result.differences) {
      console.error(`[npm-package-identity] ${difference}`);
    }
    throw new Error(`the registry payload differs from ${path.basename(options.tarball)}`);
  }
  console.log(
    `[npm-package-identity] registry payload matches ${path.basename(options.tarball)} (${result.method === "integrity" ? "identical integrity" : "content-identical rebuild"})`,
  );
};

const isDirectExecution =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectExecution) {
  try {
    await main();
  } catch (error) {
    console.error(`[npm-package-identity] ${error.message}`);
    process.exit(1);
  }
}
