/*
 * Copyright (c) 2026 Intel Corporation
 *
 * SPDX-License-Identifier: Apache-2.0
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const productRoutes = require('./routes/products');
const categoryRoutes = require('./routes/categories');
const transactionRoutes = require('./routes/transactions');
const staffRoutes = require('./routes/staff');
const simulatorRoutes = require('./routes/simulator');
const settingsRoutes = require('./routes/settings');
const mcpRoutes = require('./routes/mcp');
const chatRoutes = require('./routes/chat');
const metricsRoutes = require('./routes/metrics');

const app = express();
const PORT = process.env.PORT || 3000;

// One reverse proxy (nginx) sits in front; without this every client shares the proxy's IP in the rate limiters.
app.set('trust proxy', 1);

// Security middleware
app.use(helmet());
app.use(cors({
  origin: ['http://localhost:4200'],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Experience']
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000
});
app.use(limiter);

// Body parsing (chat replays up to 50 history turns, so it gets a larger cap; must precede the global parser)
app.use('/api/chat', express.json({ limit: '2mb' }));
app.use(express.json({ limit: '100kb' }));

const EXPERIENCES = new Set(['grocery', 'cafe']);

// Experience middleware - extracts experience from header or query
app.use((req, res, next) => {
  const experience = req.headers['x-experience'] || req.query.experience || 'grocery';
  if (typeof experience !== 'string' || !EXPERIENCES.has(experience)) {
    return res.status(400).json({ error: 'Invalid experience. Must be one of: grocery, cafe' });
  }
  req.experience = experience;
  next();
});

// Routes
app.use('/api/products', productRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/staff', staffRoutes);
app.use('/api/simulator', simulatorRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/mcp', mcpRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/metrics', metricsRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Error handling
app.use((err, req, res, next) => {
  // Client errors raised by middleware (e.g. malformed JSON, oversized body) are 4xx, not server failures.
  if (err.status >= 400 && err.status < 500) {
    return res.status(err.status).json({
      error: err.type === 'entity.parse.failed' ? 'Invalid JSON body' : 'Bad request',
    });
  }
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

// Fail fast on unexpected errors so the container supervisor restarts a clean process.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
  process.exit(1);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  process.exit(1);
});

app.listen(PORT, () => {
  console.log(`POS Backend running on port ${PORT}`);
});

module.exports = app;
