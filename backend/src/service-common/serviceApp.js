/*
 * Copyright (c) 2026 Intel Corporation
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Express skeleton shared by the headless services: security middleware,
// health, SSE stream (with Last-Event-ID resume), SOURCE=real ingest, error
// handling, listening and graceful shutdown. A service adds its own read and
// action routes on the returned app, then calls start().

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const { rowToWireEnvelope } = require('./producer');
const { todayUtc } = require('./config');
const { assertSimDate } = require('./envelope');
const { requireApiKey } = require('./requireApiKey');
const { appendAndPublish } = require('./publish');
const { pastDates, materializeDates } = require('./seedHistory');

/** Express 4 does not catch rejected promises from async handlers; route them to the error middleware. */
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

/** Maps an envelope validation failure to a 400 for the caller. */
function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

/** Optional string query parameter; repeated params (?a=1&a=2) arrive as arrays and are rejected. */
function queryString(value, name) {
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string') throw badRequest(`${name} must be a single string`);
  return value;
}

/** Optional YYYY-MM-DD query parameter, validated so a bad date is a 400 rather than a database error. */
function queryDate(value, name) {
  const date = queryString(value, name);
  if (date === undefined) return undefined;
  try {
    assertSimDate(date, name);
  } catch (err) {
    throw badRequest(err.message);
  }
  return date;
}

/** Optional positive integer query parameter, clamped to [1, max]. */
function queryLimit(value, fallback, max = 1000) {
  const n = Number(queryString(value, 'limit'));
  return Number.isInteger(n) && n > 0 ? Math.min(n, max) : fallback;
}

/**
 * @param {object} opts
 * @param {string} opts.label        log prefix, e.g. 'store-activity-service'
 * @param {string} opts.routePrefix  URL prefix, e.g. '/store-activity'
 * @param {string} opts.portEnv      env var that overrides the port (named in the EADDRINUSE hint)
 * @param {object} opts.config       { SOURCE, MODE, BENCHMARK, EXPERIENCE }
 * @param {string|null} opts.apiKey  required X-Api-Key on write routes when set
 * @param {string[]} opts.corsOrigins
 * @param {object} opts.log          event log (BaseEventLog subclass)
 * @param {object} opts.hub          EventHub
 * @param {Function} opts.validateEnvelope
 * @param {boolean} opts.refRequired reject ingested events without a ref
 */
function createServiceApp({ label, routePrefix, portEnv, config, apiKey, corsOrigins, log, hub, validateEnvelope, refRequired }) {
  const app = express();
  app.use(helmet());
  app.use(cors({
    origin: corsOrigins,
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'X-Api-Key', 'Last-Event-ID'],
  }));
  app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000 }));
  app.use(express.json({ limit: '1mb' }));

  const writeLimiter = rateLimit({ windowMs: 60 * 1000, max: 60 });
  const writeGuards = [writeLimiter, requireApiKey(apiKey)];

  app.get(`${routePrefix}/health`, async (req, res) => {
    let dbOk = true;
    try {
      await log.ping();
    } catch {
      dbOk = false;
    }
    const mqttOk = !hub.mqttClient || hub.mqttClient.connected === true;
    res.status(dbOk ? 200 : 503).json({
      status: dbOk ? 'ok' : 'degraded',
      source: config.SOURCE,
      mode: config.MODE,
      benchmark: config.BENCHMARK,
      experience: config.EXPERIENCE,
      db: dbOk ? 'ok' : 'error',
      mqtt: mqttOk ? 'ok' : 'disconnected',
    });
  });

  // Live/replay push path for agents: subscribe once, get every event as it happens.
  // A reconnecting client's Last-Event-ID (an event_id) is resolved back to a log
  // row so events fired during the disconnect gap are replayed, not silently missed.
  app.get(`${routePrefix}/events/stream`, (req, res) => {
    const lastEventId = req.get('Last-Event-ID');
    hub.attachSSE(req, res, {
      getReplay: lastEventId ? async () => {
        const sinceId = await log.findLogId(lastEventId);
        if (sinceId == null) return [];
        return (await log.drainTail({ sinceId })).map(rowToWireEnvelope);
      } : undefined,
    });
  });

  // The SOURCE=real ingestion path. Same envelope contract as the producer, so
  // swapping SOURCE requires no agent-facing change.
  app.post(`${routePrefix}/ingest`, ...writeGuards, asyncHandler(async (req, res) => {
    if (config.SOURCE !== 'real') {
      return res.status(409).json({ error: `Ingestion only accepted when SOURCE=real (current SOURCE=${config.SOURCE})` });
    }
    let envelope;
    try {
      envelope = validateEnvelope(req.body);
    } catch (err) {
      throw badRequest(err.message);
    }
    if (refRequired && !envelope.ref) throw badRequest('ref is required for this service');
    const saved = await appendAndPublish(log, hub, envelope);
    res.json({ accepted: !!saved, duplicate: !saved });
  }));

  /** Builds an envelope for an action route, turning validation failures into a 400. */
  function buildActionEnvelope(build) {
    try {
      return build();
    } catch (err) {
      throw badRequest(err.message);
    }
  }

  /** Call after the service's own routes are registered. */
  function start({ port, producer = null }) {
    app.use((err, req, res, next) => {
      if (res.headersSent) return next(err);
      if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message });
      console.error(`[${label}] Request failed:`, err.message);
      res.status(500).json({ error: 'Internal server error' });
    });

    const server = app.listen(port, () => {
      console.log(`[${label}] listening on ${port} (source=${config.SOURCE}, mode=${config.MODE}, benchmark=${config.BENCHMARK})`);
    });
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`[${label}] Port ${port} is already in use — set ${portEnv} to a free port.`);
      } else {
        console.error(`[${label}] Server error:`, err.message);
      }
      process.exit(1);
    });

    const shutdown = async () => {
      if (producer) producer.stop();
      hub.close();
      await log.close();
      server.close(() => process.exit(0));
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    // Fail fast on unexpected errors so the container supervisor restarts a clean process.
    process.on('unhandledRejection', (reason) => {
      console.error(`[${label}] Unhandled promise rejection:`, reason);
      process.exit(1);
    });
    process.on('uncaughtException', (err) => {
      console.error(`[${label}] Uncaught exception:`, err);
      process.exit(1);
    });
    return server;
  }

  return { app, writeGuards, buildActionEnvelope, start };
}

/**
 * Starts the producer for SOURCE=sim (live schedule or log replay); with
 * SOURCE=real nothing is produced and the service waits for ingest.
 * Returns the producer, or null.
 */
async function startProducer({ label, routePrefix, config, producer }) {
  if (config.SOURCE !== 'sim') {
    console.log(`[${label}] SOURCE=real — internal producer disabled, waiting for POST ${routePrefix}/ingest`);
    return null;
  }
  // A day is complete once it holds the full deterministic schedule for this seed; shorter days (interrupted
  // preload, or cut off mid-day by the live producer) are re-materialized, which only adds the gaps.
  if (config.PRELOAD_DAYS > 0) {
    const dates = pastDates(config.PRELOAD_DAYS);
    const counts = await producer.log.countsByDay({ experience: producer.experience, dates, seed: producer.seed });
    const incomplete = dates.filter((d) => (counts.get(d) || 0) < producer.generateSchedule(d).length);
    if (incomplete.length > 0) {
      await materializeDates(producer, incomplete);
      console.log(`[${label}] preloaded ${incomplete.length} missing or incomplete day(s) of history`);
    }
  }
  if (config.MODE === 'replay') {
    const count = await producer.runReplay({ simDate: config.REPLAY_DATE, speed: config.SPEED });
    console.log(`[${label}] replaying ${count} recorded events for ${config.REPLAY_DATE} at ${config.SPEED}x`);
  } else {
    const simDate = todayUtc();
    const count = await producer.runLive({ simDate, speed: config.SPEED, resume: true });
    console.log(`[${label}] running live schedule (${count} events pending) from ${simDate} at ${config.SPEED}x, seed=${config.SEED}`);
  }
  return producer;
}

module.exports = { createServiceApp, startProducer, asyncHandler, badRequest, queryString, queryDate, queryLimit };
