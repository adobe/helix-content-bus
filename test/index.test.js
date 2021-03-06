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
/* eslint-disable class-methods-use-this, no-param-reassign */

'use strict';

process.env.HELIX_FETCH_FORCE_HTTP1 = 'true';

const assert = require('assert');

const { condit } = require('@adobe/helix-testutils');

const { main } = require('../src/index.js');
const { setupPolly, retrofit } = require('./utils.js');

// require('dotenv').config();

const index = retrofit(main);

describe('Index Tests', () => {
  setupPolly({
    recordIfMissing: true,
    matchRequestsBy: {
      method: true,
      headers: false,
      body: false,
      order: false,
      url: {
        protocol: true,
        username: false,
        password: false,
        hostname: true,
        port: false,
        pathname: true,
        query: true,
        hash: true,
      },
    },
  });

  beforeEach(function swallowSensitive() {
    const { server } = this.polly;
    server.any().on('beforePersist', (_, recording) => {
      recording.request.headers = recording.request.headers.filter(({ name }) => name !== 'authorization');
      delete recording.request.postData;
    });
  });

  const awsCredentials = {
    AWS_S3_REGION: 'us-east-1',
    AWS_S3_ACCESS_KEY_ID: 'foo',
    AWS_S3_SECRET_ACCESS_KEY: 'bar',
  };

  it('returns 400 if path is missing', async () => {
    const res = await index({
      owner: 'adobe',
      repo: 'theblog',
      ref: 'master',
    });
    assert.strictEqual(res.statusCode, 400);
    assert.match(res.headers['x-error'], /required/);
  });

  it('returns 400 if fstab is missing', async function test() {
    const { server } = this.polly;
    server
      .get('https://helix-code-bus.s3.us-east-1.amazonaws.com/tripodsan/helix-test/main/fstab.yaml?x-id=GetObject')
      .intercept((_, res) => res.status(404));
    const res = await index({
      owner: 'tripodsan',
      repo: 'helix-test',
      ref: 'main',
      path: '/word2md-unit-tests/homepage.md',
    }, awsCredentials);
    assert.strictEqual(res.statusCode, 400);
    assert.match(res.headers['x-error'], /fstab.yaml not found/);
  }).timeout(5000);

  it('returns 400 if no mountpoint matches path', async function test() {
    const fstab = `
    mountpoints:
      /outside: https://adobe.sharepoint.com/sites/TheBlog/Shared%20Documents/theblog
    `;

    const { server } = this.polly;
    server
      .get('https://helix-code-bus.s3.us-east-1.amazonaws.com/tripodsan/helix-test/main/fstab.yaml?x-id=GetObject')
      .intercept((_, res) => res.status(200).send(fstab));

    const res = await index({
      owner: 'tripodsan',
      repo: 'helix-test',
      ref: 'main',
      path: '/word2md-unit-tests/homepage.md',
      useLastModified: 'false',
    }, awsCredentials);
    assert.strictEqual(res.statusCode, 400);
    assert.match(res.headers['x-error'], /not mounted/);
  }).timeout(5000);

  it('returns 200 without schnickschnack with an existing path', async () => {
    const res = await index({
      owner: 'tripodsan',
      repo: 'helix-test',
      ref: 'main',
      path: '/word2md-unit-tests/homepage.md',
    }, awsCredentials);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body, '');
  }).timeout(10000);

  it('creates marker files if missing', async function test() {
    const { server } = this.polly;
    server
      .get('https://helix-content-bus.s3.us-east-1.amazonaws.com/d4b1d4ea6d84b0229bce7cf6806b0bb3470489ab8205a13f75cfe518fa7/.hlx.json?x-id=GetObject')
      .intercept((_, res) => res.status(404));

    const res = await index({
      owner: 'tripodsan',
      repo: 'helix-test',
      ref: 'main',
      path: '/word2md-unit-tests/homepage.md',
    }, awsCredentials);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body, '');
  }).timeout(10000);

  it('returns 200 when publishing an existing item', async () => {
    const res = await index({
      owner: 'tripodsan',
      repo: 'helix-test',
      ref: 'main',
      path: '/word2md-unit-tests/homepage.md',
      action: 'publish',
    }, awsCredentials, true);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body, '');
  }).timeout(5000);

  it('returns 304 with an existing item that did not change', async () => {
    const res = await index({
      owner: 'tripodsan',
      repo: 'helix-test',
      ref: 'main',
      path: '/word2md-unit-tests/homepage.md',
      prefix: 'preview',
      useLastModified: true,
    }, awsCredentials, true);
    assert.strictEqual(res.statusCode, 304);
  }).timeout(5000);

  it('returns 200 with an item that wasn\'t available in S3', async function test() {
    const { server } = this.polly;
    server
      .head('https://helix-content-bus.s3.us-east-1.amazonaws.com/d4b1d4ea6d84b0229bce7cf6806b0bb3470489ab8205a13f75cfe518fa7/preview/word2md-unit-tests/homepage.md')
      .intercept((_, res) => res.status(404));

    const res = await index({
      owner: 'tripodsan',
      repo: 'helix-test',
      ref: 'main',
      path: '/word2md-unit-tests/homepage.md',
      prefix: 'preview',
      useLastModified: true,
    }, awsCredentials, true);
    assert.strictEqual(res.statusCode, 200);
  }).timeout(5000);

  it('returns 404 with a non-existing path', async () => {
    const res = await index({
      owner: 'tripodsan',
      repo: 'helix-test',
      ref: 'main',
      path: '/non-existing/homepage.md',
    }, awsCredentials, true);
    assert.strictEqual(res.statusCode, 404);
  }).timeout(5000);

  it('returns 400 for a unknown action', async () => {
    const res = await index({
      owner: 'tripodsan',
      repo: 'helix-test',
      ref: 'main',
      path: '/word2md-unit-tests/homepage.md',
      action: 'energize',
    }, awsCredentials);
    assert.strictEqual(res.statusCode, 400);
  }).timeout(5000);

  it('returns 404 when copying a missing item', async () => {
    const res = await index({
      owner: 'tripodsan',
      repo: 'helix-test',
      ref: 'main',
      path: '/nonexisting/homepage.md',
      action: 'publish',
    }, awsCredentials, true);
    assert.strictEqual(res.statusCode, 404);
  }).timeout(5000);
});

describe.skip('Live Index Tests', () => {
  condit('Store theblog', condit.hasenvs(['AWS_S3_REGION', 'AWS_S3_ACCESS_KEY_ID', 'AWS_S3_SECRET_ACCESS_KEY']), async () => {
    const res = await index({
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
    const res = await index({
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
  condit('Publish spark-website', condit.hasenvs(['AWS_S3_REGION', 'AWS_S3_ACCESS_KEY_ID', 'AWS_S3_SECRET_ACCESS_KEY']), async () => {
    const res = await index({
      owner: 'adobe',
      repo: 'spark-website',
      ref: 'main',
      path: '/express/create/advertisement/cyber-monday.m',
      action: 'publish',
    }, {
      AWS_S3_REGION: process.env.AWS_S3_REGION,
      AWS_S3_ACCESS_KEY_ID: process.env.AWS_S3_ACCESS_KEY_ID,
      AWS_S3_SECRET_ACCESS_KEY: process.env.AWS_S3_SECRET_ACCESS_KEY,
    });
    assert.strictEqual(res.statusCode, 500);
  }).timeout(20000);
});
