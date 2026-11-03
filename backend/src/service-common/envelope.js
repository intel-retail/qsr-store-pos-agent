/*
 * Copyright (c) 2026 Intel Corporation
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Standard event envelope contract shared by every service (issue #100/#101).
// Each service supplies its own event-type enum (and optional payload rules)
// through defineEnvelope(); severities, sources and the field validation are common.

const { v4: uuidv4 } = require('uuid');

const SEVERITIES = Object.freeze({
  INFO: 'info',
  WARNING: 'warning',
  CRITICAL: 'critical',
});

const SOURCES = Object.freeze(['sim', 'real']);

// Column widths of the event log tables (VARCHAR sizes in each eventLog init()).
const MAX_EXPERIENCE_LENGTH = 20;
const MAX_REF_LENGTH = 100;
const MAX_SEED_LENGTH = 200;

// The event_id column is UUID; anything else would surface as a database error (500) instead of a 400.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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

function assertBoundedString(value, fieldName, maxLength, { required }) {
  if (value == null) {
    if (required) throw new Error(`${fieldName} is required`);
    return;
  }
  if (typeof value !== 'string' || (required && !value)) {
    throw new Error(`${fieldName} must be a${required ? ' non-empty' : ''} string`);
  }
  if (value.length > maxLength) {
    throw new Error(`${fieldName} must be at most ${maxLength} characters`);
  }
}

function assertPayloadObject(payload) {
  if (payload == null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('payload must be an object');
  }
}

function assertTimestamp(value) {
  if (!value || Number.isNaN(new Date(value).getTime())) {
    throw new Error('occurred_at is required and must be an ISO-8601 timestamp');
  }
}

/**
 * Builds createEnvelope/validateEnvelope for one service's event-type enum.
 * `validatePayload(eventType, payload)` (optional) throws on a malformed
 * payload, so bad events are rejected at the boundary instead of silently
 * skewing aggregates later.
 */
function defineEnvelope({ eventTypes, validatePayload = null }) {
  const knownTypes = Object.values(eventTypes);

  function assertKnownEventType(eventType) {
    if (!knownTypes.includes(eventType)) {
      throw new Error(`Unknown event_type: ${eventType}`);
    }
  }

  function assertCommon({ eventType, severity, source, experience, ref, seed, payload }) {
    assertKnownEventType(eventType);
    assertKnownSeverity(severity);
    assertKnownSource(source);
    assertBoundedString(experience, 'experience', MAX_EXPERIENCE_LENGTH, { required: true });
    assertBoundedString(ref, 'ref', MAX_REF_LENGTH, { required: false });
    assertBoundedString(seed, 'seed', MAX_SEED_LENGTH, { required: false });
    assertPayloadObject(payload);
    if (validatePayload) validatePayload(eventType, payload);
  }

  /**
   * Build a validated envelope. Throws on unknown event_type/severity/source so bad
   * events never reach the log or the hub. Pass `eventId` for deterministic,
   * reproducible ids (e.g. schedule-generated events); omitted for one-off
   * actions, which get a random uuidv4.
   */
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
    assertCommon({ eventType, severity, source, experience, ref, seed, payload });
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

  /**
   * Validate an externally-supplied envelope (SOURCE=real ingest) against the
   * same contract createEnvelope() enforces, without minting a new event_id —
   * the caller owns that for retry/dedup purposes. Normalizes missing optional
   * fields to null (pg does not coerce `undefined`).
   */
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

    if (!eventId || typeof eventId !== 'string' || !UUID_PATTERN.test(eventId)) {
      throw new Error('event_id is required and must be a UUID');
    }
    assertCommon({ eventType, severity, source, experience, ref, seed, payload: payload ?? {} });
    assertTimestamp(occurredAt);
    assertSimDate(simDate, 'sim_date');

    return {
      event_id: eventId,
      event_type: eventType,
      severity,
      source,
      experience,
      ref: ref ?? null,
      occurred_at: new Date(occurredAt).toISOString(),
      sim_date: simDate,
      seed: seed ?? null,
      payload: payload ?? {},
    };
  }

  return { EVENT_TYPES: eventTypes, createEnvelope, validateEnvelope };
}

/** Validates an optional YYYY-MM-DD filter (undefined/empty passes through) so bad input fails clearly instead of as a database error. */
function optionalSimDate(value, fieldName) {
  if (value == null || value === '') return undefined;
  assertSimDate(value, fieldName);
  return value;
}

module.exports = { SEVERITIES, SOURCES, assertSimDate, optionalSimDate, defineEnvelope };
