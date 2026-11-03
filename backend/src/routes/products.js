/*
 * Copyright (c) 2026 Intel Corporation
 *
 * SPDX-License-Identifier: Apache-2.0
 */

const express = require('express');
const router = express.Router();
const db = require('../db');
const { z, guid, money, shortText, idParams, validate, sendError } = require('../validation');

const optionalText = (max) => z.string().trim().max(max).nullish();
// barcode is UNIQUE, so "" from a blank form field would collide with the next blank one.
const barcodeText = z.string().trim().max(50).nullish().transform((v) => v || null);
const stockQuantity = z.number().int().min(0).max(1000000000);

const listQuery = z.object({
  category: z.union([guid, z.literal('undefined')]).optional(),
  search: z.string().max(100).optional(),
  active: z.enum(['true', 'false']).optional(),
});

const createBody = z.object({
  name: shortText(200),
  sku: shortText(50),
  barcode: barcodeText,
  category_id: guid.nullish(),
  price: money,
  cost: money.nullish(),
  stock_quantity: stockQuantity.nullish(),
  unit: optionalText(20),
  image_url: optionalText(2048),
});

const updateBody = z.object({
  name: shortText(200).nullish(),
  sku: shortText(50).nullish(),
  barcode: barcodeText,
  category_id: guid.nullish(),
  price: money.nullish(),
  cost: money.nullish(),
  stock_quantity: stockQuantity.nullish(),
  unit: optionalText(20),
  image_url: optionalText(2048),
  is_active: z.boolean().nullish(),
});

// GET all products
router.get('/', validate({ query: listQuery }), async (req, res) => {
  try {
    const { category, search, active } = req.query;
    let query = `
      SELECT p.*, c.name as category_name 
      FROM products p 
      LEFT JOIN categories c ON p.category_id = c.id 
      WHERE 1=1
    `;
    const params = [];

    if (category && category !== 'undefined') {
      params.push(category);
      query += ` AND p.category_id = $${params.length}`;
    }
    if (search) {
      params.push(`%${search}%`);
      query += ` AND (p.name ILIKE $${params.length} OR p.sku ILIKE $${params.length} OR p.barcode ILIKE $${params.length})`;
    }
    if (active !== undefined) {
      params.push(active === 'true');
      query += ` AND p.is_active = $${params.length}`;
    }

    query += ' ORDER BY p.name';
    const result = await db.query(query, params, req.experience);
    res.json(result.rows);
  } catch (err) {
    sendError(res, err, 'Failed to fetch products');
  }
});

// GET single product
router.get('/:id', validate({ params: idParams }), async (req, res) => {
  try {
    const result = await db.query(
      `SELECT p.*, c.name as category_name 
       FROM products p 
       LEFT JOIN categories c ON p.category_id = c.id 
       WHERE p.id = $1`,
      [req.params.id],
      req.experience
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    sendError(res, err, 'Failed to fetch product');
  }
});

// POST create product
router.post('/', validate({ body: createBody }), async (req, res) => {
  try {
    const { name, sku, barcode, category_id, price, cost, stock_quantity, unit, image_url } = req.body;
    const result = await db.query(
      `INSERT INTO products (name, sku, barcode, category_id, price, cost, stock_quantity, unit, image_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [name, sku, barcode, category_id, price, cost || 0, stock_quantity || 0, unit || 'each', image_url],
      req.experience
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Product with this SKU or barcode already exists' });
    }
    sendError(res, err, 'Failed to create product');
  }
});

// PUT update product
router.put('/:id', validate({ params: idParams, body: updateBody }), async (req, res) => {
  try {
    const { name, sku, barcode, category_id, price, cost, stock_quantity, unit, image_url, is_active } = req.body;
    const result = await db.query(
      `UPDATE products SET 
        name = COALESCE($1, name),
        sku = COALESCE($2, sku),
        barcode = COALESCE($3, barcode),
        category_id = COALESCE($4, category_id),
        price = COALESCE($5, price),
        cost = COALESCE($6, cost),
        stock_quantity = COALESCE($7, stock_quantity),
        unit = COALESCE($8, unit),
        image_url = COALESCE($9, image_url),
        is_active = COALESCE($10, is_active)
       WHERE id = $11 RETURNING *`,
      [name, sku, barcode, category_id, price, cost, stock_quantity, unit, image_url, is_active, req.params.id],
      req.experience
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Product with this SKU or barcode already exists' });
    }
    sendError(res, err, 'Failed to update product');
  }
});

// DELETE product
router.delete('/:id', validate({ params: idParams }), async (req, res) => {
  try {
    const result = await db.query('DELETE FROM products WHERE id = $1 RETURNING id', [req.params.id], req.experience);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }
    res.json({ message: 'Product deleted' });
  } catch (err) {
    sendError(res, err, 'Failed to delete product');
  }
});

module.exports = router;
