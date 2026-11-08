/*
 * Copyright (c) 2026 Intel Corporation
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Headless runner for the footfall service. Standalone process/port. Shares
// the hub (SSE + MQTT) and HTTP skeleton via service-common; owns its own
// log/producer/envelope.

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const { FootfallEventLog } = require('./eventLog');
const { EventHub } = require('../service-common/hub');
const { attachAgentForwarder } = require('../service-common/agentForwarder');
const { FootfallProducer } = require('./producer');
const { EVENT_TYPES, validateEnvelope } = require('./envelope');
const { loadCommonConfig, envInt, parseCorsOrigins } = require('../service-common/config');
const { createServiceApp, startProducer, asyncHandler, queryString, queryDate } = require('../service-common/serviceApp');

const LABEL = 'footfall-service';
const ROUTE_PREFIX = '/footfall';

const config = loadCommonConfig();
const { SOURCE, BENCHMARK, EXPERIENCE, SEED } = config;
const PORT = envInt('FOOTFALL_SIM_PORT', 3300, { min: 1, max: 65535 });
// Unset by default (open, matching prior behavior) — set to require X-Api-Key on writes.
const API_KEY = process.env.FOOTFALL_SIM_API_KEY || null;

const FOOTFALL_EVENT_TYPE_DESCRIPTIONS = {
  [EVENT_TYPES.FOOTFALL_COUNT]: 'Number of people observed in a zone during a 15-minute interval.',
  [EVENT_TYPES.ZONE_DENSITY_CHANGED]: "A zone's density level (low/medium/high) changed.",
};

async function main() {
  const log = new FootfallEventLog();
  await log.init();

  const hub = new EventHub({ enabled: !BENCHMARK, mqttTopicPrefix: 'footfall-sim' });
  hub.connectMqtt();
  attachAgentForwarder({
    hub, label: LABEL, service: LABEL, config,
    defaultEventTypes: [EVENT_TYPES.ZONE_DENSITY_CHANGED],
    defaultFilter: (e) => e.payload?.density === 'high',
  });

  const { app, start } = createServiceApp({
    label: LABEL,
    routePrefix: ROUTE_PREFIX,
    portEnv: 'FOOTFALL_SIM_PORT',
    config,
    apiKey: API_KEY,
    corsOrigins: parseCorsOrigins('FOOTFALL_SIM_CORS_ORIGIN', LABEL),
    log,
    hub,
    validateEnvelope,
    refRequired: true,
  });

  // Plain-HTTP mirrors of the MCP read tools (no action tools — this service is read-only by design).
  app.get(`${ROUTE_PREFIX}/event-types`, (req, res) => {
    res.json(Object.entries(FOOTFALL_EVENT_TYPE_DESCRIPTIONS).map(([event_type, description]) => ({ event_type, description })));
  });

  const filters = (q) => ({
    experience: queryString(q.experience, 'experience') || EXPERIENCE,
    zone: queryString(q.zone, 'zone'),
    startDate: queryDate(q.start_date, 'start_date'),
    endDate: queryDate(q.end_date, 'end_date'),
  });

  app.get(`${ROUTE_PREFIX}/total`, asyncHandler(async (req, res) => {
    res.json(await log.getTotalFootfall(filters(req.query)));
  }));

  app.get(`${ROUTE_PREFIX}/busy-patterns`, asyncHandler(async (req, res) => {
    res.json(await log.getBusyTimePatterns(filters(req.query)));
  }));

  const producer = await startProducer({
    label: LABEL,
    routePrefix: ROUTE_PREFIX,
    config,
    producer: SOURCE === 'sim'
      ? new FootfallProducer({ log, hub, seed: SEED, experience: EXPERIENCE })
      : null,
  });

  start({ port: PORT, producer });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
