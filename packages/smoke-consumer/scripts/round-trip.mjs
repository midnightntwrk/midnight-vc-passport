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

import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';

import * as root from '@midnight-ntwrk/midnight-verifiable-credential-digital-passport';
import * as codecs from '@midnight-ntwrk/midnight-verifiable-credential-digital-passport/codecs';
import * as contract from '@midnight-ntwrk/midnight-verifiable-credential-digital-passport/contract';
import * as testing from '@midnight-ntwrk/midnight-verifiable-credential-digital-passport/testing';

// The pure circuits derive on-chain identifiers from the active network id; the
// undeployed id matches the local/off-chain simulation used by the ported suite.
setNetworkId('undeployed');

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
check('./contract exports the pure circuits', typeof contract.pureCircuits === 'object');
check(
  './testing exports the protocol fixture builder',
  typeof testing.createDigitalPassportProtocolFixture === 'function',
);

// 2. Issuance / presentation / verification flow through the pure circuits.
const fixture = testing.createDigitalPassportProtocolFixture();
const { pureCircuits } = root;

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
assert.deepEqual(
  new Uint8Array(decodedCredential.claimRoot),
  new Uint8Array(fixture.credential.claimRoot),
);
assert.deepEqual(
  new Uint8Array(decodedCredential.schema.packageId),
  new Uint8Array(fixture.credential.schema.packageId),
);
assert.deepEqual(
  new Uint8Array(decodedCredential.schema.schemaId),
  new Uint8Array(fixture.credential.schema.schemaId),
);
check('credential encodes to compact-value-v1.base64url and decodes back faithfully');

const encodedProof = codecs.encodeDigitalPassportProof(fixture.credentialProof);
const decodedProof = codecs.decodeDigitalPassportProof(encodedProof);
assert.deepEqual(
  new Uint8Array(decodedProof.challengeHash),
  new Uint8Array(fixture.credentialProof.challengeHash),
);
check('proof encodes and decodes back faithfully');

console.log(
  '\nSMOKE OK: every public entry point imported; issuance/presentation/verification and codec round-trips succeeded.',
);
