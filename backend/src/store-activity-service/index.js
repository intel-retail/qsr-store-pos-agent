/*
 * Copyright (c) 2026 Intel Corporation
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Headless runner for the store activity service. Runs standalone (its own
// process/port), independent of backend/src/server.js. Owns: the durable log,
// the hub (SSE + MQTT fanout), and — when SOURCE=sim — the deterministic
// producer.
//
// See STORE-ACTIVITY-SERVICE.md for the full SOURCE=sim|real switch and env var reference.

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const { StoreActivityEventLog } = require('./eventLog');
const { EventHub } = require('../service-common/hub');
const { attachAgentForwarder } = require('../service-common/agentForwarder');
const { StoreActivityProducer } = require('./producer');
const { EVENT_TYPES, SEVERITIES, createEnvelope, validateEnvelope } = require('./envelope');
const { loadCommonConfig, loadTableCount, envInt, parseCorsOrigins } = require('../service-common/config');
const { createServiceApp, startProducer, asyncHandler, badRequest, queryString, queryDate, queryLimit } = require('../service-common/serviceApp');
const { appendAndPublish, actionSource, actionTiming } = require('../service-common/publish');

const LABEL = 'store-activity-service';
const ROUTE_PREFIX = '/store-activity';

const config = loadCommonConfig();
const { SOURCE, BENCHMARK, EXPERIENCE, SEED } = config;
const PORT = envInt('SIM_PORT', 3100, { min: 1, max: 65535 });
const TABLE_COUNT = loadTableCount();
// Unset by default (open, matching prior behavior) — set to require X-Api-Key on writes.
const API_KEY = process.env.SIM_API_KEY || null;

const EVENT_TYPE_DESCRIPTIONS = {
  [EVENT_TYPES.CUSTOMER_ARRIVED]: 'A customer entered the store/café.',
  [EVENT_TYPES.CUSTOMER_DEPARTED]: 'A customer left, dine-in or takeout.',
  [EVENT_TYPES.TABLE_OCCUPIED]: 'A table was seated by a dine-in customer.',
  [EVENT_TYPES.TABLE_DIRTY]: 'A table was vacated and needs clearing.',
  [EVENT_TYPES.TABLE_CLEARED]: 'A table was cleared and is available again.',
  [EVENT_TYPES.ORDER_PLACED]: 'An order was placed.',
  [EVENT_TYPES.ORDER_COMPLETED]: 'An order was prepared and handed off.',
  [EVENT_TYPES.QUEUE_DEPTH_CHANGED]: 'The number of customers waiting on an order changed.',
};

async function main() {
  const log = new StoreActivityEventLog();
  await log.init();

  const hub = new EventHub({ enabled: !BENCHMARK });
  hub.connectMqtt();
  attachAgentForwarder({
    hub, label: LABEL, service: LABEL, config,
    defaultEventTypes: [EVENT_TYPES.QUEUE_DEPTH_CHANGED],
    // Events without a depth (real/injected) pass.
    defaultFilter: (e, env) => {
      const depth = e.payload?.depth;
      const min = env.QSR_AGENT_QUEUE_MIN_DEPTH?.trim() ? Number(env.QSR_AGENT_QUEUE_MIN_DEPTH) : 0;
      return typeof depth !== 'number' || !(min > 0) || depth >= min;
    },
  });

  const { app, writeGuards, buildActionEnvelope, start } = createServiceApp({
    label: LABEL,
    routePrefix: ROUTE_PREFIX,
    portEnv: 'SIM_PORT',
    config,
    apiKey: API_KEY,
    corsOrigins: parseCorsOrigins('SIM_CORS_ORIGIN', LABEL),
    log,
    hub,
    validateEnvelope,
    refRequired: false,
  });

  // Plain-HTTP mirrors of the MCP read tools, for clients that can't spawn an
  // MCP stdio process (browsers, curl, monitoring tools).
  app.get(`${ROUTE_PREFIX}/event-types`, (req, res) => {
    res.json(Object.entries(EVENT_TYPE_DESCRIPTIONS).map(([event_type, description]) => ({ event_type, description })));
  });

  app.get(`${ROUTE_PREFIX}/history`, asyncHandler(async (req, res) => {
    const q = req.query;
    res.json(await log.queryHistory({
      experience: queryString(q.experience, 'experience') || EXPERIENCE,
      eventType: queryString(q.event_type, 'event_type'),
      groupBy: queryString(q.group_by, 'group_by'),
      startDate: queryDate(q.start_date, 'start_date'),
      endDate: queryDate(q.end_date, 'end_date'),
    }));
  }));

  app.get(`${ROUTE_PREFIX}/compare`, asyncHandler(async (req, res) => {
    const q = req.query;
    const date = queryDate(q.date, 'date');
    const baselineDate = queryDate(q.baseline_date, 'baseline_date');
    if (!date || !baselineDate) throw badRequest('date and baseline_date are required');
    res.json(await log.compareToBaseline({
      experience: queryString(q.experience, 'experience') || EXPERIENCE,
      eventType: queryString(q.event_type, 'event_type'),
      date,
      baselineDate,
    }));
  }));

  app.get(`${ROUTE_PREFIX}/tail`, asyncHandler(async (req, res) => {
    res.json(await log.tail({
      sinceId: Number(queryString(req.query.since_id, 'since_id')) || 0,
      limit: queryLimit(req.query.limit, 100),
    }));
  }));

  app.get(`${ROUTE_PREFIX}/snapshot`, asyncHandler(async (req, res) => {
    res.json(await log.getCurrentSnapshot({ experience: queryString(req.query.experience, 'experience') || EXPERIENCE }));
  }));

  // Plain-HTTP mirrors of the MCP action tools, same envelope/log/hub path.
  app.post(`${ROUTE_PREFIX}/actions/mark-table-cleared`, ...writeGuards, asyncHandler(async (req, res) => {
    const tableRef = req.body?.table_ref;
    if (!tableRef) throw badRequest('table_ref is required');
    const timing = await actionTiming(log, SOURCE, req.body?.experience || EXPERIENCE);
    const envelope = buildActionEnvelope(() => createEnvelope({
      eventType: EVENT_TYPES.TABLE_CLEARED,
      severity: SEVERITIES.INFO,
      source: actionSource(SOURCE),
      experience: req.body?.experience || EXPERIENCE,
      ref: tableRef,
      ...timing,
      payload: { via: 'http-action' },
    }));
    await appendAndPublish(log, hub, envelope);
    res.json({ success: true, event: envelope });
  }));

  app.post(`${ROUTE_PREFIX}/actions/inject-event`, ...writeGuards, asyncHandler(async (req, res) => {
    const eventType = req.body?.event_type;
    if (!Object.values(EVENT_TYPES).includes(eventType)) throw badRequest(`Unknown event_type: ${eventType}`);
    const timing = await actionTiming(log, SOURCE, req.body?.experience || EXPERIENCE);
    const envelope = buildActionEnvelope(() => createEnvelope({
      eventType,
      severity: req.body?.severity || SEVERITIES.INFO,
      source: actionSource(SOURCE),
      experience: req.body?.experience || EXPERIENCE,
      ref: req.body?.ref || null,
      ...timing,
      payload: req.body?.payload || {},
    }));
    await appendAndPublish(log, hub, envelope);
    res.json({ success: true, event: envelope });
  }));

  const producer = await startProducer({
    label: LABEL,
    routePrefix: ROUTE_PREFIX,
    config,
    producer: SOURCE === 'sim'
      ? new StoreActivityProducer({ log, hub, seed: SEED, experience: EXPERIENCE, tableCount: TABLE_COUNT })
      : null,
  });

  start({ port: PORT, producer });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
