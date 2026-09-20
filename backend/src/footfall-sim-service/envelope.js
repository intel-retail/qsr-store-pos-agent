/*
 * Copyright (c) 2026 Intel Corporation
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Envelope for the footfall/movement sim service. Mirrors sim-service's
// envelope.js shape and validation exactly, but with its own event_type enum
// — sim-service's createEnvelope()/validateEnvelope() hard-validate against
// its own fixed EVENT_TYPES (no footfall/density in it) and can't be
// parameterized without modifying that file, so this can't just import it.
// SEVERITIES/SOURCES *are* generic and are reused as-is.

const { v4: uuidv4 } = require('uuid');
const { SEVERITIES, SOURCES } = require('../sim-service/envelope');

const EVENT_TYPES = Object.freeze({
  FOOTFALL_COUNT: 'footfall.count',
  ZONE_DENSITY_CHANGED: 'zone.density_changed',
});

// Small single-purpose assertions so createEnvelope/validateEnvelope each stay
// a short list of calls instead of one large branchy function (keeps cyclomatic
// complexity low per function).
function assertKnownEventType(eventType) {
  if (!Object.values(EVENT_TYPES).includes(eventType)) {
    throw new Error(`Unknown event_type: ${eventType}`);
  }
}

function assertKnownSeverity(severity) {
  if (!Object.values(SEVERITIES).includes(severity)) {
    throw new Error(`Unknown severity: ${severity}`);
  }
}

function assertKnownSource(source) {
  if (!SOURCES.includes(source)) {
    throw new Error(`source must be one of: ${SOURCES.join(', ')}`);
  }
}

function assertSimDate(simDate, fieldName = 'simDate') {
  const match = typeof simDate === 'string' && simDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const [, year, month, day] = match ? match.map(Number) : [];
  // Date.UTC rolls invalid days over into the next month (e.g. Feb 30 -> Mar 2)
  // instead of rejecting them, so round-trip the parsed value to catch that.
  const parsed = match ? new Date(Date.UTC(year, month - 1, day)) : null;
  const isRealCalendarDate = parsed != null
    && parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
  if (!isRealCalendarDate) {
    throw new Error(`${fieldName} is required and must be YYYY-MM-DD`);
  }
}

/** Same contract as sim-service's createEnvelope, validated against the enum above. */
function createEnvelope({
  eventId,
  eventType,
  severity = SEVERITIES.INFO,
  source = 'sim',
  experience,
  ref = null,
  occurredAt,
  simDate,
  seed = null,
  payload = {},
}) {
  assertKnownEventType(eventType);
  assertKnownSeverity(severity);
  assertKnownSource(source);
  if (!experience) {
    throw new Error('experience is required');
  }
  assertSimDate(simDate);

  return {
    event_id: eventId || uuidv4(),
    event_type: eventType,
    severity,
    source,
    experience,
    ref,
    occurred_at: occurredAt || new Date().toISOString(),
    sim_date: simDate,
    seed,
    payload,
  };
}

/** Same contract as sim-service's validateEnvelope, for the SOURCE=real ingestion path. */
function validateEnvelope(input) {
  if (!input || typeof input !== 'object') {
    throw new Error('Envelope must be an object');
  }
  const {
    event_id: eventId,
    event_type: eventType,
    severity = SEVERITIES.INFO,
    source = 'sim',
    experience,
    ref = null,
    occurred_at: occurredAt,
    sim_date: simDate,
    seed = null,
    payload = {},
  } = input;

  if (!eventId || typeof eventId !== 'string') {
    throw new Error('event_id is required');
  }
  assertKnownEventType(eventType);
  assertKnownSeverity(severity);
  assertKnownSource(source);
  if (!experience) {
    throw new Error('experience is required');
  }
  if (!occurredAt) {
    throw new Error('occurred_at is required');
  }
  assertSimDate(simDate, 'sim_date');

  return {
    event_id: eventId,
    event_type: eventType,
    severity,
    source,
    experience,
    ref: ref ?? null,
    occurred_at: occurredAt,
    sim_date: simDate,
    seed: seed ?? null,
    payload: payload ?? {},
  };
}

module.exports = { EVENT_TYPES, SEVERITIES, SOURCES, createEnvelope, validateEnvelope };
