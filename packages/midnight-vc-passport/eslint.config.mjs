// This file is part of midnightntwrk/midnight-verifiable-credential-digital-passport.
// Copyright (C) Midnight Foundation
// SPDX-License-Identifier: Apache-2.0
// Licensed under the Apache License, Version 2.0 (the "License");
// You may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import js from '@eslint/js';
import plugin from '@typescript-eslint/eslint-plugin';
import parser from '@typescript-eslint/parser';
import pluginImport from 'eslint-plugin-import';
import pluginPrettier from 'eslint-plugin-prettier';
import pluginSimpleImportSort from 'eslint-plugin-simple-import-sort';

export default [
  {
    ignores: ['./node_modules/**', './dist/**', './build/**', './src/managed/**'],
  },
  js.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        project: ['./tsconfig.json'],
      },
    },
    plugins: {
      '@typescript-eslint': plugin,
      prettier: pluginPrettier,
      import: pluginImport,
      'simple-import-sort': pluginSimpleImportSort,
    },
    rules: {
      'prettier/prettier': 'error',
      'no-unused-vars': 'off',
      // `import/no-unused-modules` enumerates files independently of flat-config
      // ignores. Under ESLint 9 flat config it cannot initialize on its own, so
      // a minimal legacy `.eslintrc.json` ({}) is kept in this package purely as
      // the upstream-recommended workaround (eslint-plugin-import#3079). ESLint 9
      // resolves config from this file; the eslintrc is never used for config.
      'import/no-unused-modules': [1, { unusedExports: true }],
      'no-duplicate-imports': 'error',
      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'error',
      // Dependency boundary: the generic compact-value codec is inlined into
      // this package (see design D2). Importing the monorepo's openid transport
      // package is forbidden — the family must not depend on protocol transport.
      'no-restricted-imports': [
        'error',
        {
          paths: ['@midnight-ntwrk/midnight-did-credentials-openid'],
        },
      ],
    },
  },
];
