/*
 * Copyright 2019 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

/* eslint-env mocha */

const assert = require('assert');
const proxyquire = require('proxyquire');

const { retrofit } = require('./utils.js');

/**
 * Proxy our action and its requirements.
 *
 * @param {Function} invoke OW action to invoke
 */
const { main: universalMain } = proxyquire('../src/index.js', {
  './content-proxy.js': { contentProxy: async (opts) => opts },
});

const main = retrofit(universalMain);

describe('Index Tests', () => {
  it('index function returns 400 if owner/repo/ref/path is missing', async () => {
    assert.strictEqual((await main({})).statusCode, 400);
    assert.strictEqual((await main({
      owner: 'foo',
    })).statusCode, 400);
    assert.strictEqual((await main({
      owner: 'foo',
      repo: 'bar',
    })).statusCode, 400);
    assert.strictEqual((await main({
      owner: 'foo',
      repo: 'bar',
      ref: 'baz',
    })).statusCode, 400);
  });
});
