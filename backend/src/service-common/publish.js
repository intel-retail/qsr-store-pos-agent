/*
 * Copyright (c) 2026 Intel Corporation
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Append-then-publish path shared by HTTP ingest, HTTP action routes and MCP action tools.

const { todayUtc } = require('./config');

/** Appends to the durable log, then fans out via the hub; returns the saved row or null for a duplicate event_id. */
async function appendAndPublish(log, hub, envelope) {
  const saved = await log.append(envelope);
  if (saved) hub.publish(envelope);
  return saved;
}

/**
 * simDate/occurredAt for an action-created event. A real source uses the wall clock; a sim
 * stamps the simulation clock (the latest logged event), since accelerated live mode runs
 * ahead of today's date and wall-clock stamps would sort before the sim's own events.
 */
async function actionTiming(log, source, experience) {
  const latest = source === 'real' ? null : await log.latestEvent({ experience });
  if (!latest) return { simDate: todayUtc() };
  return { simDate: latest.sim_date, occurredAt: new Date(latest.occurred_at).toISOString() };
}

/** "Now" in ms: wall clock for a real source, the latest logged event for a sim (see actionTiming). */
async function currentTimeMs(log, source, experience) {
  const latest = source === 'real' ? null : await log.latestEvent({ experience });
  return latest ? new Date(latest.occurred_at).getTime() : Date.now();
}

/** Envelope `source` for events created by an action or injection (a real pipeline's actions are 'real'). */
function actionSource(source) {
  return source === 'real' ? 'real' : 'sim';
}

module.exports = { appendAndPublish, actionSource, actionTiming, currentTimeMs };
