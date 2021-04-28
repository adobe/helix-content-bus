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

const crypto = require('crypto');
const {
  S3Client,
  PutObjectCommand,
} = require('@aws-sdk/client-s3');

/**
 * AWS Storage class
 */
class AWSStorage {
  constructor(opts) {
    const {
      AWS_REGION: region,
      AWS_ACCESS_KEY_ID: accessKeyId,
      AWS_SECRET_ACCESS_KEY: secretAccessKey,
      mount,
      log = console,
    } = opts;

    if (!(region && accessKeyId && secretAccessKey)) {
      throw new Error('AWS_REGION, AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY are required.');
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
    this._bucket = `h3${sha256.substr(0, 60)}`;
    this._log = log;
  }

  async store(path, res) {
    const { log } = this;
    const text = await res.text();

    const input = {
      Body: text,
      Bucket: this.bucket,
      ContentType: res.headers.get('content-type'),
      Key: path,
    };
    const output = await this._s3.send(new PutObjectCommand(input));
    log.info(`Object uploaded to: ${this.bucket}${path} (${JSON.stringify(output)})`);
    return output;
  }

  get bucket() {
    return this._bucket;
  }

  get log() {
    return this._log;
  }
}

module.exports = { AWSStorage };
