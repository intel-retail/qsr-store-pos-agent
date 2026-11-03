/*
 * Copyright (c) 2026 Intel Corporation
 *
 * SPDX-License-Identifier: Apache-2.0
 */

const express = require('express');
const router = express.Router();
const db = require('../db');
const { z, shortText, idParams, validate, sendError } = require('../validation');

const createBody = z.object({
  name: shortText(100),
  description: z.string().trim().max(1000).nullish(),
});

const updateBody = z.object({
  name: shortText(100).nullish(),
  description: z.string().trim().max(1000).nullish(),
});

// GET all categories
router.get('/', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM categories ORDER BY name', [], req.experience);
    res.json(result.rows);
  } catch (err) {
    sendError(res, err, 'Failed to fetch categories');
  }
});

// POST create category
router.post('/', validate({ body: createBody }), async (req, res) => {
  try {
    const { name, description } = req.body;
    const result = await db.query(
      'INSERT INTO categories (name, description) VALUES ($1, $2) RETURNING *',
      [name, description],
      req.experience
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    sendError(res, err, 'Failed to create category');
  }
});

// PUT update category
router.put('/:id', validate({ params: idParams, body: updateBody }), async (req, res) => {
  try {
    const { name, description } = req.body;
    const result = await db.query(
      'UPDATE categories SET name = COALESCE($1, name), description = COALESCE($2, description) WHERE id = $3 RETURNING *',
      [name, description, req.params.id],
      req.experience
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Category not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    sendError(res, err, 'Failed to update category');
  }
});

// DELETE category
router.delete('/:id', validate({ params: idParams }), async (req, res) => {
  try {
    const result = await db.query('DELETE FROM categories WHERE id = $1 RETURNING id', [req.params.id], req.experience);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Category not found' });
    }
    res.json({ message: 'Category deleted' });
  } catch (err) {
    sendError(res, err, 'Failed to delete category');
  }
});

module.exports = router;
