/*
 * Copyright (c) 2026 Intel Corporation
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Optional shared-secret auth for state-changing routes (ingest, actions),
// shared by all three services.

const crypto = require('crypto');

// Per-process random key: both values are MACed with it so the compared
// buffers always have the same length. This is not password storage.
const MAC_KEY = crypto.randomBytes(32);

/** Constant-time string comparison (MACs first so unequal lengths don't leak through timing). */
function secretsMatch(provided, expected) {
  if (typeof provided !== 'string' || typeof expected !== 'string') return false;
  const a = crypto.createHmac('sha256', MAC_KEY).update(provided).digest();
  const b = crypto.createHmac('sha256', MAC_KEY).update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

/**
 * Returns Express middleware that requires a matching `X-Api-Key` header (or
 * `Authorization: Bearer <key>`, for clients that only support that
 * convention) when `expectedKey` is set. If `expectedKey` is falsy (env var
 * not configured), the middleware is a no-op — local/dev usage stays open.
 */
function requireApiKey(expectedKey) {
  return (req, res, next) => {
    if (!expectedKey) return next();
    const bearerMatch = /^Bearer (.+)$/.exec(req.get('Authorization') || '');
    const provided = req.get('X-Api-Key') || (bearerMatch ? bearerMatch[1] : null);
    if (!secretsMatch(provided, expectedKey)) {
      return res.status(401).json({ error: 'Missing or invalid X-Api-Key (or Authorization: Bearer)' });
    }
    next();
  };
}

module.exports = { requireApiKey, secretsMatch };
