/*
 * Copyright (c) 2026 Intel Corporation
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Headless, deterministic table occupancy/cleaning producer. Uses the shared
// RNG and scheduling base; only the per-table renewal-process scheduling here
// is specific to this service.
//
// Unlike the store-activity producer's café-day model, each table runs its own
// independent occupied -> dirty -> cleared -> idle cycle with no overlap — a
// table is never "double-booked" — which is what makes utilization and
// dirty-duration stats meaningful for this service.

const { createSeededRng, deterministicUuid } = require('../service-common/rng');
const { ScheduledProducer, dayBounds } = require('../service-common/producer');
const { EVENT_TYPES, SEVERITIES, createEnvelope } = require('./envelope');

// Cycle timing ranges, in ms.
const DWELL_MS = [900_000, 2700_000]; // 15-45 min occupied
const CLEANUP_MS = [300_000, 1200_000]; // 5-20 min dirty
const IDLE_MS = [300_000, 1800_000]; // 5-30 min clean/empty before next seating

class TableOccupancyProducer extends ScheduledProducer {
  constructor({ log, hub = null, seed, experience = 'cafe', tableCount = 15 }) {
    super({ label: 'TableOccupancyProducer', log, hub, seed, experience });
    this.tableCount = Math.max(1, tableCount);
  }

  _randRange(rng, [min, max]) {
    return min + Math.floor(rng() * (max - min));
  }

  /**
   * Pure function: same seed + simDate always produces the same ordered
   * per-table cycles. Each table gets its own RNG stream so tables don't
   * lock-step, but the whole schedule is still fully reproducible.
   */
  generateSchedule(simDate) {
    const { dayStartMs, dayEndMs } = dayBounds(simDate);

    const raw = [];
    for (let tableId = 1; tableId <= this.tableCount; tableId++) {
      const tableRef = `table-${tableId}`;
      const rng = createSeededRng(this.seed, `${this.experience}:${simDate}:${tableRef}`);

      // Stagger each table's first cycle so they don't all turn over in lockstep.
      let cursor = dayStartMs + this._randRange(rng, IDLE_MS);
      let cycle = 0;

      while (cursor < dayEndMs) {
        const occupiedAt = cursor;
        const dirtyAt = occupiedAt + this._randRange(rng, DWELL_MS);
        const clearedAt = dirtyAt + this._randRange(rng, CLEANUP_MS);

        raw.push({ offsetMs: occupiedAt - dayStartMs, eventType: EVENT_TYPES.TABLE_OCCUPIED, ref: tableRef, payload: {}, cycle });
        raw.push({ offsetMs: dirtyAt - dayStartMs, eventType: EVENT_TYPES.TABLE_DIRTY, ref: tableRef, payload: {}, cycle });
        raw.push({ offsetMs: clearedAt - dayStartMs, eventType: EVENT_TYPES.TABLE_CLEARED, ref: tableRef, payload: {}, cycle });

        cursor = clearedAt + this._randRange(rng, IDLE_MS);
        cycle++;
      }
    }

    raw.sort((a, b) => a.offsetMs - b.offsetMs);

    return raw.map((e) => createEnvelope({
      eventId: deterministicUuid(`${this.seed}:${this.experience}:${simDate}:${e.ref}:${e.eventType}:${e.cycle}`),
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

module.exports = { TableOccupancyProducer };
