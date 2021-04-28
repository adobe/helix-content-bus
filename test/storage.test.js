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
const proxyquire = require('proxyquire');
const { Response } = require('@adobe/helix-universal');

const { AWSStorage } = proxyquire('../src/storage.js', {
  '@aws-sdk/client-s3': {
    S3Client: class {
      constructor({ region }) {
        this._region = region;
      }

      // eslint-disable-next-line class-methods-use-this
      async send(command) {
        return command.input;
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
  it('actual', async () => {
    const storage = new AWSStorage({
      AWS_S3_REGION: 'foo',
      AWS_S3_ACCESS_KEY_ID: 'bar',
      AWS_S3_SECRET_ACCESS_KEY: 'baz',
      mount: { url: 'mymount' },
    });
    await assert.doesNotReject(() => storage.store(
      '/path', new Response('body', { status: 200 }),
    ));
  });
});
