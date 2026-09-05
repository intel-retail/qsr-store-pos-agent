/*
 * Copyright (c) 2026 Intel Corporation
 *
 * SPDX-License-Identifier: Apache-2.0
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const db = require('../db');

const SETTINGS_FILE = path.join(__dirname, '..', '..', 'settings.json');

const defaults = {
  stockCheckEnabled: true,
};

function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      return { ...defaults, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) };
    }
  } catch (err) {
    console.error('Failed to load settings file, using defaults:', err.message);
  }
  return { ...defaults };
}

function saveSettings() {
  try {
    // explicit boolean coercion severs the HTTP-request taint chain before file write
    const safe = { stockCheckEnabled: settings.stockCheckEnabled === true };
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(safe, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to save settings file:', err.message);
  }
}

const settings = loadSettings();

// GET current settings
router.get('/', (req, res) => {
  res.json(settings);
});

// PUT update settings
router.put('/', (req, res) => {
  const { stockCheckEnabled } = req.body;
  if (typeof stockCheckEnabled === 'boolean') {
    settings.stockCheckEnabled = stockCheckEnabled;
  }
  saveSettings();
  res.json(settings);
});

// DELETE all transactions
router.delete('/transactions', async (req, res) => {
  try {
    await db.query('DELETE FROM transaction_items', [], req.experience);
    await db.query('DELETE FROM transactions', [], req.experience);
    res.json({ message: 'All transactions cleared' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to clear transactions' });
  }
});

// Export settings object for use by other routes
router.getSettings = () => settings;

module.exports = router;
