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

/* eslint-disable no-param-reassign */
const fetchAPI = require('@adobe/helix-fetch');
const { Response } = require('@adobe/helix-universal');

const { context, ALPN_HTTP1_1 } = fetchAPI;
const { fetch, timeoutSignal } = process.env.HELIX_FETCH_FORCE_HTTP1
  ? context({
    alpnProtocols: [ALPN_HTTP1_1],
    userAgent: 'helix-fetch', // static user agent for test recordings
  })
  /* istanbul ignore next */
  : fetchAPI;

/**
 * Returns fetch compatible options for the given handler options.
 * @param {object} options Handler options
 * @return {object} fetch options.
 */
function getFetchOptions(options) {
  const fetchopts = {
    headers: {},
    ...options,
  };
  if (options.requestId) {
    fetchopts.headers['x-request-id'] = options.requestId;
  }
  if (options.fetchTimeout) {
    fetchopts.signal = timeoutSignal(options.fetchTimeout);
  }
  if (options.lastModified) {
    fetchopts.headers['if-modified-since'] = options.lastModified;
  }
  delete fetchopts.requestId;
  if (fetchopts.token) {
    fetchopts.headers['x-github-token'] = fetchopts.token;
  }
  delete fetchopts.token;

  // delete all secrets
  Object.keys(fetchopts)
    .forEach((key) => {
      if (key.match(/^[A-Z0-9_]+$/)) {
        delete fetchopts[key];
      }
    });
  return fetchopts;
}

/**
 * Create an error response.
 */
function createErrorResponse({
  e, msg, status, log,
}) {
  const message = (e && e.message) || msg;
  if (log) {
    const args = [message];
    if (e) {
      args.push(e, e.stack);
    }
    log.error(...args);
  }
  return new Response('', {
    status: (e && e.status) || status || 500,
    headers: {
      'x-error': message,
    },
  });
}

module.exports = {
  fetch,
  getFetchOptions,
  createErrorResponse,
};
