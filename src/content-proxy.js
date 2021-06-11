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

const { Response } = require('@adobe/helix-fetch');
const { logLevelForStatusCode, propagateStatusCode } = require('@adobe/helix-shared-utils');
const { fetch, getFetchOptions } = require('./utils.js');

/**
 * Pass through headers that we keep in the forwarded response.
 */
const PASSTHROUGH_HEADERS = [
  'content-type',
  'last-modified',
  'x-source-location',
];

/**
 * Create the URL to fetch content from.
 *
 * @param {object}   opts options
 * @param {string}   opts.owner the GitHub org or username
 * @param {string}   opts.repo the GitHub repository
 * @param {string}   opts.ref the GitHub ref
 * @param {string}   opts.path the path of the file to retrieve
 * @param {string}   opts.mp mountpoint
 * @param {object}   opts.log a Helix-Log instance
 * @param {object}   opts.options Helix Fetch options
 * @param {Resolver} opts.resolver Version lock helper
 *
 * @returns {string} URL to fetch content from
 */
function createURL(opts) {
  const {
    owner, repo, ref, path, mp, options, resolver,
  } = opts;

  const url = resolver.createURL({
    package: 'helix-services',
    name: 'content-proxy',
    version: 'v2',
  });
  url.searchParams.append('owner', owner);
  url.searchParams.append('repo', repo);
  url.searchParams.append('ref', ref);
  url.searchParams.append('path', path);

  if (mp) {
    url.searchParams.append('mpType', mp.type);
    url.searchParams.append('mpRelPath', mp.relPath);
    url.searchParams.append('mpURL', mp.url);
  }
  url.searchParams.append('rid', options.requestId);
  return url.href;
}

/**
 * Fetches a document, either by using the content-proxy service or going to a CDN.
 *
 * @param {object}   opts options
 * @param {string}   opts.owner the GitHub org or username
 * @param {string}   opts.repo the GitHub repository
 * @param {string}   opts.ref the GitHub ref
 * @param {string}   opts.path the path of the file to retrieve
 * @param {string}   opts.mp mountpoint
 * @param {object}   opts.log a Helix-Log instance
 * @param {object}   opts.options Helix Fetch options
 * @param {Resolver} opts.resolver Version lock helper
 *
 * @returns {Response} response
 */
async function contentProxy(opts) {
  const {
    log, options,
  } = opts;

  const url = createURL(opts);
  log.info(`Fetching content from: ${url}`);

  const resp = await fetch(url, getFetchOptions(options));
  const body = await resp.buffer();
  if (resp.ok) {
    const headers = {};
    PASSTHROUGH_HEADERS.forEach((name) => {
      const value = resp.headers.get(name);
      if (value) {
        headers[name] = value;
      }
    });
    return new Response(body, {
      status: 200,
      headers,
    });
  }
  log[logLevelForStatusCode(resp.status)](`Unable to fetch ${url} (${resp.status}): ${resp.headers.get('x-error')}`);
  return new Response(body, {
    status: propagateStatusCode(resp.status),
    headers: {
      'x-error': resp.headers.get('x-error'),
      'cache-control': 'private, no-cache',
    },
  });
}

module.exports = {
  contentProxy,
};
