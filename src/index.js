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

const { AbortError, FetchError } = require('@adobe/helix-fetch');
const { logger } = require('@adobe/helix-universal-logger');
const wrap = require('@adobe/helix-shared-wrap');
const bodyData = require('@adobe/helix-shared-body-data');
const { MountConfig } = require('@adobe/helix-shared-config');
const { wrap: helixStatus } = require('@adobe/helix-status');
const { Response } = require('@adobe/helix-universal');

const { contentProxy } = require('./content-proxy.js');
const { AWSStorage } = require('./storage.js');

/* istanbul ignore next */
function unknown(e, log) {
  const stack = (e && e.stack) || 'no stack';
  log.error('Unhandled error', e, stack);

  const body = (e && e.message) || 'no message';
  const status = (e && e.status) || 500;
  return new Response(body, { status });
}

/**
 * Parse a boolean given as either a string or a boolean.
 *
 * @param {any} value value to parse
 * @param {boolean} defaultValue default value to use if value is unset
 * @returns true, false or the default value
 */
function parseBoolean(value, defaultValue) {
  if (value === 'false' || value === Boolean(false)) {
    return false;
  }
  return value ? !!value : defaultValue;
}

/**
 * Fetches content from content-proxy and stores it in an S3 bucket.
 *
 * @param {Request} req request object
 * @param {Context} context request context
 * @returns {Response} the response
 */
async function main(req, context) {
  const { env, log, resolver } = context;
  const {
    AWS_S3_REGION, AWS_S3_ACCESS_KEY_ID, AWS_S3_SECRET_ACCESS_KEY,
    HTTP_TIMEOUT_EXTERNAL,
  } = env;

  const {
    owner, repo, ref, path, prefix = 'live',
  } = context.data;

  const useCDN = parseBoolean(context.data.useCDN, true);
  const useLastModified = parseBoolean(context.data.useLastModified, false);

  if (!(owner && repo && ref && path)) {
    return new Response('owner, repo, ref, and path parameters are required', {
      status: 400,
    });
  }

  let codeStorage;
  let fstab;

  try {
    codeStorage = new AWSStorage({
      AWS_S3_REGION,
      AWS_S3_ACCESS_KEY_ID,
      AWS_S3_SECRET_ACCESS_KEY,
      bucket: 'helix-code-bus',
      readOnly: true,
      log,
    });
    const buffer = await codeStorage.load(`${owner}/${repo}/${ref}/fstab.yaml`);
    if (!buffer) {
      log.error(`${owner}/${repo}/${ref}/fstab.yaml not found in bucket 'helix-code-bus'`);
      return new Response('', {
        status: 400,
        headers: {
          'x-error': `${owner}/${repo}/${ref}/fstab.yaml not found in bucket 'helix-code-bus'`,
        },
      });
    }
    fstab = await new MountConfig().withSource(buffer.toString()).init();
  } finally {
    /* istanbul ignore else */
    if (codeStorage) {
      codeStorage.close();
    }
  }

  const mp = fstab.match(path);
  if (!mp) {
    log.error(`path specified is not mounted in fstab.yaml: ${path}`);
    return new Response('', {
      status: 400,
      headers: {
        'x-error': `path specified is not mounted in fstab.yaml: ${path}`,
      },
    });
  }

  const options = {
    cache: 'no-store',
    fetchTimeout: HTTP_TIMEOUT_EXTERNAL || 20000,
    requestId: req.headers.get('x-request-id')
    || req.headers.get('x-cdn-request-id')
    || req.headers.get('x-openwhisk-activation-id')
    || '',
    token: req.headers.get('x-github-token'),
  };

  let contentStorage;

  try {
    const sha256 = crypto
      .createHash('sha256')
      .update(mp.url)
      .digest('hex');
    const key = `${prefix}${path}`;

    contentStorage = new AWSStorage({
      AWS_S3_REGION,
      AWS_S3_ACCESS_KEY_ID,
      AWS_S3_SECRET_ACCESS_KEY,
      bucket: `h3${sha256.substr(0, 59)}`,
      tags: [{ Key: 'mountpoint', Value: decodeURI(mp.url) }],
      log,
    });

    if (useLastModified) {
      const metadata = await contentStorage.metadata(key);
      if (metadata) {
        options.lastModified = metadata['last-modified'];
      }
    }

    const res = await contentProxy({
      owner, repo, ref, path, mp, log, options, resolver, useCDN,
    });
    if (!res.ok) {
      return res;
    }
    await contentStorage.store(key, res);
    return new Response('', {
      status: 200,
    });
  } catch (e) {
    /* istanbul ignore next */
    if (e instanceof AbortError) {
      return new Response(e.message, {
        status: 504,
      });
    }
    /* istanbul ignore next */
    if (e instanceof FetchError) {
      if (e.code === 'ECONNRESET') {
        // connection reset by host: temporary network issue
        return new Response(e.message, {
          status: 504,
        });
      }
    }
    /* istanbul ignore next */
    return unknown(e, log);
  } finally {
    /* istanbul ignore else */
    if (contentStorage) {
      contentStorage.close();
    }
  }
}

module.exports.main = wrap(main)
  .with(bodyData)
  .with(helixStatus)
  .with(logger.trace)
  .with(logger);
