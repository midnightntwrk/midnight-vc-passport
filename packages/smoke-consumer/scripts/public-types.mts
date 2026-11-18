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

import { encodeDigitalPassportCredential } from '@midnight-ntwrk/midnight-vc-passport';
import { encodeDigitalPassportProof } from '@midnight-ntwrk/midnight-vc-passport/codecs';
import { Contract, type DigitalPassportCredential } from '@midnight-ntwrk/midnight-vc-passport/contract';
import {
  circuitSignatures,
  declaredInterfaces,
  expectedVk,
  type Circuits,
  type Proof,
} from '@midnight-ntwrk/midnight-vc-passport/managed/digital-passport-credential/contract/index.js';
import { createDigitalPassportProtocolFixture } from '@midnight-ntwrk/midnight-vc-passport/testing';

const { credential, credentialProof } = createDigitalPassportProtocolFixture();
const typedCredential: DigitalPassportCredential = credential;
const typedProof: Proof = credentialProof;
export const wire = [encodeDigitalPassportCredential(typedCredential), encodeDigitalPassportProof(typedProof)];
export const metadata = { circuitSignatures, declaredInterfaces, expectedVk };

// Check the generated contextual call shape without relying on a type cast.
type PromiseResult<T extends Promise<unknown>> = Awaited<T>;
export type ContextualResult = PromiseResult<ReturnType<Circuits<undefined>['issuanceContextTag']>>;
export const contract: Contract<undefined> = new Contract({});
