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
const { Response } = require('@adobe/helix-universal');

const { AWSStorage } = proxyquire('../src/storage.js', {
  '@aws-sdk/client-s3': {
    S3Client: class {
      constructor({ region }) {
        this._region = region;
      }

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
    assert.throws(() => new AWSStorage({
      AWS_S3_REGION: 'foo',
    }), /required/);
    assert.throws(() => new AWSStorage({
      AWS_S3_REGION: 'foo',
      AWS_S3_ACCESS_KEY_ID: 'bar',
    }), /required/);
  });
  it('store item to non existing bucket with missing template bucket', async () => {
    const storage = new AWSStorage({
      AWS_S3_REGION: 'foo',
      AWS_S3_ACCESS_KEY_ID: 'bar',
      AWS_S3_SECRET_ACCESS_KEY: 'baz',
      mount: { url: 'mymount' },
    });
    storage.client.storage = new Map();

    await assert.rejects(() => storage.store(
      'live', '/path', new Response('body', { status: 200 }),
    ));
  });
  it('store 2 items to non existing bucket', async () => {
    const storage = new AWSStorage({
      AWS_S3_REGION: 'foo',
      AWS_S3_ACCESS_KEY_ID: 'bar',
      AWS_S3_SECRET_ACCESS_KEY: 'baz',
      mount: { url: 'mymount' },
    });
    const memStorage = new Map();
    memStorage.set('helix-content-bus-template', []);
    storage.client.storage = memStorage;

    await assert.doesNotReject(() => storage.store(
      'live', '/path', new Response('body', { status: 200 }),
    ));
    await assert.doesNotReject(() => storage.store(
      'live', '/path2', new Response('body', { status: 200 }),
    ));
  });

  it('store item to existing bucket', async () => {
    const storage = new AWSStorage({
      AWS_S3_REGION: 'foo',
      AWS_S3_ACCESS_KEY_ID: 'bar',
      AWS_S3_SECRET_ACCESS_KEY: 'baz',
      mount: { url: 'mymount2' },
    });
    const memStorage = new Map();
    memStorage.set('h3c4fbb7d701e130329d716baabc51d95ef3a9fb6bbc2df1f469caf2150fd', []);
    storage.client.storage = memStorage;

    await assert.doesNotReject(() => storage.store(
      'live', '/path', new Response('body', { status: 200 }),
    ));
  });
});
