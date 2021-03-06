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

const path = require('path');
const querystring = require('querystring');
const NodeHttpAdapter = require('@pollyjs/adapter-node-http');
const FSPersister = require('@pollyjs/persister-fs');
const { setupMocha } = require('@pollyjs/core');
const { Request } = require('@adobe/helix-fetch');

function setupPolly(opts) {
  setupMocha({
    logging: false,
    recordFailedRequests: true,
    recordIfMissing: false,
    matchRequestsBy: {
      headers: {
        exclude: ['authorization', 'accept-encoding', 'user-agent', 'accept', 'connection', 'x-request-id'],
      },
    },
    adapters: [NodeHttpAdapter],
    persister: FSPersister,
    persisterOptions: {
      fs: {
        recordingsDir: path.resolve(__dirname, 'fixtures'),
      },
    },
    ...opts,
  });
}

function retrofit(fn) {
  const resolver = {
    createURL({ package: pkg, name, version }) {
      return new URL(`https://adobeioruntime.net/api/v1/web/helix/${pkg}/${name}@${version}`);
    },
  };
  return async (params = {}, env = {}, post = false) => {
    const req = post
      ? new Request('https://helix-service.com/publish', {
        method: 'POST',
        body: params,
      })
      : new Request(`https://helix-service.com/publish?${querystring.encode(params)}`);
    const context = {
      resolver,
      env,
      // eslint-disable-next-line no-underscore-dangle
      log: params.__ow_logger,
    };
    const resp = await fn(req, context);
    return {
      statusCode: resp.status,
      body: await resp.text(),
      headers: resp.headers.plain(),
    };
  };
}

module.exports = { setupPolly, retrofit };
