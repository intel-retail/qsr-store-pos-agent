/*
 * Copyright (c) 2026 Intel Corporation
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Headless runner for the table occupancy service. Standalone process/port,
// independent of backend/src/server.js and of the other services. Shares the
// hub (SSE + MQTT) and HTTP skeleton via service-common; owns its own log,
// envelope contract and producer.

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const { TableEventLog } = require('./eventLog');
const { EventHub } = require('../service-common/hub');
const { attachAgentForwarder } = require('../service-common/agentForwarder');
const { TableOccupancyProducer } = require('./producer');
const { EVENT_TYPES, SEVERITIES, createEnvelope, validateEnvelope } = require('./envelope');
const { loadCommonConfig, loadTableCount, envInt, parseCorsOrigins } = require('../service-common/config');
const { createServiceApp, startProducer, asyncHandler, badRequest, queryString, queryDate, queryLimit } = require('../service-common/serviceApp');
const { appendAndPublish, actionSource, actionTiming, currentTimeMs } = require('../service-common/publish');

const LABEL = 'table-occupancy-service';
const ROUTE_PREFIX = '/table-occupancy';

const config = loadCommonConfig();
const { SOURCE, BENCHMARK, EXPERIENCE, SEED } = config;
const PORT = envInt('TABLE_SIM_PORT', 3200, { min: 1, max: 65535 });
const TABLE_COUNT = loadTableCount();
// Unset by default (open, matching prior behavior) — set to require X-Api-Key on writes.
const API_KEY = process.env.TABLE_SIM_API_KEY || null;

const TABLE_EVENT_TYPE_DESCRIPTIONS = {
  [EVENT_TYPES.TABLE_OCCUPIED]: 'A table was seated by a dine-in customer.',
  [EVENT_TYPES.TABLE_DIRTY]: 'A table was vacated and needs clearing.',
  [EVENT_TYPES.TABLE_CLEARED]: 'A table was cleared and is available again.',
};

async function main() {
  const log = new TableEventLog();
  await log.init();

  const hub = new EventHub({ enabled: !BENCHMARK, mqttTopicPrefix: 'table-sim' });
  hub.connectMqtt();

  // Optional: forward only when the dirty-table count first reaches QSR_AGENT_DIRTY_MIN_TABLES (0 = every table.dirty).
  // Seeded from the log so a restart does not undercount.
  const dirtyTables = new Set(await log.getDirtyTableRefs({ experience: EXPERIENCE }));
  hub.on('event', (e) => {
    if (e.event_type === EVENT_TYPES.TABLE_DIRTY) dirtyTables.add(e.ref);
    else if (e.event_type === EVENT_TYPES.TABLE_CLEARED || e.event_type === EVENT_TYPES.TABLE_OCCUPIED) dirtyTables.delete(e.ref);
  });
  const dirtyThreshold = envInt('QSR_AGENT_DIRTY_MIN_TABLES', 0, { min: 0 });
  attachAgentForwarder({
    hub, label: LABEL, service: LABEL, config,
    defaultEventTypes: [EVENT_TYPES.TABLE_DIRTY],
    defaultFilter: () => dirtyThreshold === 0 || dirtyTables.size === dirtyThreshold,
  });

  const { app, writeGuards, buildActionEnvelope, start } = createServiceApp({
    label: LABEL,
    routePrefix: ROUTE_PREFIX,
    portEnv: 'TABLE_SIM_PORT',
    config,
    apiKey: API_KEY,
    corsOrigins: parseCorsOrigins('TABLE_SIM_CORS_ORIGIN', LABEL),
    log,
    hub,
    validateEnvelope,
    refRequired: true,
  });

  // Plain-HTTP mirrors of the MCP read tools, for clients that can't spawn an
  // MCP stdio process (browsers, curl, monitoring tools).
  app.get(`${ROUTE_PREFIX}/event-types`, (req, res) => {
    res.json(Object.entries(TABLE_EVENT_TYPE_DESCRIPTIONS).map(([event_type, description]) => ({ event_type, description })));
  });

  const statsFilters = (q) => ({
    experience: queryString(q.experience, 'experience') || EXPERIENCE,
    tableRef: queryString(q.table_ref, 'table_ref'),
    startDate: queryDate(q.start_date, 'start_date'),
    endDate: queryDate(q.end_date, 'end_date'),
  });

  app.get(`${ROUTE_PREFIX}/utilization`, asyncHandler(async (req, res) => {
    const filters = statsFilters(req.query);
    const nowMs = await currentTimeMs(log, SOURCE, filters.experience);
    res.json(await log.getUtilization({ ...filters, nowMs }));
  }));

  app.get(`${ROUTE_PREFIX}/dirty-duration`, asyncHandler(async (req, res) => {
    const filters = statsFilters(req.query);
    const nowMs = await currentTimeMs(log, SOURCE, filters.experience);
    res.json(await log.getDirtyDurationStats({ ...filters, nowMs }));
  }));

  app.get(`${ROUTE_PREFIX}/history`, asyncHandler(async (req, res) => {
    const tableRef = queryString(req.query.table_ref, 'table_ref');
    if (!tableRef) throw badRequest('table_ref is required');
    res.json(await log.getTableHistory({
      experience: queryString(req.query.experience, 'experience') || EXPERIENCE,
      tableRef,
      limit: queryLimit(req.query.limit, 100),
    }));
  }));

  // Plain-HTTP mirrors of the MCP action tools, same envelope/log/hub path.
  const markTable = (eventType) => asyncHandler(async (req, res) => {
    const tableRef = req.body?.table_ref;
    if (!tableRef) throw badRequest('table_ref is required');
    const timing = await actionTiming(log, SOURCE, req.body?.experience || EXPERIENCE);
    const envelope = buildActionEnvelope(() => createEnvelope({
      eventType,
      severity: SEVERITIES.INFO,
      source: actionSource(SOURCE),
      experience: req.body?.experience || EXPERIENCE,
      ref: tableRef,
      ...timing,
      payload: { via: 'http-action' },
    }));
    await appendAndPublish(log, hub, envelope);
    res.json({ success: true, event: envelope });
  });

  app.post(`${ROUTE_PREFIX}/actions/mark-table-cleared`, ...writeGuards, markTable(EVENT_TYPES.TABLE_CLEARED));
  app.post(`${ROUTE_PREFIX}/actions/mark-table-occupied`, ...writeGuards, markTable(EVENT_TYPES.TABLE_OCCUPIED));

  const producer = await startProducer({
    label: LABEL,
    routePrefix: ROUTE_PREFIX,
    config,
    producer: SOURCE === 'sim'
      ? new TableOccupancyProducer({ log, hub, seed: SEED, experience: EXPERIENCE, tableCount: TABLE_COUNT })
      : null,
  });

  start({ port: PORT, producer });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
