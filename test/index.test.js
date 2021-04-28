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
const proxyquire = require('proxyquire');

const { Response } = require('@adobe/helix-fetch');
const { condit } = require('@adobe/helix-testutils');

const { main: universalMain } = require('../src/index.js');
const { AWSStorage } = require('../src/storage.js');
const { retrofit } = require('./utils.js');

const SPEC_ROOT = resolve(__dirname, 'specs');

class AWSStorageMock extends AWSStorage {
  // eslint-disable-next-line class-methods-use-this
  async store() {}
}

const { main: proxyMain } = proxyquire('../src/index.js', {
  './storage.js': {
    AWSStorage: AWSStorageMock,
  },
  './content-proxy.js': {
    contentProxy: async ({ path }) => {
      const fsPath = resolve(SPEC_ROOT, basename(path));
      if (fs.existsSync(fsPath)) {
        const body = fs.readFileSync(fsPath, 'utf-8');
        return new Response(body, { status: 200 });
      }
      return new Response(`File not found: ${fsPath}`, { status: 404 });
    },
  },
});

describe('Index Tests', () => {
  before(async () => {
    nock('https://raw.githubusercontent.com')
      .get((uri) => uri.startsWith('/foo/bar/baz'))
      .reply((uri) => {
        const fsPath = resolve(SPEC_ROOT, basename(uri));
        if (!fs.existsSync(fsPath)) {
          return [404, `File not found: ${fsPath}`];
        }
        return [200, fs.readFileSync(fsPath, 'utf-8')];
      })
      .persist();
  });

  it('index function returns 400 if path is missing', async () => {
    const main = retrofit(proxyMain);
    const res = await main({
      owner: 'foo',
      repo: 'bar',
      ref: 'baz',
    });
    assert.strictEqual(res.statusCode, 400);
    assert.match(res.body, /required/);
  });

  it('index function returns 400 if no mountpoint matches path', async () => {
    const main = retrofit(proxyMain);
    const res = await main({
      owner: 'foo',
      repo: 'bar',
      ref: 'baz',
      path: '/outside/page.html',
    });
    assert.strictEqual(res.statusCode, 400);
    assert.match(res.body, /not mounted/);
  });

  it('call index function with missing env', async () => {
    const main = retrofit(proxyMain);
    const res = await main({
      owner: 'foo',
      repo: 'bar',
      ref: 'baz',
      path: '/mnt/example-post.md',
    }, {});
    assert.strictEqual(res.statusCode, 500);
  });

  it('call index function with an existing path', async () => {
    const main = retrofit(proxyMain);
    const res = await main({
      owner: 'foo',
      repo: 'bar',
      ref: 'baz',
      path: '/mnt/example-post.md',
    }, {
      AWS_REGION: 'foo',
      AWS_ACCESS_KEY_ID: 'bar',
      AWS_SECRET_ACCESS_KEY: 'baz',
    });
    assert.strictEqual(res.statusCode, 200);
  });

  it('call index function with an non-existing path', async () => {
    const main = retrofit(proxyMain);
    const res = await main({
      owner: 'foo',
      repo: 'bar',
      ref: 'baz',
      path: '/mnt/missing.md',
    }, {
      AWS_REGION: 'foo',
      AWS_ACCESS_KEY_ID: 'bar',
      AWS_SECRET_ACCESS_KEY: 'baz',
    });
    assert.strictEqual(res.statusCode, 404);
  });

  condit('live invocation', condit.hasenvs(['AWS_REGION', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY']), async () => {
    const main = retrofit(universalMain);
    const params = {
      owner: 'adobe',
      repo: 'theblog',
      ref: 'master',
      path: '/en/publish/2020/11/02/high-tech-companies-can-deliver-successful-cx-with-ml-real-time-data.md',
    };
    const res = await retrofit(main(params));
    assert.strictEqual(res.statusCode, 200);
  }).timeout(20000);
});
