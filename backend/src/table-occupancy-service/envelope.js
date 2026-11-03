/*
 * Copyright (c) 2026 Intel Corporation
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Envelope for the table occupancy service: table state events only.

const { defineEnvelope, SEVERITIES, SOURCES } = require('../service-common/envelope');

const EVENT_TYPES = Object.freeze({
  TABLE_OCCUPIED: 'table.occupied',
  TABLE_DIRTY: 'table.dirty',
  TABLE_CLEARED: 'table.cleared',
});

const { createEnvelope, validateEnvelope } = defineEnvelope({ eventTypes: EVENT_TYPES });

module.exports = { EVENT_TYPES, SEVERITIES, SOURCES, createEnvelope, validateEnvelope };
