/*
 * Copyright (c) 2026 Intel Corporation
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Shared scheduling/pacing for the deterministic producers. A subclass only
// implements generateSchedule(simDate) — a pure function of (seed, experience,
// simDate) returning ordered envelopes — and inherits bulk preload, paced
// live runs with day rollover, and log replay.

const DAY_START_HOUR = 7;
const DAY_END_HOUR = 21;
// setTimeout delays beyond this silently fire almost immediately (32-bit signed
// int overflow) instead of waiting — clamp so a very low SIM_SPEED can't cause
// a burst of events/days to fire back-to-back instead of being paced.
const MAX_TIMEOUT_MS = 2_147_483_647;

// pg parses a DATE column into a Date built from local y/m/d components (not
// a UTC instant) — reading it back via toISOString() would shift the day
// whenever the process isn't running in UTC, so recover it with local getters.
function formatLocalDate(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Converts a raw DB row back into wire-format envelope fields (dates as strings). */
function rowToWireEnvelope(row) {
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

/** UTC start/end of the simulated trading day for a YYYY-MM-DD date. */
function dayBounds(simDate) {
  const midnightMs = new Date(`${simDate}T00:00:00.000Z`).getTime();
  return {
    dayStartMs: midnightMs + DAY_START_HOUR * 3600_000,
    dayEndMs: midnightMs + DAY_END_HOUR * 3600_000,
  };
}

function delayFor(offsetMs, pacedSpeed, startedAt) {
  return Math.min(Math.max(0, offsetMs / pacedSpeed - (Date.now() - startedAt)), MAX_TIMEOUT_MS);
}

class ScheduledProducer {
  constructor({ label, log, hub = null, seed, experience = 'cafe' }) {
    if (!log) throw new Error(`${label} requires an event log instance`);
    if (!seed) throw new Error(`${label} requires a seed`);
    this.label = label;
    this.log = log;
    this.hub = hub;
    this.seed = seed;
    this.experience = experience;
    this._timers = [];
  }

  /** Pure: the same (seed, experience, simDate) must always return the same ordered envelopes. */
  generateSchedule() {
    throw new Error('generateSchedule() must be implemented by the producer');
  }

  /**
   * Bulk preload: append a full day to the durable log, no pacing, no hub
   * fanout. Safe to call repeatedly for the same day — deterministic ids mean
   * re-running this only backfills gaps, it never duplicates.
   */
  async materializeDay(simDate) {
    const schedule = this.generateSchedule(simDate);
    const inserted = await this.log.appendMany(schedule);
    return { total: schedule.length, inserted, skipped: schedule.length - inserted };
  }

  /**
   * Headless live production: walks the schedule for simDate, appending +
   * publishing each event as its (accelerated) time arrives. `speed` is a
   * multiplier — 60 means one sim-hour passes per real minute.
   *
   * With `resume`, the sim clock continues from the newest stored event (never
   * backwards across restarts): later events are published as they come due, and
   * earlier ones are only backfilled into the log, never re-published.
   */
  async runLive({ simDate = new Date().toISOString().slice(0, 10), speed = 60, resume = false } = {}) {
    const pacedSpeed = speed > 0 ? speed : 1; // guard against 0/negative speed silently firing everything at once
    let tailMs = -Infinity;
    if (resume) {
      const latest = await this.log.latestEvent({ experience: this.experience });
      if (latest) {
        tailMs = new Date(latest.occurred_at).getTime();
        if (latest.sim_date > simDate) simDate = latest.sim_date;
      }
    }
    const schedule = this.generateSchedule(simDate);
    const { dayStartMs } = dayBounds(simDate);
    const startedAt = Date.now() - Math.max(0, tailMs - dayStartMs) / pacedSpeed;

    // Events at the tail instant still go through append(), which skips stored ids, so a crash between simultaneous appends loses no sibling.
    const isStored = (envelope) => new Date(envelope.occurred_at).getTime() < tailMs;
    const stored = schedule.filter(isStored);
    const pending = schedule.filter((e) => !isStored(e));
    if (stored.length > 0) await this.log.appendMany(stored);

    // By the time a day-rollover invokes this again, the previous day's timers
    // have all already fired — drop the stale references instead of growing
    // this array forever across an indefinitely-running live process.
    this._timers = [];

    for (const envelope of pending) {
      const offsetMs = new Date(envelope.occurred_at).getTime() - dayStartMs;
      const timer = setTimeout(() => {
        this.log.append(envelope)
          .then((saved) => { if (saved && this.hub) this.hub.publish(envelope); })
          .catch((err) => console.error(`[${this.label}] Failed to append/publish live event:`, err.message));
      }, delayFor(offsetMs, pacedSpeed, startedAt));
      this._timers.push(timer);
    }

    // Live mode runs forever: roll over to the next calendar day once this
    // one's 24h (accelerated) span elapses, instead of silently going idle.
    this._scheduleNextDay(simDate, pacedSpeed, startedAt);

    return pending.length;
  }

  /** Schedules the next calendar day's runLive() once a full accelerated day has elapsed. */
  _scheduleNextDay(simDate, pacedSpeed, startedAt) {
    const timer = setTimeout(() => {
      const nextDate = new Date(`${simDate}T00:00:00.000Z`);
      nextDate.setUTCDate(nextDate.getUTCDate() + 1);
      this.runLive({ simDate: nextDate.toISOString().slice(0, 10), speed: pacedSpeed })
        .catch((err) => console.error(`[${this.label}] Failed to roll over to next day:`, err.message));
    }, delayFor(24 * 3600_000, pacedSpeed, startedAt));
    this._timers.push(timer);
  }

  /**
   * Replay = event-log playback, not re-running the producer. Re-emits the
   * events already recorded for simDate to the hub in order, at their original
   * relative spacing (scaled by `speed`). Nothing is re-appended to the log.
   */
  async runReplay({ simDate, speed = 60 } = {}) {
    const pacedSpeed = speed > 0 ? speed : 1;
    const recorded = await this.log.replayDay({ experience: this.experience, simDate });
    if (recorded.length === 0) {
      console.warn(`[${this.label}] No recorded events for ${simDate}; nothing to replay.`);
      return 0;
    }

    const t0 = new Date(recorded[0].occurred_at).getTime();
    const startedAt = Date.now();

    for (const row of recorded) {
      const offsetMs = new Date(row.occurred_at).getTime() - t0;
      const timer = setTimeout(() => {
        try {
          if (this.hub) this.hub.publish(rowToWireEnvelope(row));
        } catch (err) {
          console.error(`[${this.label}] Failed to publish replay event:`, err.message);
        }
      }, delayFor(offsetMs, pacedSpeed, startedAt));
      this._timers.push(timer);
    }

    return recorded.length;
  }

  stop() {
    this._timers.forEach(clearTimeout);
    this._timers = [];
  }
}

module.exports = { ScheduledProducer, dayBounds, formatLocalDate, rowToWireEnvelope };
