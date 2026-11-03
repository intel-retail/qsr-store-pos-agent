/*
 * Copyright (c) 2026 Intel Corporation
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Envelope for the store activity service: customer, order, table and queue events.

const { defineEnvelope, SEVERITIES, SOURCES } = require('../service-common/envelope');

const EVENT_TYPES = Object.freeze({
  CUSTOMER_ARRIVED: 'customer.arrived',
  CUSTOMER_DEPARTED: 'customer.departed',
  TABLE_OCCUPIED: 'table.occupied',
  TABLE_DIRTY: 'table.dirty',
  TABLE_CLEARED: 'table.cleared',
  ORDER_PLACED: 'order.placed',
  ORDER_COMPLETED: 'order.completed',
  QUEUE_DEPTH_CHANGED: 'queue.depth_changed',
});

const { createEnvelope, validateEnvelope } = defineEnvelope({ eventTypes: EVENT_TYPES });

module.exports = { EVENT_TYPES, SEVERITIES, SOURCES, createEnvelope, validateEnvelope };
