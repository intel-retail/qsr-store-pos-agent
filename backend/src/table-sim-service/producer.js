/*
 * Copyright (c) 2026 Intel Corporation
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Headless, deterministic table occupancy/cleaning producer. Reuses
// sim-service's generic RNG and envelope contract directly (no duplication);
// only the per-table renewal-process scheduling here is new.
//
// Unlike sim-service's café-day producer, each table runs its own
// independent occupied -> dirty -> cleared -> idle cycle with no overlap —
// a table is never "double-booked" — which is what makes utilization and
// dirty-duration stats meaningful for this service.

const { createSeededRng, deterministicUuid } = require('../sim-service/rng');
const { EVENT_TYPES, SEVERITIES, createEnvelope } = require('../sim-service/envelope');

// pg parses a DATE column into a Date built from local y/m/d components (not
// a UTC instant) — reading it back via toISOString() would shift the day
// whenever the process isn't running in UTC, so recover it with local getters.
function formatLocalDate(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const DAY_START_HOUR = 7;
const DAY_END_HOUR = 21;
// setTimeout delays beyond this silently fire almost immediately (32-bit signed
// int overflow) instead of waiting — clamp so a very low SIM_SPEED can't cause
// a burst of events/days to fire back-to-back instead of being paced.
const MAX_TIMEOUT_MS = 2_147_483_647;

// Cycle timing ranges, in ms.
const DWELL_MS = [900_000, 2700_000]; // 15-45 min occupied
const CLEANUP_MS = [300_000, 1200_000]; // 5-20 min dirty
const IDLE_MS = [300_000, 1800_000]; // 5-30 min clean/empty before next seating

class TableSimProducer {
  constructor({ log, hub = null, seed, experience = 'cafe', tableCount = 15 }) {
    if (!log) throw new Error('TableSimProducer requires a TableEventLog instance');
    if (!seed) throw new Error('TableSimProducer requires a seed');
    this.log = log;
    this.hub = hub;
    this.seed = seed;
    this.experience = experience;
    this.tableCount = Math.max(1, tableCount);
    this._timers = [];
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
    const dayStartMs = new Date(`${simDate}T00:00:00.000Z`).getTime() + DAY_START_HOUR * 3600_000;
    const dayEndMs = new Date(`${simDate}T00:00:00.000Z`).getTime() + DAY_END_HOUR * 3600_000;

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

  /** Bulk preload: append a full day, no pacing, no hub fanout. Safe to re-run (deterministic ids). */
  async materializeDay(simDate) {
    const schedule = this.generateSchedule(simDate);
    let inserted = 0;
    for (const envelope of schedule) {
      const saved = await this.log.append(envelope);
      if (saved) inserted++;
    }
    return { total: schedule.length, inserted, skipped: schedule.length - inserted };
  }

  /** Headless live production, paced by `speed` (60 = one sim-hour per real minute). */
  async runLive({ simDate = new Date().toISOString().slice(0, 10), speed = 60 } = {}) {
    const pacedSpeed = speed > 0 ? speed : 1;
    const schedule = this.generateSchedule(simDate);
    const dayStartMs = new Date(`${simDate}T00:00:00.000Z`).getTime() + DAY_START_HOUR * 3600_000;
    const startedAt = Date.now();

    // By the time a day-rollover invokes this again, the previous day's timers
    // have all already fired — drop the stale references instead of growing
    // this array forever across an indefinitely-running live process.
    this._timers = [];

    for (const envelope of schedule) {
      const offsetMs = new Date(envelope.occurred_at).getTime() - dayStartMs;
      const delayMs = Math.min(Math.max(0, offsetMs / pacedSpeed - (Date.now() - startedAt)), MAX_TIMEOUT_MS);
      const timer = setTimeout(() => {
        this.log.append(envelope)
          .then((saved) => { if (saved && this.hub) this.hub.publish(envelope); })
          .catch((err) => console.error('[TableSimProducer] Failed to append/publish live event:', err.message));
      }, delayMs);
      this._timers.push(timer);
    }

    // Live mode runs forever: roll over to the next calendar day once this
    // one's 24h (accelerated) span elapses, instead of silently going idle.
    this._scheduleNextDay(simDate, pacedSpeed, startedAt);

    return schedule.length;
  }

  /** Schedules the next calendar day's runLive() once a full accelerated day has elapsed. */
  _scheduleNextDay(simDate, pacedSpeed, startedAt) {
    const fullDayMs = 24 * 3600_000;
    const delayMs = Math.min(Math.max(0, fullDayMs / pacedSpeed - (Date.now() - startedAt)), MAX_TIMEOUT_MS);
    const timer = setTimeout(() => {
      const nextDate = new Date(`${simDate}T00:00:00.000Z`);
      nextDate.setUTCDate(nextDate.getUTCDate() + 1);
      this.runLive({ simDate: nextDate.toISOString().slice(0, 10), speed: pacedSpeed })
        .catch((err) => console.error('[TableSimProducer] Failed to roll over to next day:', err.message));
    }, delayMs);
    this._timers.push(timer);
  }

  /** Replay = log playback, not regeneration. Re-emits recorded events to the hub at original relative spacing. */
  async runReplay({ simDate, speed = 60 } = {}) {
    const pacedSpeed = speed > 0 ? speed : 1;
    const recorded = await this.log.replayDay({ experience: this.experience, simDate });
    if (recorded.length === 0) {
      console.warn(`[TableSimProducer] No recorded events for ${simDate}; nothing to replay.`);
      return 0;
    }

    const t0 = new Date(recorded[0].occurred_at).getTime();
    const startedAt = Date.now();

    for (const row of recorded) {
      const offsetMs = new Date(row.occurred_at).getTime() - t0;
      const delayMs = Math.max(0, offsetMs / pacedSpeed - (Date.now() - startedAt));
      const timer = setTimeout(() => {
        try {
          if (this.hub) this.hub.publish(this._rowToEnvelope(row));
        } catch (err) {
          console.error('[TableSimProducer] Failed to publish replay event:', err.message);
        }
      }, delayMs);
      this._timers.push(timer);
    }

    return recorded.length;
  }

  _rowToEnvelope(row) {
    return {
      event_id: row.event_id,
      event_type: row.event_type,
      severity: row.severity,
      source: row.source,
      experience: row.experience,
      ref: row.ref,
      occurred_at: row.occurred_at instanceof Date ? row.occurred_at.toISOString() : row.occurred_at,
      sim_date: row.sim_date instanceof Date ? formatLocalDate(row.sim_date) : row.sim_date,
      seed: row.seed,
      payload: row.payload,
    };
  }

  stop() {
    this._timers.forEach(clearTimeout);
    this._timers = [];
  }
}

module.exports = { TableSimProducer };
