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
        storage.set(this._bucket, new Map());
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
        const obj = objs.get(this._key);
        if (!obj) {
          const e = new Error();
          e.$metadata = { httpStatusCode: 404 };
          throw e;
        }
        return obj;
      }
    },
    HeadObjectCommand: class {
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
        const obj = objs.get(this._key);
        if (!obj) {
          const e = new Error();
          e.$metadata = { httpStatusCode: 404 };
          throw e;
        }
        return obj;
      }
    },
    PutObjectCommand: class {
      constructor({
        Bucket, Key, Body, ContentEncoding, Metadata,
      }) {
        this._bucket = Bucket;
        this._key = Key;
        this._body = Body;
        this._encoding = ContentEncoding;
        this._metadata = Metadata;
      }

      run(storage) {
        const objs = storage.get(this._bucket);
        if (!objs) {
          const e = new Error();
          e.$metadata = { httpStatusCode: 404 };
          throw e;
        }
        objs.set(this._key, {
          Body: this._body,
          ContentEncoding: this._encoding,
          Metadata: this._metadata,
        });
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
    CopyObjectCommand: class {
      constructor({
        Bucket, Key, CopySource,
      }) {
        this._bucket = Bucket;
        this._key = Key;
        this._copySource = CopySource;
      }

      run(storage) {
        const src = this._copySource.split('/').slice(1).join('/');
        const objs = storage.get(this._bucket);
        if (!objs) {
          const e = new Error();
          e.$metadata = { httpStatusCode: 404 };
          throw e;
        }
        const obj = objs.get(src);
        if (!obj) {
          const e = new Error('source does not exist');
          e.$metadata = { httpStatusCode: 404 };
          throw e;
        }
        objs.set(this._key, obj);
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
    memStorage.set('bloop', new Map());
    storage.client.storage = memStorage;

    await storage.store('live/path', new Response('body', {
      status: 200,
      headers: {
        'last-modified': 'Fri, 07 May 2021 18:03:19 GMT',
        'x-source-location': 'there',
      },
    }));
    const buf = await storage.load('live/path');
    assert.strictEqual(buf.toString(), 'body');
    const metadata = await storage.metadata('live/path');
    assert.strictEqual(metadata['x-source-last-modified'], 'Fri, 07 May 2021 18:03:19 GMT');
  });

  it('store returns errors correctly', async () => {
    const storage = new AWSStorageProxy({
      AWS_S3_REGION: 'foo',
      AWS_S3_ACCESS_KEY_ID: 'bar',
      AWS_S3_SECRET_ACCESS_KEY: 'baz',
      bucket: 'bloop',
    });
    const memStorage = new Map();
    memStorage.set('bloop', {
      set: () => {
        const e = new Error('access denied');
        e.$metadata = { httpStatusCode: 403 };
        throw e;
      },
    });
    storage.client.storage = memStorage;
    await assert.rejects(async () => storage.store(
      'live/path', new Response('body', {
        status: 200,
      }),
    ), { message: 'access denied' });
  });

  it('load existing item from read-only storage', async () => {
    const storage = new AWSStorageProxy({
      AWS_S3_REGION: 'foo',
      AWS_S3_ACCESS_KEY_ID: 'bar',
      AWS_S3_SECRET_ACCESS_KEY: 'baz',
      bucket: 'bloop',
      readOnly: true,
    });
    const bucket = new Map();
    bucket.set('live/path', { Body: 'body' });
    const memStorage = new Map();
    memStorage.set('bloop', bucket);
    storage.client.storage = memStorage;

    const buf = await storage.load('live/path');
    assert.strictEqual(buf.toString(), 'body');
  });

  it('load existing item\'s metadata from read-only storage', async () => {
    const storage = new AWSStorageProxy({
      AWS_S3_REGION: 'foo',
      AWS_S3_ACCESS_KEY_ID: 'bar',
      AWS_S3_SECRET_ACCESS_KEY: 'baz',
      bucket: 'bloop',
      readOnly: true,
    });
    const bucket = new Map();
    bucket.set('live/path', { Metadata: { 'last-modified': 'Fri, 07 May 2021 18:03:19 GMT' } });
    const memStorage = new Map();
    memStorage.set('bloop', bucket);
    storage.client.storage = memStorage;

    assert.notStrictEqual(await storage.metadata('live/path'), null);
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

  it('load missing item\'s metadata from read-only storage', async () => {
    const storage = new AWSStorageProxy({
      AWS_S3_REGION: 'foo',
      AWS_S3_ACCESS_KEY_ID: 'bar',
      AWS_S3_SECRET_ACCESS_KEY: 'baz',
      bucket: 'bloop',
      readOnly: true,
    });
    const memStorage = new Map();
    storage.client.storage = memStorage;

    assert.strictEqual(await storage.metadata('live/path'), null);
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

  it('copy existing item', async () => {
    const storage = new AWSStorageProxy({
      AWS_S3_REGION: 'foo',
      AWS_S3_ACCESS_KEY_ID: 'bar',
      AWS_S3_SECRET_ACCESS_KEY: 'baz',
      bucket: 'bloop',
    });
    const bucket = new Map();
    bucket.set('preview/path', { Body: 'body' });
    const memStorage = new Map();
    memStorage.set('bloop', bucket);
    storage.client.storage = memStorage;

    await storage.copy('preview/path', 'live/path');
    assert.notStrictEqual(bucket.get('live/path'), null);
  });

  it('copy non-existing item', async () => {
    const storage = new AWSStorageProxy({
      AWS_S3_REGION: 'foo',
      AWS_S3_ACCESS_KEY_ID: 'bar',
      AWS_S3_SECRET_ACCESS_KEY: 'baz',
      bucket: 'bloop',
    });
    const bucket = new Map();
    const memStorage = new Map();
    memStorage.set('bloop', bucket);
    storage.client.storage = memStorage;

    await assert.rejects(async () => storage.copy(
      'preview/path', 'live/path',
    ), { message: 'source does not exist' });
  });

  it('copy item to read-only storage', async () => {
    const storage = new AWSStorageProxy({
      AWS_S3_REGION: 'foo',
      AWS_S3_ACCESS_KEY_ID: 'bar',
      AWS_S3_SECRET_ACCESS_KEY: 'baz',
      bucket: 'bloop',
      readOnly: true,
    });
    await assert.rejects(() => storage.copy(
      'preview/path', 'live/path',
    ));
  });
});

describe.skip('Live Storage Tests', () => {
  condit('Read from code bus', condit.hasenvs(['AWS_S3_REGION', 'AWS_S3_ACCESS_KEY_ID', 'AWS_S3_SECRET_ACCESS_KEY']), async () => {
    const storage = new AWSStorage({
      AWS_S3_REGION: process.env.AWS_S3_REGION,
      AWS_S3_ACCESS_KEY_ID: process.env.AWS_S3_ACCESS_KEY_ID,
      AWS_S3_SECRET_ACCESS_KEY: process.env.AWS_S3_SECRET_ACCESS_KEY,
      bucket: 'helix-code-bus',
      readOnly: true,
    });
    const buf = await storage.load('adobe/spark-website/main/fstab.yaml');
    assert.notStrictEqual(buf, null);
  }).timeout(20000);
  condit('Read metadata from content bus', condit.hasenvs(['AWS_S3_REGION', 'AWS_S3_ACCESS_KEY_ID', 'AWS_S3_SECRET_ACCESS_KEY']), async () => {
    const storage = new AWSStorage({
      AWS_S3_REGION: process.env.AWS_S3_REGION,
      AWS_S3_ACCESS_KEY_ID: process.env.AWS_S3_ACCESS_KEY_ID,
      AWS_S3_SECRET_ACCESS_KEY: process.env.AWS_S3_SECRET_ACCESS_KEY,
      bucket: 'h3b65dd98f8856eb616d04a58e04fe37077b50caa3174eae30f166dc4ff3f',
      readOnly: true,
    });
    const { 'last-modified': lastModified } = await storage.metadata('live/express/create/advertisement/cyber-monday.md');
    assert.notStrictEqual(lastModified, null);
  }).timeout(20000);
  condit('Copy object in content bus', condit.hasenvs(['AWS_S3_REGION', 'AWS_S3_ACCESS_KEY_ID', 'AWS_S3_SECRET_ACCESS_KEY']), async () => {
    const storage = new AWSStorage({
      AWS_S3_REGION: process.env.AWS_S3_REGION,
      AWS_S3_ACCESS_KEY_ID: process.env.AWS_S3_ACCESS_KEY_ID,
      AWS_S3_SECRET_ACCESS_KEY: process.env.AWS_S3_SECRET_ACCESS_KEY,
      bucket: 'h3b65dd98f8856eb616d04a58e04fe37077b50caa3174eae30f166dc4ff3f',
    });
    await assert.rejects(async () => storage.copy(
      'preview/express/create/advertisement/cyber-monday.m',
      'live/express/create/advertisement/cyber-monday.m',
    ));
  }).timeout(20000);
});
