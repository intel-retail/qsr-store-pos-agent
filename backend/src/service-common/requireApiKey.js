/*
 * Copyright (c) 2026 Intel Corporation
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Optional shared-secret auth for state-changing routes (ingest, actions),
// shared by all three services.

const crypto = require('crypto');

/** Constant-time string comparison (zero-pads to equal length, then checks the real lengths match). */
function secretsMatch(provided, expected) {
  if (typeof provided !== 'string' || typeof expected !== 'string') return false;
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  const len = Math.max(a.length, b.length, 1);
  const padA = Buffer.alloc(len);
  const padB = Buffer.alloc(len);
  a.copy(padA);
  b.copy(padB);
  return crypto.timingSafeEqual(padA, padB) && a.length === b.length;
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
