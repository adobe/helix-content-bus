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

const { AbortError, FetchError } = require('@adobe/helix-fetch');
const { logger } = require('@adobe/helix-universal-logger');
const wrap = require('@adobe/helix-shared-wrap');
const bodyData = require('@adobe/helix-shared-body-data');
const { requiredConfig } = require('@adobe/helix-shared-config');
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

  if (!(owner && repo && ref && path)) {
    return new Response('owner, repo, ref, and path parameters are required', {
      status: 400,
    });
  }

  const mp = context.config.fstab.match(path);
  if (!mp) {
    return new Response(`path specified is not mounted in fstab.yaml: ${path}`, {
      status: 400,
    });
  }

  const options = {
    cache: 'no-store',
    fetchTimeout: HTTP_TIMEOUT_EXTERNAL || 20000,
    requestId: req.headers.get('x-request-id')
    || req.headers.get('x-cdn-request-id')
    || req.headers.get('x-openwhisk-activation-id')
    || '',
  };

  let storage;

  try {
    storage = new AWSStorage({
      AWS_S3_REGION,
      AWS_S3_ACCESS_KEY_ID,
      AWS_S3_SECRET_ACCESS_KEY,
      mount: mp,
      log,
    });

    const res = await contentProxy({
      owner, repo, ref, path, log, options, resolver,
    });
    if (!res.ok) {
      return res;
    }
    const output = await storage.store(prefix, path, res);
    return new Response(JSON.stringify(output, null, 2), {
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
    if (storage) {
      storage.close();
    }
  }
}

module.exports.main = wrap(main)
  .with(requiredConfig, 'fstab')
  .with(bodyData)
  .with(helixStatus)
  .with(logger.trace)
  .with(logger);
