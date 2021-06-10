/*
 * Copyright 2021 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

'use strict';

const { promisify } = require('util');
const zlib = require('zlib');

const {
  S3Client,
  CreateBucketCommand,
  GetBucketTaggingCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutBucketTaggingCommand,
  PutObjectCommand,
  PutPublicAccessBlockCommand,
  HeadObjectCommand,
  CopyObjectCommand,
} = require('@aws-sdk/client-s3');

const { Response } = require('@adobe/helix-fetch');

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

/**
 * Template bucket we use for copying the tags.
 */
const TEMPLATE_BUCKET = 'helix-content-bus-template';

/**
 * Header names that AWS considers system defined.
 */
const AWS_S3_SYSTEM_HEADERS = [
  'cache-control',
  'content-type',
  'expires',
];

/**
 * Response header names that need a different metadata name.
 */
const METADATA_HEADER_MAP = new Map([
  ['last-modified', 'x-source-last-modified'],
]);

/**
 * AWS Storage class
 */
class AWSStorage {
  /*
   * Create an instance
   *
   * @param {object}   opts options
   * @param {string}   opts.AWS_S3_REGION AWS region (optional)
   * @param {string}   opts.AWS_S3_ACCESS_KEY_ID AWS access key (optional)
   * @param {string}   opts.AWS_S3_SECRET_ACCESS_KEY AWS secret access key (optional)
   * @param {string}   opts.bucket S3 bucket id
   * @param {string}   opts.tags tags to add to new buckets
   * @param {object}   opts.readOnly flag indicating whether bucket should never be created
   * @param {object}   opts.log logger
   *
   * @returns AWSStorage instance
   */
  constructor(opts) {
    const {
      AWS_S3_REGION: region,
      AWS_S3_ACCESS_KEY_ID: accessKeyId,
      AWS_S3_SECRET_ACCESS_KEY: secretAccessKey,
      bucket,
      tags = [],
      readOnly = false,
      log = console,
    } = opts;

    if (!bucket) {
      throw new Error('bucket is required.');
    }

    if (region && accessKeyId && secretAccessKey) {
      log.info('Creating S3Client with credentials');
      this._s3 = new S3Client({
        region,
        credentials: {
          accessKeyId,
          secretAccessKey,
        },
      });
    } else {
      log.info('Creating S3Client without credentials');
      this._s3 = new S3Client();
    }
    this._bucket = bucket;
    this._tags = tags;
    this._readOnly = readOnly;
    this._log = log;
  }

  async _bucketExists() {
    try {
      await this.client.send(new HeadBucketCommand({
        Bucket: this._bucket,
      }));
      return true;
    } catch (e) {
      /* istanbul ignore next */
      if (e.$metadata.httpStatusCode !== 404) {
        throw e;
      }
      return false;
    }
  }

  async _bucketCreate() {
    const { log } = this;
    let tags;

    try {
      const result = await this.client.send(new GetBucketTaggingCommand({
        Bucket: TEMPLATE_BUCKET,
      }));
      tags = result.TagSet;
    } catch (e) {
      log.error(`Unable to obtain default tags from template bucket: ${this.bucket}`, e);
      throw e;
    }

    // Create the new bucket
    await this.client.send(new CreateBucketCommand({
      Bucket: this._bucket,
    }));

    // Block public access
    await this.client.send(new PutPublicAccessBlockCommand({
      Bucket: this._bucket,
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        IgnorePublicAcls: true,
        BlockPublicPolicy: true,
        RestrictPublicBuckets: true,
      },
    }));

    // Put required tags
    tags.push(...this._tags);
    await this.client.send(new PutBucketTaggingCommand({
      Bucket: this._bucket,
      Tagging: {
        TagSet: tags,
      },
    }));
    log.info(`Bucket created: ${this.bucket}`);
  }

  async _init() {
    if (this._initialized) {
      return;
    }

    if (!this._readOnly) {
      const exists = await this._bucketExists();
      if (!exists) {
        await this._bucketCreate();
      }
    }
    this._initialized = true;
  }

  /**
   * Return an object contents.
   *
   * @param {string} key object key
   * @returns object contents as a Buffer or null
   */
  async load(key) {
    await this._init();

    const { log } = this;

    const input = {
      Bucket: this.bucket,
      Key: key,
    };

    try {
      const result = await this.client.send(new GetObjectCommand(input));
      log.info(`Object downloaded from: ${this.bucket}/${key}`);

      const buf = await new Response(result.Body, {}).buffer();
      if (result.ContentEncoding === 'gzip') {
        return await gunzip(buf);
      }
      return buf;
    } catch (e) {
      /* istanbul ignore next */
      if (e.$metadata.httpStatusCode !== 404) {
        throw e;
      }
      return null;
    }
  }

  /**
   * Return an object's metadata.
   *
   * @param {string} key object key
   * @returns object metadata or null
   */
  async metadata(key) {
    await this._init();

    const { log } = this;

    const input = {
      Bucket: this.bucket,
      Key: key,
    };

    try {
      const result = await this.client.send(new HeadObjectCommand(input));
      log.info(`Object metadata loaded for: ${this.bucket}/${key}`);
      return result.Metadata;
    } catch (e) {
      /* istanbul ignore next */
      if (e.$metadata.httpStatusCode !== 404) {
        throw e;
      }
      return null;
    }
  }

  /**
   * Store an object contents, along with headers.
   *
   * @param {string} key object key
   * @param {Response} res response to store
   * @returns result obtained from S3
   */
  async store(key, res) {
    if (this._readOnly) {
      throw new Error(`Storage is read-only: ${this._bucket}`);
    }
    await this._init();

    const { log } = this;
    const body = await res.buffer();
    const zipped = await gzip(body);

    const input = {
      Body: zipped,
      Bucket: this.bucket,
      ContentEncoding: 'gzip',
      Metadata: {},
      Key: key,
    };

    Array.from(res.headers.entries()).forEach(([name, value]) => {
      if (AWS_S3_SYSTEM_HEADERS.includes(name)) {
        // system headers are stored in the command itself, e.g.
        // `content-type` header is stored as `ContentType` property
        const property = name.split('-').map((seg) => seg.charAt(0).toUpperCase() + seg.slice(1)).join('');
        input[property] = value;
      } else {
        // use preferred name in metadata if any
        input.Metadata[METADATA_HEADER_MAP.get(name) || name] = value;
      }
    });

    await this.client.send(new PutObjectCommand(input));
    log.info(`Object uploaded to: ${this.bucket}/${key}`);
  }

  /**
   * Copy an object in the same bucket.
   *
   * @param {string} src source key
   * @param {string} dest destination key
   * @returns result obtained from S3
   */
  async copy(src, dest) {
    if (this._readOnly) {
      throw new Error(`Storage is read-only: ${this._bucket}`);
    }
    await this._init();

    const { log } = this;

    const input = {
      Bucket: this.bucket,
      CopySource: `${this.bucket}/${src}`,
      Key: dest,
    };

    try {
      await this.client.send(new CopyObjectCommand(input));
      log.info(`Object copied from ${src} to: ${this.bucket}/${dest}`);
    } catch (e) {
      /* istanbul ignore next */
      if (e.Code !== 'NoSuchKey') {
        throw e;
      }
      const e2 = new Error(`source does not exist: ${src}`);
      e2.status = 404;
      throw e2;
    }
  }

  /**
   * Close this storage. Destroys the S3 client used.
   */
  close() {
    this.client.destroy();
  }

  get client() {
    return this._s3;
  }

  get bucket() {
    return this._bucket;
  }

  get log() {
    return this._log;
  }
}

module.exports = { AWSStorage };
