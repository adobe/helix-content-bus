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
/* eslint-disable max-classes-per-file */

'use strict';

process.env.HELIX_FETCH_FORCE_HTTP1 = 'true';

const assert = require('assert');
const proxyquire = require('proxyquire');

const { MountConfig } = require('@adobe/helix-shared-config');
const { condit } = require('@adobe/helix-testutils');
const { Response } = require('@adobe/helix-universal');

const { AWSStorage } = require('../src/storage.js');

const { AWSStorage: AWSStorageProxy } = proxyquire('../src/storage.js', {
  '@aws-sdk/client-s3': {
    S3Client: class {
      // eslint-disable-next-line class-methods-use-this
      send(command) {
        return command.run(this._storage);
      }

      set storage(s) {
        this._storage = s;
      }
    },
    HeadBucketCommand: class {
      constructor({ Bucket }) {
        this._bucket = Bucket;
      }

      run(storage) {
        if (storage.get(this._bucket)) {
          return { $metadata: { httpStatusCode: 200 } };
        }
        const e = new Error();
        e.$metadata = { httpStatusCode: 404 };
        throw e;
      }
    },
    CreateBucketCommand: class {
      constructor({ Bucket }) {
        this._bucket = Bucket;
      }

      run(storage) {
        if (storage.get(this._bucket)) {
          const e = new Error();
          e.$metadata = { httpStatusCode: 409 };
          throw e;
        }
        storage.set(this._bucket, []);
        return { $metadata: { httpStatusCode: 200 } };
      }
    },
    GetObjectCommand: class {
      constructor({ Key, Bucket }) {
        this._key = Key;
        this._bucket = Bucket;
      }

      run(storage) {
        const objs = storage.get(this._bucket);
        if (!objs) {
          const e = new Error();
          e.$metadata = { httpStatusCode: 404 };
          throw e;
        }
        return objs.find((obj) => obj === this._key);
      }
    },

    PutObjectCommand: class {
      constructor({ Key, Bucket }) {
        this._key = Key;
        this._bucket = Bucket;
      }

      run(storage) {
        const objs = storage.get(this._bucket);
        if (!objs) {
          const e = new Error();
          e.$metadata = { httpStatusCode: 404 };
          throw e;
        }
        objs.push(this._key);
      }
    },
    GetBucketTaggingCommand: class {
      constructor({ Bucket }) {
        this._bucket = Bucket;
      }

      run(storage) {
        if (storage.get(this._bucket)) {
          return { TagSet: [] };
        }
        const e = new Error();
        e.$metadata = { httpStatusCode: 404 };
        throw e;
      }
    },
    PutBucketTaggingCommand: class {
      // eslint-disable-next-line class-methods-use-this
      run() {
        /* do nothing */
      }
    },
    PutPublicAccessBlockCommand: class {
      // eslint-disable-next-line class-methods-use-this
      run() {
        /* do nothing */
      }
    },
  },
});

describe('Storage Tests', () => {
  it('constructor throws if required parameters are missing', async () => {
    assert.throws(() => new AWSStorage({}), /required/);
  });
  it('constructor succeeds if required parameters are there', async () => {
    assert.doesNotThrow(() => new AWSStorage({
      bucket: 'bloop',
    }));
  });
  it('store item to non existing bucket with missing template bucket', async () => {
    const storage = new AWSStorageProxy({
      AWS_S3_REGION: 'foo',
      AWS_S3_ACCESS_KEY_ID: 'bar',
      AWS_S3_SECRET_ACCESS_KEY: 'baz',
      bucket: 'bloop',
    });
    storage.client.storage = new Map();

    await assert.rejects(() => storage.store(
      'live/path', new Response('body', { status: 200 }),
    ));
  });
  it('store 2 items to non existing bucket', async () => {
    const storage = new AWSStorageProxy({
      AWS_S3_REGION: 'foo',
      AWS_S3_ACCESS_KEY_ID: 'bar',
      AWS_S3_SECRET_ACCESS_KEY: 'baz',
      bucket: 'bloop',
    });
    const memStorage = new Map();
    memStorage.set('helix-content-bus-template', []);
    storage.client.storage = memStorage;

    await assert.doesNotReject(() => storage.store(
      'live/path', new Response('body', {
        status: 200,
        headers: { 'last-modified': 'Tue, 20 Apr 2021 23:51:03 GMT' },
      }),
    ));
    await assert.doesNotReject(() => storage.store(
      'live/path2', new Response('body', { status: 200 }),
    ));
  });

  it('store item to existing bucket', async () => {
    const storage = new AWSStorageProxy({
      AWS_S3_REGION: 'foo',
      AWS_S3_ACCESS_KEY_ID: 'bar',
      AWS_S3_SECRET_ACCESS_KEY: 'baz',
      bucket: 'bloop',
    });
    const memStorage = new Map();
    memStorage.set('bloop', []);
    storage.client.storage = memStorage;

    await assert.doesNotReject(() => storage.store(
      'live/path', new Response('body', { status: 200 }),
    ));
    await assert.doesNotReject(() => storage.load(
      'live/path',
    ));
  });
  it('load existing item from read-only storage', async () => {
    const storage = new AWSStorageProxy({
      AWS_S3_REGION: 'foo',
      AWS_S3_ACCESS_KEY_ID: 'bar',
      AWS_S3_SECRET_ACCESS_KEY: 'baz',
      bucket: 'bloop',
      readOnly: true,
    });
    const memStorage = new Map();
    memStorage.set('bloop', ['live/path']);
    storage.client.storage = memStorage;

    await assert.doesNotReject(() => storage.load(
      'live/path',
    ));
  });

  it('load missing item from read-only storage', async () => {
    const storage = new AWSStorageProxy({
      AWS_S3_REGION: 'foo',
      AWS_S3_ACCESS_KEY_ID: 'bar',
      AWS_S3_SECRET_ACCESS_KEY: 'baz',
      bucket: 'bloop',
      readOnly: true,
    });
    const memStorage = new Map();
    storage.client.storage = memStorage;

    assert.strictEqual(await storage.load('live/path'), null);
  });

  it('store item to read-only storage', async () => {
    const storage = new AWSStorageProxy({
      AWS_S3_REGION: 'foo',
      AWS_S3_ACCESS_KEY_ID: 'bar',
      AWS_S3_SECRET_ACCESS_KEY: 'baz',
      bucket: 'bloop',
      readOnly: true,
    });
    await assert.rejects(() => storage.store(
      'live/path', new Response('body', { status: 200 }),
    ));
  });
});

describe('Live Storage Tests', () => {
  condit('Read from code bus', condit.hasenvs(['AWS_S3_REGION', 'AWS_S3_ACCESS_KEY_ID', 'AWS_S3_SECRET_ACCESS_KEY']), async () => {
    const storage = new AWSStorage({
      AWS_S3_REGION: process.env.AWS_S3_REGION,
      AWS_S3_ACCESS_KEY_ID: process.env.AWS_S3_ACCESS_KEY_ID,
      AWS_S3_SECRET_ACCESS_KEY: process.env.AWS_S3_SECRET_ACCESS_KEY,
      bucket: 'helix-code-bus',
      readOnly: true,
    });
    try {
      const res = await storage.load('adobe/spark-website/main/fstab.yam');
      const fstab = await new MountConfig().withSource(await res.text()).init();
      assert.notStrictEqual(fstab, null);
    } catch (e) {
      console.log(e);
    }
  }).timeout(20000);
});
