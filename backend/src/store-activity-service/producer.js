/*
 * Copyright (c) 2026 Intel Corporation
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Headless, deterministic store-activity event producer. No browser/DOM
// dependency — this runs as a plain Node process. Every event traces back to a
// pure function of (seed, experience, simDate), so the same day always
// replays identically.

const { createSeededRng, deterministicUuid } = require('../service-common/rng');
const { ScheduledProducer, dayBounds } = require('../service-common/producer');
const { EVENT_TYPES, SEVERITIES, createEnvelope } = require('./envelope');

class StoreActivityProducer extends ScheduledProducer {
  constructor({ log, hub = null, seed, experience = 'cafe', tableCount = 15 }) {
    super({ label: 'StoreActivityProducer', log, hub, seed, experience });
    // A table count of 0 would otherwise still assign dine-in customers to a
    // phantom "table-1".
    this.tableCount = Math.max(1, tableCount);
  }

  /**
   * Seats dine-in customers in seating order at their preferred table, probing to the
   * next free one so a table is never double-booked. With every table busy the customer
   * is demoted to takeout, which keeps table.* events consistent with the occupancy service.
   */
  _assignTables(customers) {
    const busyUntil = new Array(this.tableCount).fill(-Infinity);
    const seatOffset = (c) => c.arriveOffset + Math.floor(c.orderDelayMs / 2);
    const diners = customers.filter((c) => c.dineIn).sort((a, b) => seatOffset(a) - seatOffset(b));

    for (const c of diners) {
      const seatAt = seatOffset(c);
      const probe = [...Array(this.tableCount).keys()].find((i) => busyUntil[(c.preferredTable + i) % this.tableCount] < seatAt);
      if (probe === undefined) {
        c.dineIn = false;
        continue;
      }
      const table = (c.preferredTable + probe) % this.tableCount;
      c.tableRef = `table-${table + 1}`;
      busyUntil[table] = c.arriveOffset + c.orderDelayMs + c.prepMs + c.dwellMs + c.cleanupMs;
    }
  }

  /**
   * Pure function: the same (seed, experience, simDate) always returns the same
   * ordered list of envelopes.
   */
  generateSchedule(simDate) {
    const rng = createSeededRng(this.seed, `${this.experience}:${simDate}`);
    const { dayStartMs, dayEndMs } = dayBounds(simDate);
    const spanMs = dayEndMs - dayStartMs;

    const customerCount = 40 + Math.floor(rng() * 80); // 40-119 customers/day
    const customers = [];

    for (let c = 0; c < customerCount; c++) {
      const customer = {
        ref: `${simDate}-cust-${c + 1}`,
        arriveOffset: Math.floor(rng() * spanMs),
        dineIn: rng() < 0.4,
      };
      customer.orderDelayMs = 30_000 + Math.floor(rng() * 90_000);
      customer.prepMs = 60_000 + Math.floor(rng() * 180_000);
      if (customer.dineIn) {
        customer.preferredTable = Math.floor(rng() * this.tableCount);
        customer.dwellMs = 300_000 + Math.floor(rng() * 900_000);
        customer.cleanupMs = 60_000 + Math.floor(rng() * 240_000);
      }
      customers.push(customer);
    }

    this._assignTables(customers);

    const raw = [];
    for (const { ref: customerRef, arriveOffset, dineIn, orderDelayMs, prepMs, dwellMs, cleanupMs, tableRef } of customers) {
      raw.push({ offsetMs: arriveOffset, eventType: EVENT_TYPES.CUSTOMER_ARRIVED, ref: customerRef, payload: { dineIn } });
      raw.push({ offsetMs: arriveOffset + orderDelayMs, eventType: EVENT_TYPES.ORDER_PLACED, ref: customerRef, payload: { dineIn } });
      raw.push({ offsetMs: arriveOffset + orderDelayMs + prepMs, eventType: EVENT_TYPES.ORDER_COMPLETED, ref: customerRef, payload: {} });

      if (dineIn) {
        const seatOffset = arriveOffset + Math.floor(orderDelayMs / 2);
        raw.push({ offsetMs: seatOffset, eventType: EVENT_TYPES.TABLE_OCCUPIED, ref: tableRef, payload: { customerRef } });

        const departOffset = arriveOffset + orderDelayMs + prepMs + dwellMs;
        raw.push({ offsetMs: departOffset, eventType: EVENT_TYPES.CUSTOMER_DEPARTED, ref: customerRef, payload: {} });
        raw.push({ offsetMs: departOffset, eventType: EVENT_TYPES.TABLE_DIRTY, ref: tableRef, payload: { customerRef } });
        raw.push({ offsetMs: departOffset + cleanupMs, eventType: EVENT_TYPES.TABLE_CLEARED, ref: tableRef, payload: {} });
      } else {
        const departOffset = arriveOffset + orderDelayMs + prepMs + 30_000;
        raw.push({ offsetMs: departOffset, eventType: EVENT_TYPES.CUSTOMER_DEPARTED, ref: customerRef, payload: {} });
      }
    }

    raw.sort((a, b) => a.offsetMs - b.offsetMs);

    // Derive queue depth as a running count of arrivals not yet order-completed.
    // Only emit queue.depth_changed when the depth actually moves.
    let queueDepth = 0;
    const withQueue = [];
    for (const e of raw) {
      withQueue.push(e);
      const previousDepth = queueDepth;
      if (e.eventType === EVENT_TYPES.CUSTOMER_ARRIVED) queueDepth++;
      if (e.eventType === EVENT_TYPES.ORDER_COMPLETED) queueDepth = Math.max(0, queueDepth - 1);
      if (queueDepth !== previousDepth) {
        withQueue.push({ offsetMs: e.offsetMs, eventType: EVENT_TYPES.QUEUE_DEPTH_CHANGED, ref: 'queue', payload: { depth: queueDepth } });
      }
    }
    withQueue.sort((a, b) => a.offsetMs - b.offsetMs);

    return withQueue.map((e, index) => createEnvelope({
      // Content-derived, not random: regenerating this schedule (restart, replay,
      // re-seed) always yields the same id for the same logical event.
      eventId: deterministicUuid(`${this.seed}:${this.experience}:${simDate}:${e.eventType}:${e.ref}:${e.offsetMs}:${index}`),
      eventType: e.eventType,
      severity: e.eventType === EVENT_TYPES.TABLE_DIRTY ? SEVERITIES.WARNING : SEVERITIES.INFO,
      source: 'sim',
      experience: this.experience,
      ref: e.ref,
      occurredAt: new Date(dayStartMs + e.offsetMs).toISOString(),
      simDate,
      seed: this.seed,
      payload: e.payload,
    }));
  }
}

module.exports = { StoreActivityProducer };
