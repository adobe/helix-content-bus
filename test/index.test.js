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
/* eslint-disable class-methods-use-this */

'use strict';

process.env.HELIX_FETCH_FORCE_HTTP1 = 'true';

const assert = require('assert');
const fs = require('fs');
const { basename, resolve } = require('path');
const proxyquire = require('proxyquire');

const { Response } = require('@adobe/helix-fetch');
const { condit } = require('@adobe/helix-testutils');

const { main: universalMain } = require('../src/index.js');
const { AWSStorage } = require('../src/storage.js');
const { retrofit } = require('./utils.js');

const SPEC_ROOT = resolve(__dirname, 'specs');

class AWSStorageMock extends AWSStorage {
  async load(key) {
    if (key.startsWith('foo/bar/baz/')) {
      const fsPath = resolve(SPEC_ROOT, basename(key));
      if (fs.existsSync(fsPath)) {
        return fs.readFileSync(fsPath, 'utf-8');
      }
    }
    return null;
  }

  async metadata(key) {
    if (key.startsWith('foo/bar/baz/') || key.startsWith('live/mnt/')) {
      const fsPath = resolve(SPEC_ROOT, `${basename(key)}.json`);
      if (fs.existsSync(fsPath)) {
        return JSON.parse(fs.readFileSync(fsPath, 'utf-8'));
      }
    }
    return null;
  }

  async store() {
    return new Response('', {
      status: 200,
    });
  }

  async copy() {
    return new Response('', {
      status: 200,
    });
  }
}

function notModified(path, lastSeen) {
  const metadataPath = resolve(SPEC_ROOT, `${basename(path)}.json`);
  if (fs.existsSync(metadataPath)) {
    const { 'last-modified': lastModified } = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
    const lastSeenMs = Date.parse(lastSeen);
    const lastModifiedMs = Date.parse(lastModified);
    if (lastSeenMs >= lastModifiedMs) {
      return true;
    }
  }
  return false;
}

const { main: proxyMain } = proxyquire('../src/index.js', {
  './storage.js': {
    AWSStorage: AWSStorageMock,
  },
  './content-proxy.js': {
    contentProxy: async ({ path, options }) => {
      if (options.lastModified && notModified(path, options.lastModified)) {
        return new Response('Not modified', { status: 304 });
      }
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
  it('returns 400 if path is missing', async () => {
    const main = retrofit(proxyMain);
    const res = await main({
      owner: 'foo',
      repo: 'bar',
      ref: 'baz',
    });
    assert.strictEqual(res.statusCode, 400);
    assert.match(res.body, /required/);
  });

  it('returns 400 if fstab is missing', async () => {
    const main = retrofit(proxyMain);
    const res = await main({
      owner: 'foo',
      repo: 'bar',
      ref: 'bay',
      path: '/outside/page.html',
    });
    assert.strictEqual(res.statusCode, 400);
    assert.match(res.headers['x-error'], /fstab.yaml not found/);
  });
  it('returns 400 if no mountpoint matches path', async () => {
    const main = retrofit(proxyMain);
    const res = await main({
      owner: 'foo',
      repo: 'bar',
      ref: 'baz',
      path: '/outside/page.html',
      useCDN: 'false',
    });
    assert.strictEqual(res.statusCode, 400);
    assert.match(res.headers['x-error'], /not mounted/);
  });

  it('returns 200 w/o schnickschnack with an existing path', async () => {
    const main = retrofit(proxyMain);
    const res = await main({
      owner: 'foo',
      repo: 'bar',
      ref: 'baz',
      path: '/mnt/example-post.md',
    }, {
      AWS_S3_REGION: 'foo',
      AWS_S3_ACCESS_KEY_ID: 'bar',
      AWS_S3_SECRET_ACCESS_KEY: 'baz',
    }, true);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body, '');
  });

  it('returns 200 when publishing an existing item', async () => {
    const main = retrofit(proxyMain);
    const res = await main({
      owner: 'foo',
      repo: 'bar',
      ref: 'baz',
      path: '/mnt/example-post.md',
      action: 'publish',
    }, {
      AWS_S3_REGION: 'foo',
      AWS_S3_ACCESS_KEY_ID: 'bar',
      AWS_S3_SECRET_ACCESS_KEY: 'baz',
    }, true);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body, '');
  });

  it('returns 304 with an existing item that did not change', async () => {
    const main = retrofit(proxyMain);
    const res = await main({
      owner: 'foo',
      repo: 'bar',
      ref: 'baz',
      path: '/mnt/example-post.md',
      useLastModified: true,
    }, {
      AWS_S3_REGION: 'foo',
      AWS_S3_ACCESS_KEY_ID: 'bar',
      AWS_S3_SECRET_ACCESS_KEY: 'baz',
    }, true);
    assert.strictEqual(res.statusCode, 304);
  });

  it('returns 404 with a non-existing path', async () => {
    const main = retrofit(proxyMain);
    const res = await main({
      owner: 'foo',
      repo: 'bar',
      ref: 'baz',
      path: '/mnt/missing.md',
      useLastModified: true,
    }, {
      AWS_S3_REGION: 'foo',
      AWS_S3_ACCESS_KEY_ID: 'bar',
      AWS_S3_SECRET_ACCESS_KEY: 'baz',
    });
    assert.strictEqual(res.statusCode, 404);
  });

  it('returns 400 for a unknown action', async () => {
    const main = retrofit(proxyMain);
    const res = await main({
      owner: 'foo',
      repo: 'bar',
      ref: 'baz',
      path: '/mnt/missing.md',
      action: 'energize',
    }, {
      AWS_S3_REGION: 'foo',
      AWS_S3_ACCESS_KEY_ID: 'bar',
      AWS_S3_SECRET_ACCESS_KEY: 'baz',
    });
    assert.strictEqual(res.statusCode, 400);
  });
});

describe('Live Index Tests', () => {
  condit('Store theblog', condit.hasenvs(['AWS_S3_REGION', 'AWS_S3_ACCESS_KEY_ID', 'AWS_S3_SECRET_ACCESS_KEY']), async () => {
    const main = retrofit(universalMain);
    const res = await main({
      owner: 'adobe',
      repo: 'theblog',
      ref: 'master',
      path: '/en/publish/2020/11/02/high-tech-companies-can-deliver-successful-cx-with-ml-real-time-data.md',
    }, {
      AWS_S3_REGION: process.env.AWS_S3_REGION,
      AWS_S3_ACCESS_KEY_ID: process.env.AWS_S3_ACCESS_KEY_ID,
      AWS_S3_SECRET_ACCESS_KEY: process.env.AWS_S3_SECRET_ACCESS_KEY,
    });
    assert.strictEqual(res.statusCode, 200);
  }).timeout(20000);
  condit('Store spark-website', condit.hasenvs(['AWS_S3_REGION', 'AWS_S3_ACCESS_KEY_ID', 'AWS_S3_SECRET_ACCESS_KEY']), async () => {
    const main = retrofit(universalMain);
    const res = await main({
      owner: 'adobe',
      repo: 'spark-website',
      ref: 'main',
      path: '/express/create/advertisement/cyber-monday.md',
    }, {
      AWS_S3_REGION: process.env.AWS_S3_REGION,
      AWS_S3_ACCESS_KEY_ID: process.env.AWS_S3_ACCESS_KEY_ID,
      AWS_S3_SECRET_ACCESS_KEY: process.env.AWS_S3_SECRET_ACCESS_KEY,
    });
    assert.strictEqual(res.statusCode, 200);
  }).timeout(20000);
});
