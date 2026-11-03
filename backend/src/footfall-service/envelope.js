/*
 * Copyright (c) 2026 Intel Corporation
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Envelope for the footfall service: zone counts and density changes.

const { defineEnvelope, SEVERITIES, SOURCES } = require('../service-common/envelope');

const EVENT_TYPES = Object.freeze({
  FOOTFALL_COUNT: 'footfall.count',
  ZONE_DENSITY_CHANGED: 'zone.density_changed',
});

const DENSITY_LEVELS = Object.freeze(['low', 'medium', 'high']);

const isCount = (n) => Number.isInteger(n) && n >= 0;

// Aggregates sum payload.count, so reject malformed counts at the boundary
// instead of letting them silently undercount.
function validatePayload(eventType, payload) {
  if (!isCount(payload.count)) {
    throw new Error('payload.count must be a non-negative integer');
  }
  if (eventType === EVENT_TYPES.ZONE_DENSITY_CHANGED) {
    if (!DENSITY_LEVELS.includes(payload.density)) {
      throw new Error(`payload.density must be one of: ${DENSITY_LEVELS.join(', ')}`);
    }
    if (!Number.isInteger(payload.capacity) || payload.capacity <= 0) {
      throw new Error('payload.capacity must be a positive integer');
    }
  }
}

const { createEnvelope, validateEnvelope } = defineEnvelope({ eventTypes: EVENT_TYPES, validatePayload });

module.exports = { EVENT_TYPES, DENSITY_LEVELS, SEVERITIES, SOURCES, createEnvelope, validateEnvelope };
