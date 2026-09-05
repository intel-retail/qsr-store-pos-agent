/*
 * Copyright (c) 2026 Intel Corporation
 *
 * SPDX-License-Identifier: Apache-2.0
 */

const express = require('express');
const router = express.Router();
const db = require('../db');

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
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch staff' });
  }
});

// POST verify staff PIN
router.post('/verify', async (req, res) => {
  try {
    const { pin_code } = req.body;
    if (!pin_code) {
      return res.status(400).json({ error: 'PIN code is required' });
    }
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
    console.error(err);
    res.status(500).json({ error: 'Failed to verify staff' });
  }
});

module.exports = router;
