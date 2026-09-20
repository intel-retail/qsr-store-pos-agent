/*
 * Copyright (c) 2026 Intel Corporation
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Optional shared-secret auth for state-changing routes (ingest, actions).
// Reused by all 3 sim services, same as hub.js/envelope.js/rng.js.

/**
 * Returns Express middleware that requires a matching `X-Api-Key` header when
 * `expectedKey` is set. If `expectedKey` is falsy (env var not configured),
 * the middleware is a no-op — local/dev usage stays exactly as open as before.
 */
function requireApiKey(expectedKey) {
  return (req, res, next) => {
    if (!expectedKey) return next();
    if (req.get('X-Api-Key') !== expectedKey) {
      return res.status(401).json({ error: 'Missing or invalid X-Api-Key' });
    }
    next();
  };
}

module.exports = { requireApiKey };
