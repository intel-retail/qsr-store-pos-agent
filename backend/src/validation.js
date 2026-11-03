/*
 * Copyright (c) 2026 Intel Corporation
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Request validation for the REST routes: malformed input is a 400 (never a
// database error surfacing as a 500), and database constraint failures that
// are really bad input map to 4xx.

const { z } = require('zod');

// Every primary key in the schemas is a UUID; a malformed id would otherwise fail inside Postgres (22P02).
const guid = z.guid();

const MAX_MONEY = 99999999.99;

// Accepts a JSON number or a plain decimal string ("3.50"); never coerces null/""/booleans to 0.
const decimal = z
  .union([z.number(), z.string().trim().regex(/^-?\d+(\.\d+)?$/, 'must be a number').transform(Number)])
  .pipe(z.number().finite());

const money = decimal.pipe(z.number().min(0).max(MAX_MONEY));
const quantity = z.number().int().min(1).max(100000);
const shortText = (max) => z.string().trim().min(1).max(max);

const idParams = z.object({ id: guid });

/** Validates req.params/query/body against zod schemas; on success req.body is replaced with the parsed (unknown keys stripped) value. */
function validate({ params, query, body } = {}) {
  return (req, res, next) => {
    const targets = [
      ['params', params, req.params],
      ['query', query, req.query],
      ['body', body, req.body ?? {}],
    ];
    for (const [where, schema, value] of targets) {
      if (!schema) continue;
      const parsed = schema.safeParse(value);
      if (!parsed.success) {
        return res.status(400).json({
          error: 'Validation failed',
          details: parsed.error.issues.map((i) => ({ in: where, path: i.path.join('.'), message: i.message })),
        });
      }
      if (where === 'body') req.body = parsed.data;
    }
    next();
  };
}

// Postgres errors that mean "the caller sent bad data", not "the server failed".
const BAD_INPUT_CODES = new Set(['22P02', '22003', '22001', '22007', '22008', '22023', '23502', '23514']);

/** Sends the right 4xx for a constraint/data error, otherwise logs and sends a generic 500. */
function sendError(res, err, fallbackMessage) {
  if (err && BAD_INPUT_CODES.has(err.code)) {
    return res.status(400).json({ error: 'Invalid input' });
  }
  if (err && err.code === '23505') {
    return res.status(409).json({ error: 'Resource already exists' });
  }
  if (err && err.code === '23503') {
    return res.status(409).json({ error: 'Referenced record does not exist or is still in use' });
  }
  console.error(err);
  return res.status(500).json({ error: fallbackMessage });
}

module.exports = { z, guid, decimal, money, quantity, shortText, idParams, validate, sendError };
