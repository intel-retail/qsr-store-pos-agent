/*
 * Copyright (c) 2026 Intel Corporation
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Headless, deterministic event producer. No browser/DOM/Three.js dependency —
// this runs as a plain Node process. Every event traces back to a pure
// function of (seed, experience, simDate), so the same day always replays
// identically (acceptance criteria: seeded/deterministic inputs).

const { createSeededRng, deterministicUuid } = require('./rng');
const { EVENT_TYPES, SEVERITIES, createEnvelope } = require('./envelope');

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

class SimProducer {
  constructor({ log, hub = null, seed, experience = 'cafe', tableCount = 15 }) {
    if (!log) throw new Error('SimProducer requires a SimEventLog instance');
    if (!seed) throw new Error('SimProducer requires a seed');
    this.log = log;
    this.hub = hub;
    this.seed = seed;
    this.experience = experience;
    // A table count of 0 would otherwise still assign dine-in customers to a
    // phantom "table-1".
    this.tableCount = Math.max(1, tableCount);
    this._timers = [];
  }

  /**
   * Pure function: generateSchedule(seed, simDate) always returns the same
   * ordered list of envelopes. This is what "the same day replays
   * identically" means for a live (not log-replay) run.
   */
  generateSchedule(simDate) {
    const rng = createSeededRng(this.seed, `${this.experience}:${simDate}`);
    const dayStartMs = new Date(`${simDate}T00:00:00.000Z`).getTime() + DAY_START_HOUR * 3600_000;
    const dayEndMs = new Date(`${simDate}T00:00:00.000Z`).getTime() + DAY_END_HOUR * 3600_000;
    const spanMs = dayEndMs - dayStartMs;

    const customerCount = 40 + Math.floor(rng() * 80); // 40-119 customers/day
    const raw = [];

    for (let c = 0; c < customerCount; c++) {
      const arriveOffset = Math.floor(rng() * spanMs);
      const dineIn = rng() < 0.4;
      const customerRef = `${simDate}-cust-${c + 1}`;

      raw.push({ offsetMs: arriveOffset, eventType: EVENT_TYPES.CUSTOMER_ARRIVED, ref: customerRef, payload: { dineIn } });

      const orderDelayMs = 30_000 + Math.floor(rng() * 90_000);
      raw.push({ offsetMs: arriveOffset + orderDelayMs, eventType: EVENT_TYPES.ORDER_PLACED, ref: customerRef, payload: { dineIn } });

      const prepMs = 60_000 + Math.floor(rng() * 180_000);
      raw.push({ offsetMs: arriveOffset + orderDelayMs + prepMs, eventType: EVENT_TYPES.ORDER_COMPLETED, ref: customerRef, payload: {} });

      if (dineIn) {
        const tableId = 1 + Math.floor(rng() * this.tableCount);
        const tableRef = `table-${tableId}`;
        const seatOffset = arriveOffset + Math.floor(orderDelayMs / 2);
        raw.push({ offsetMs: seatOffset, eventType: EVENT_TYPES.TABLE_OCCUPIED, ref: tableRef, payload: { customerRef } });

        const dwellMs = 300_000 + Math.floor(rng() * 900_000);
        const departOffset = arriveOffset + orderDelayMs + prepMs + dwellMs;
        raw.push({ offsetMs: departOffset, eventType: EVENT_TYPES.CUSTOMER_DEPARTED, ref: customerRef, payload: {} });
        raw.push({ offsetMs: departOffset, eventType: EVENT_TYPES.TABLE_DIRTY, ref: tableRef, payload: { customerRef } });

        const cleanupMs = 60_000 + Math.floor(rng() * 240_000);
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

  /**
   * Bulk preload: append a full day to the durable log, no pacing, no hub
   * fanout. Safe to call repeatedly for the same day — deterministic ids mean
   * re-running this only backfills gaps, it never duplicates.
   */
  async materializeDay(simDate) {
    const schedule = this.generateSchedule(simDate);
    let inserted = 0;
    for (const envelope of schedule) {
      const saved = await this.log.append(envelope);
      if (saved) inserted++;
    }
    return { total: schedule.length, inserted, skipped: schedule.length - inserted };
  }

  /**
   * Headless live production: walks the deterministic schedule for simDate,
   * appending + publishing each event as its (accelerated) scheduled time
   * arrives. `speed` is a multiplier — 60 means one sim-hour passes per
   * real minute.
   */
  async runLive({ simDate = new Date().toISOString().slice(0, 10), speed = 60 } = {}) {
    const pacedSpeed = speed > 0 ? speed : 1; // guard against 0/negative speed silently firing everything at once
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
          .catch((err) => console.error('[SimProducer] Failed to append/publish live event:', err.message));
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
        .catch((err) => console.error('[SimProducer] Failed to roll over to next day:', err.message));
    }, delayMs);
    this._timers.push(timer);
  }

  /**
   * Replay = event-log playback, not re-running the producer. Reads events
   * already recorded for simDate and re-emits them to the hub in order, at
   * their original relative spacing (scaled by `speed`). Nothing is
   * re-appended to the log.
   */
  async runReplay({ simDate, speed = 60 } = {}) {
    const pacedSpeed = speed > 0 ? speed : 1;
    const recorded = await this.log.replayDay({ experience: this.experience, simDate });
    if (recorded.length === 0) {
      console.warn(`[SimProducer] No recorded events for ${simDate}; nothing to replay.`);
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
          console.error('[SimProducer] Failed to publish replay event:', err.message);
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

module.exports = { SimProducer };
