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

const crypto = require('crypto');
const {
  S3Client,
  CreateBucketCommand,
  GetBucketTaggingCommand,
  HeadBucketCommand,
  PutBucketTaggingCommand,
  PutObjectCommand,
  PutPublicAccessBlockCommand,
} = require('@aws-sdk/client-s3');

/**
 * Template bucket we use for copying the tags.
 */
const TEMPLATE_BUCKET = 'helix-content-bus-template';

/**
 * AWS Storage class
 */
class AWSStorage {
  constructor(opts) {
    const {
      AWS_S3_REGION: region,
      AWS_S3_ACCESS_KEY_ID: accessKeyId,
      AWS_S3_SECRET_ACCESS_KEY: secretAccessKey,
      mount,
      log = console,
    } = opts;

    if (!(region && accessKeyId && secretAccessKey)) {
      throw new Error('AWS_S3_REGION, AWS_S3_ACCESS_KEY_ID and AWS_S3_SECRET_ACCESS_KEY are required.');
    }

    this._s3 = new S3Client({
      region,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });
    const sha256 = crypto
      .createHash('sha256')
      .update(mount.url)
      .digest('hex');

    this._bucket = `h3${sha256.substr(0, 59)}`;
    this._region = region;
    this._mountUrl = mount.url;
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
    tags.push({ Key: 'mountpoint', Value: decodeURI(this._mountUrl) });
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

    const exists = await this._bucketExists();
    if (!exists) {
      await this._bucketCreate();
    }
    this._initialized = true;
  }

  async store(prefix, path, res) {
    await this._init();

    const { log } = this;
    const body = await res.buffer();
    const key = `${prefix}${path}`;

    const result = await this.client.send(new PutObjectCommand({
      Body: body,
      Bucket: this.bucket,
      ContentType: res.headers.get('content-type'),
      Key: key,
    }));
    log.info(`Object uploaded to: ${this.bucket}/${key}`);
    return result;
  }

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
