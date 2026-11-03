/*
 * Copyright (c) 2026 Intel Corporation
 *
 * SPDX-License-Identifier: Apache-2.0
 */

const express = require('express');
const router = express.Router();
const db = require('../db');
const rateLimit = require('express-rate-limit');
const { z, validate, sendError } = require('../validation');

const verifyBody = z.object({
  pin_code: z.string().trim().min(1).max(10),
});

// PINs are short: throttle failed verification attempts per client.
const verifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many failed PIN attempts, try again later' },
});

// GET all staff
router.get('/', async (req, res) => {
  try {
    const result = await db.query(
      'SELECT id, name, role, is_active, created_at FROM staff WHERE is_active = true ORDER BY name',
      [],
      req.experience
    );
    res.json(result.rows);
  } catch (err) {
    sendError(res, err, 'Failed to fetch staff');
  }
});

// POST verify staff PIN
router.post('/verify', verifyLimiter, validate({ body: verifyBody }), async (req, res) => {
  try {
    const { pin_code } = req.body;
    const result = await db.query(
      'SELECT id, name, role FROM staff WHERE pin_code = $1 AND is_active = true',
      [pin_code],
      req.experience
    );
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid PIN' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    sendError(res, err, 'Failed to verify staff');
  }
});

module.exports = router;
