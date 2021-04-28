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

'use strict';

process.env.HELIX_FETCH_FORCE_HTTP1 = 'true';

const assert = require('assert');
const fs = require('fs');
const nock = require('nock');
const { basename, resolve } = require('path');
const { URLSearchParams } = require('url');

const { contentProxy } = require('../src/content-proxy.js');

const SPEC_ROOT = resolve(__dirname, 'specs');

describe('Content Proxy Tests', () => {
  before(async () => {
    nock('https://adobeioruntime.net')
      .get((uri) => uri.startsWith('/api/v1/web/helix'))
      .reply((uri) => {
        const pathParam = new URLSearchParams(uri.substr(uri.indexOf('?') + 1)).get('path');
        if (pathParam) {
          const path = resolve(SPEC_ROOT, basename(pathParam));
          if (fs.existsSync(path)) {
            return [200, fs.readFileSync(path, 'utf-8')];
          }
        }
        return [404, `File not found: ${pathParam}`];
      })
      .persist();
  });
  const resolver = {
    createURL({ pkg, name, version }) {
      return new URL(`https://adobeioruntime.net/api/v1/web/helix/${pkg}/${name}@${version}`);
    },
  };
  it('Content-Proxy should return existing document', async () => {
    const params = {
      owner: 'foo',
      repo: 'bar',
      ref: 'baz',
      path: '/example-post.md',
      log: console,
      options: { },
      resolver,
    };
    const res = await contentProxy(params);
    assert.strictEqual(res.status, 200);
  });
  it('Content-Proxy should return 404 for missing document', async () => {
    const params = {
      owner: 'foo',
      repo: 'bar',
      ref: 'baz',
      path: '/missing.md',
      log: console,
      options: { requestId: '1234' },
      resolver,
    };
    const res = await contentProxy(params);
    assert.strictEqual(res.status, 404);
  });
});
