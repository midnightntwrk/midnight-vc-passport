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

// Consumer smoke round-trip. Runs inside an isolated project that installed the
// family package purely from its packed tarball (registry-only transitive
// resolution). It imports EVERY advertised public entry point, then exercises an
// issuance -> presentation -> verification flow through the pure circuits and a
// compact-value wire-format encode/decode round-trip — proving the boundary
// contract (package-distribution: "Consumer consumability evidence") holds.
//
// This is the plain-Node analogue of the ported vitest suite (see
// src/test/protocol.test.ts and src/test/codecs.test.ts); it deliberately uses
// only the package's public surface, never its internals.

import assert from 'node:assert/strict';
import { readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { sep } from 'node:path';
import { pathToFileURL } from 'node:url';

import * as root from '@midnight-ntwrk/midnight-vc-passport';
import * as codecs from '@midnight-ntwrk/midnight-vc-passport/codecs';
import * as contract from '@midnight-ntwrk/midnight-vc-passport/contract';
import * as testing from '@midnight-ntwrk/midnight-vc-passport/testing';
import * as managed from '@midnight-ntwrk/midnight-vc-passport/managed/digital-passport-credential/contract/index.js';

const FAMILY = '@midnight-ntwrk/midnight-vc-passport';
const CORE = '@midnight-ntwrk/credential-compact';
const RUNTIME = '@midnight-ntwrk/compact-runtime';
const resolveHere = createRequire(import.meta.url);
const familyEntry = realpathSync(resolveHere.resolve(FAMILY));
const resolveFamily = createRequire(familyEntry);
const coreEntry = realpathSync(resolveFamily.resolve(CORE));
const resolveCore = createRequire(coreEntry);
const familyRuntime = realpathSync(resolveFamily.resolve(RUNTIME));
const coreRuntime = realpathSync(resolveCore.resolve(RUNTIME));
const installed = realpathSync('node_modules') + sep;
for (const path of [familyEntry, coreEntry, familyRuntime, coreRuntime]) {
  assert.ok(path.startsWith(installed), `not installed in consumer: ${path}`);
}
assert.equal(familyRuntime, coreRuntime);
const runtime = await import(pathToFileURL(familyRuntime).href);
assert.equal(runtime, await import(pathToFileURL(coreRuntime).href));
const runtimeManifest = resolveFamily(`${RUNTIME}/package.json`);
console.log(JSON.stringify({ familyEntry, coreEntry, familyRuntime, coreRuntime, runtime: runtimeManifest.version }));

function check(name, condition = true) {
  if (!condition) {
    throw new Error(`SMOKE FAIL: ${name}`);
  }
  console.log(`  ok  ${name}`);
}

console.log('smoke round-trip: importing every public entry point');

// 1. Every advertised subpath resolves and exposes its documented surface.
check(
  'root entry exports the codecs and the contract module (fixture-free)',
  typeof root.encodeDigitalPassportCredential === 'function' &&
    typeof root.pureCircuits === 'object',
);
check(
  './codecs exports encode/decode helpers for the credential and proof',
  typeof codecs.encodeDigitalPassportCredential === 'function' &&
    typeof codecs.decodeDigitalPassportCredential === 'function' &&
    typeof codecs.encodeDigitalPassportProof === 'function' &&
    typeof codecs.decodeDigitalPassportProof === 'function',
);
assert.strictEqual(contract.pureCircuits, managed.pureCircuits);
assert.strictEqual(root.Contract, managed.Contract);
assert.strictEqual(root.encodeDigitalPassportCredential, codecs.encodeDigitalPassportCredential);
assert.ok(!('createDigitalPassportProtocolFixture' in root));
assert.ok(!('contractReferenceLocations' in managed));
assert.ok('issuanceContextTag' in managed.circuitSignatures);
assert.deepEqual(managed.expectedVk, {});
assert.deepEqual(managed.declaredInterfaces, {});
check('./contract and explicit managed subpath expose the same generated module');
check(
  './testing exports the protocol fixture builder',
  typeof testing.createDigitalPassportProtocolFixture === 'function',
);

// 2. Issuance / presentation / verification flow through the pure circuits.
const fixture = testing.createDigitalPassportProtocolFixture();
const { pureCircuits } = root;

// Exercise a real runtime context locally, not a deployed contract.
const localAddress = '00'.repeat(32);
const generated = new managed.Contract({});
const initial = await generated.initialState(runtime.createConstructorContext(undefined, localAddress));
assert.deepEqual(managed.ledger(initial.currentContractState.data), {});
const context = runtime.createCircuitContext({
  circuitId: 'issuanceContextTag',
  contractAddress: localAddress,
  coinPublicKeyOrZswapState: localAddress,
  contractState: initial.currentContractState,
  privateState: undefined,
  time: 0,
});
const pending = generated.circuits.issuanceContextTag(context);
assert.ok(pending instanceof Promise);
assert.deepEqual((await pending).result, pureCircuits.issuanceContextTag());
check('managed constructor, ledger and Promise-returning contextual circuit');

pureCircuits.assertValidDigitalPassportCredential(fixture.credential, fixture.credentialProof);
pureCircuits.assertValidDigitalPassportPresentation(
  fixture.credential, fixture.credentialProof, fixture.presentation, fixture.presentationProof,
);
pureCircuits.assertDigitalPassportPresentationSatisfiesRequest(
  fixture.credential, fixture.presentationRequest, fixture.presentation, fixture.presentationProof,
);
check('fresh synthetic credential and holder proof verify against the presentation request');

const presentationRequest = pureCircuits.digitalPassportPresentationRequestFromProtocol(
  fixture.verificationRequest,
);
assert.deepEqual(presentationRequest, fixture.presentationRequest);
check('protocol verification request maps to the concrete presentation request');

pureCircuits.assertDigitalPassportIssuanceRequestMatchesOffer(
  fixture.issuanceOffer,
  fixture.issuanceRequest,
);
pureCircuits.assertDigitalPassportIssuanceResultMatchesRequest(
  fixture.issuanceRequest,
  fixture.issuanceResult,
);
check('issuance offer -> request -> result all align');

pureCircuits.assertDigitalPassportVerificationSubmissionMatchesRequest(
  fixture.verificationRequest,
  fixture.verificationSubmission,
);
pureCircuits.assertDigitalPassportVerificationResultMatchesSubmission(
  fixture.verificationSubmission,
  fixture.verificationResult,
);
check('verification request -> submission -> result all align');

// 3. Compact-value wire-format round-trip (design D2 bit-compatibility obligation).
const encodedCredential = codecs.encodeDigitalPassportCredential(fixture.credential);
assert.equal(encodedCredential.encoding, 'compact-value-v1.base64url');
const decodedCredential = codecs.decodeDigitalPassportCredential(encodedCredential);
assert.deepEqual(decodedCredential, fixture.credential);
check('credential encodes to compact-value-v1.base64url and decodes back faithfully');

const encodedProof = codecs.encodeDigitalPassportProof(fixture.credentialProof);
const decodedProof = codecs.decodeDigitalPassportProof(encodedProof);
assert.deepEqual(decodedProof, fixture.credentialProof);
check('proof encodes and decodes back faithfully');

// Do not regenerate these expectations from the candidate. The literal bytes,
// roots and presentation/request values were captured from the published rc5.
const rc5 = JSON.parse(readFileSync(new URL('./rc5-vector.json', import.meta.url), 'utf8'),
  (_key, value) => {
    if (value && typeof value === 'object') {
      if ('bigint' in value) return BigInt(value.bigint);
      if ('hex' in value) return Uint8Array.from(Buffer.from(value.hex, 'hex'));
    }
    return value;
  },
);
const oldCredential = codecs.decodeDigitalPassportCredential(rc5.wire.credential);
const oldIssuanceProof = codecs.decodeDigitalPassportProof(rc5.wire.issuanceProof);
const oldHolderProof = codecs.decodeDigitalPassportProof(rc5.wire.presentationProof);
assert.deepEqual(codecs.encodeDigitalPassportCredential(oldCredential), rc5.wire.credential);
assert.deepEqual(codecs.encodeDigitalPassportProof(oldIssuanceProof), rc5.wire.issuanceProof);
assert.deepEqual(codecs.encodeDigitalPassportProof(oldHolderProof), rc5.wire.presentationProof);
assert.deepEqual(pureCircuits.digitalPassportCredentialBodyRoot(oldCredential), rc5.credentialBodyRoot);
assert.deepEqual(pureCircuits.digitalPassportPresentationBodyRoot(rc5.presentation), rc5.presentationBodyRoot);
pureCircuits.assertValidDigitalPassportCredential(oldCredential, oldIssuanceProof);
pureCircuits.assertValidDigitalPassportPresentation(
  oldCredential, oldIssuanceProof, rc5.presentation, oldHolderProof,
);
pureCircuits.assertDigitalPassportPresentationSatisfiesRequest(
  oldCredential, rc5.presentationRequest, rc5.presentation, oldHolderProof,
);
const corrupt = (proof) => ({ ...proof, signature: { ...proof.signature, s: proof.signature.s + 1n } });
assert.throws(() => pureCircuits.assertValidDigitalPassportCredential(oldCredential, corrupt(oldIssuanceProof)), /signature/i);
assert.throws(() => pureCircuits.assertValidDigitalPassportPresentation(
  oldCredential, oldIssuanceProof, rc5.presentation, corrupt(oldHolderProof),
), /signature/i);
const wrongRequest = { ...rc5.presentationRequest, verifierChallengeHash: new Uint8Array(32).fill(9) };
assert.throws(() => pureCircuits.assertDigitalPassportPresentationSatisfiesRequest(
  oldCredential, wrongRequest, rc5.presentation, oldHolderProof,
), /challenge/i);
const badFrame = Buffer.from(rc5.wire.issuanceProof.payload, 'base64url');
badFrame[0] ^= 1;
assert.throws(() => codecs.decodeDigitalPassportProof({
  ...rc5.wire.issuanceProof, payload: badFrame.toString('base64url'),
}), /magic header/);
check('fixed rc5 wire bytes and credential/presentation proofs carry forward; corrupt proofs, challenge and framing reject');

console.log('\nSMOKE OK: fresh and fixed rc5 off-chain checks passed (not chain proof evidence).');
