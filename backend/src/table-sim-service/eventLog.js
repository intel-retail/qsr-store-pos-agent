/*
 * Copyright (c) 2026 Intel Corporation
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Durable, ordered event log for the table occupancy & cleaning sim service.
// Deliberately its own table (table_sim_events) rather than sim-service's
// sim_events — issue #100/#101 says each service keeps its own log, so two
// independent producers never interleave writes for the same table ref.
// Reuses the generic envelope contract from sim-service (no duplicated enum).

const { Pool } = require('pg');
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const { EVENT_TYPES } = require('../sim-service/envelope');

// Module-level scan/summarize helpers, factored out of the query methods below
// so each stays a short, low-branch function (kept in sync with query column
// order: ref, event_type, occurred_at).

// Generous margin above real session lengths (occupied dwell <=45min, dirty
// cleanup <=20min) — wide enough that a session already in progress when a
// query window opens is never missed, without scanning the whole table.
const BOUNDARY_LOOKBACK_DAYS = 1;

/** Shifts a YYYY-MM-DD date string by `deltaDays` (may be negative). */
function shiftDate(dateStr, deltaDays) {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

/** Clamps [startMs, endMs) to [periodStart, periodEnd) and returns the overlap length in ms (0 if none). */
function clipOverlapMs(startMs, endMs, periodStart, periodEnd) {
  if (periodStart == null || periodEnd == null) return 0;
  const s = Math.max(startMs, periodStart);
  const e = Math.min(endMs, periodEnd);
  return e > s ? e - s : 0;
}

/**
 * Pairs table.occupied -> table.dirty rows per table into sessions. A session
 * with no matching table.dirty yet (still occupied, or the queried window
 * ends mid-cycle) is returned with dirtyAt: null instead of being dropped —
 * the caller decides how to treat "ongoing".
 */
function pairOccupiedDirty(rows) {
  const sessions = [];
  const pendingOccupiedAt = new Map();
  let observedStart = null;
  let observedEnd = null;

  for (const row of rows) {
    const t = new Date(row.occurred_at).getTime();
    observedStart = observedStart === null ? t : Math.min(observedStart, t);
    observedEnd = observedEnd === null ? t : Math.max(observedEnd, t);

    if (row.event_type === EVENT_TYPES.TABLE_OCCUPIED) {
      const prior = pendingOccupiedAt.get(row.ref);
      // A second occupied with no intervening dirty (data anomaly, e.g. two
      // producers sharing a table) closes out the earlier session here
      // instead of silently overwriting and losing it.
      if (prior != null) sessions.push({ ref: row.ref, occupiedAt: prior, dirtyAt: t });
      pendingOccupiedAt.set(row.ref, t);
    } else if (row.event_type === EVENT_TYPES.TABLE_DIRTY) {
      const occupiedAt = pendingOccupiedAt.get(row.ref);
      if (occupiedAt != null) {
        sessions.push({ ref: row.ref, occupiedAt, dirtyAt: t });
        pendingOccupiedAt.delete(row.ref);
      }
    }
  }

  for (const [ref, occupiedAt] of pendingOccupiedAt) {
    sessions.push({ ref, occupiedAt, dirtyAt: null });
  }

  return { sessions, observedStart, observedEnd };
}

/**
 * The denominator is the requested window when given — falling back to the
 * observed event span would silently shrink "utilization for May" down to
 * whatever days happened to have events in them.
 */
function computePeriodBounds({ startDate, endDate, observedStart, observedEnd }) {
  const periodStart = startDate ? new Date(`${startDate}T00:00:00.000Z`).getTime() : observedStart;
  const periodEnd = endDate ? new Date(`${endDate}T23:59:59.999Z`).getTime() : observedEnd;
  const periodMs = (periodStart != null && periodEnd != null) ? periodEnd - periodStart : 0;
  return { periodStart, periodEnd, periodMs };
}

/** Same idea as pairOccupiedDirty, for table.dirty -> table.cleared; clearedAt: null means still dirty. */
function pairDirtyCleared(rows) {
  const sessions = [];
  const pendingDirtyAt = new Map();
  let observedStart = null;
  let observedEnd = null;

  for (const row of rows) {
    const t = new Date(row.occurred_at).getTime();
    observedStart = observedStart === null ? t : Math.min(observedStart, t);
    observedEnd = observedEnd === null ? t : Math.max(observedEnd, t);

    if (row.event_type === EVENT_TYPES.TABLE_DIRTY) {
      const prior = pendingDirtyAt.get(row.ref);
      if (prior != null) sessions.push({ ref: row.ref, dirtyAt: prior, clearedAt: t });
      pendingDirtyAt.set(row.ref, t);
    } else if (row.event_type === EVENT_TYPES.TABLE_CLEARED) {
      const dirtyAt = pendingDirtyAt.get(row.ref);
      if (dirtyAt != null) {
        sessions.push({ ref: row.ref, dirtyAt, clearedAt: t });
        pendingDirtyAt.delete(row.ref);
      }
    }
  }

  for (const [ref, dirtyAt] of pendingDirtyAt) {
    sessions.push({ ref, dirtyAt, clearedAt: null });
  }

  return { sessions, observedStart, observedEnd };
}

function summarizeDurations(arr) {
  if (arr.length === 0) return { count: 0, avg_seconds: 0, min_seconds: 0, max_seconds: 0 };
  return {
    count: arr.length,
    avg_seconds: Math.round(arr.reduce((a, b) => a + b, 0) / arr.length),
    min_seconds: Math.min(...arr),
    max_seconds: Math.max(...arr),
  };
}

class TableEventLog {
  constructor(options = {}) {
    this.pool = options.pool || new Pool({
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432'),
      database: process.env.TABLE_SIM_DB_NAME || process.env.CAFE_DB_NAME || 'pos_cafe',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || '',
      max: 10,
      idleTimeoutMillis: 30000,
    });
    this.pool.on('error', (err) => {
      console.error('[TableEventLog] Unexpected pool error', err.message);
    });
  }

  /** Idempotent — safe to call on every process start. */
  async init() {
    await this.pool.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS table_sim_events (
        id BIGSERIAL PRIMARY KEY,
        event_id UUID NOT NULL UNIQUE,
        experience VARCHAR(20) NOT NULL,
        event_type VARCHAR(50) NOT NULL,
        severity VARCHAR(20) NOT NULL DEFAULT 'info',
        source VARCHAR(20) NOT NULL DEFAULT 'sim',
        ref VARCHAR(100) NOT NULL,
        occurred_at TIMESTAMPTZ NOT NULL,
        recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        sim_date DATE NOT NULL,
        seed VARCHAR(200),
        payload JSONB NOT NULL DEFAULT '{}'::jsonb
      )
    `);
    await this.pool.query('CREATE INDEX IF NOT EXISTS idx_table_sim_events_ref ON table_sim_events (ref)');
    await this.pool.query('CREATE INDEX IF NOT EXISTS idx_table_sim_events_occurred_at ON table_sim_events (occurred_at)');
    await this.pool.query('CREATE INDEX IF NOT EXISTS idx_table_sim_events_sim_date ON table_sim_events (sim_date)');
  }

  /** Idempotent on event_id, same as sim-service's log. */
  async append(envelope) {
    const result = await this.pool.query(
      `INSERT INTO table_sim_events
        (event_id, experience, event_type, severity, source, ref, occurred_at, sim_date, seed, payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
       ON CONFLICT (event_id) DO NOTHING
       RETURNING *`,
      [
        envelope.event_id,
        envelope.experience,
        envelope.event_type,
        envelope.severity,
        envelope.source,
        envelope.ref,
        envelope.occurred_at,
        envelope.sim_date,
        envelope.seed,
        JSON.stringify(envelope.payload || {}),
      ]
    );
    return result.rows[0] || null;
  }

  /** Poll-based tail: events appended after `sinceId`, oldest first. */
  async tail({ sinceId = 0, limit = 100 } = {}) {
    const result = await this.pool.query(
      `SELECT * FROM table_sim_events WHERE id > $1 ORDER BY id ASC LIMIT $2`,
      [Math.max(0, sinceId), Math.min(Math.max(1, limit), 1000)]
    );
    return result.rows;
  }

  /** All events recorded for one simulated calendar day, in original order — the replay source. */
  async replayDay({ experience, simDate }) {
    const result = await this.pool.query(
      `SELECT * FROM table_sim_events WHERE experience = $1 AND sim_date = $2 ORDER BY occurred_at ASC, id ASC`,
      [experience, simDate]
    );
    return result.rows;
  }

  /** Per-table state-change timeline, most recent first. */
  async getTableHistory({ experience, tableRef, limit = 100 }) {
    if (!tableRef) throw new Error('tableRef is required');
    const clauses = ['ref = $1'];
    const params = [tableRef];
    if (experience) { params.push(experience); clauses.push(`experience = $${params.length}`); }
    params.push(Math.min(Math.max(1, limit), 1000));
    const result = await this.pool.query(
      `SELECT event_type, severity, source, occurred_at, sim_date, payload
       FROM table_sim_events
       WHERE ${clauses.join(' AND ')}
       ORDER BY occurred_at DESC LIMIT $${params.length}`,
      params
    );
    return result.rows;
  }

  /** Shared WHERE-clause builder for the two stats queries below. */
  _buildFilters({ experience, tableRef, startDate, endDate }, extraClause) {
    const clauses = [extraClause];
    const params = [];
    if (experience) { params.push(experience); clauses.push(`experience = $${params.length}`); }
    if (tableRef) { params.push(tableRef); clauses.push(`ref = $${params.length}`); }
    if (startDate) { params.push(startDate); clauses.push(`occurred_at::date >= $${params.length}`); }
    if (endDate) { params.push(endDate); clauses.push(`occurred_at::date <= $${params.length}`); }
    return { where: clauses.join(' AND '), params };
  }

  /**
   * Utilization per table over a period: occupied time (table.occupied ->
   * table.dirty) divided by the requested period span. Queries a day further
   * back than requested so a session already open when the window starts
   * isn't dropped; a session still open at the end of the window (or right
   * now) counts its overlap with the window rather than being skipped.
   */
  async getUtilization({ experience, tableRef, startDate, endDate } = {}) {
    const queryStartDate = startDate ? shiftDate(startDate, -BOUNDARY_LOOKBACK_DAYS) : undefined;
    const { where, params } = this._buildFilters(
      { experience, tableRef, startDate: queryStartDate, endDate },
      `event_type IN ('${EVENT_TYPES.TABLE_OCCUPIED}', '${EVENT_TYPES.TABLE_DIRTY}')`
    );

    const result = await this.pool.query(
      `SELECT ref, event_type, occurred_at FROM table_sim_events
       WHERE ${where}
       ORDER BY ref, occurred_at ASC`,
      params
    );

    const { sessions, observedStart, observedEnd } = pairOccupiedDirty(result.rows);
    const { periodStart, periodEnd, periodMs } = computePeriodBounds({ startDate, endDate, observedStart, observedEnd });

    const byTable = new Map();
    for (const session of sessions) {
      const sessionEndMs = session.dirtyAt ?? periodEnd ?? Date.now();
      const overlapMs = clipOverlapMs(session.occupiedAt, sessionEndMs, periodStart, periodEnd);
      if (overlapMs <= 0) continue;
      if (!byTable.has(session.ref)) byTable.set(session.ref, { occupiedMs: 0, cycles: 0 });
      const entry = byTable.get(session.ref);
      entry.occupiedMs += overlapMs;
      entry.cycles += 1;
    }

    const tables = [...byTable.entries()].map(([ref, v]) => ({
      ref,
      occupied_seconds: Math.round(v.occupiedMs / 1000),
      cycles: v.cycles,
      utilization: periodMs > 0 ? Number((v.occupiedMs / periodMs).toFixed(4)) : 0,
    }));

    return {
      period_start: periodStart ? new Date(periodStart).toISOString() : null,
      period_end: periodEnd ? new Date(periodEnd).toISOString() : null,
      tables,
    };
  }

  /**
   * Dirty-duration stats: time between table.dirty and the table.cleared that
   * follows it. A table still dirty right now (no table.cleared yet) counts
   * too, measured up to the end of the window (or now) — this is exactly the
   * "has been sitting dirty for N minutes and counting" case the tool exists for.
   */
  async getDirtyDurationStats({ experience, tableRef, startDate, endDate } = {}) {
    const queryStartDate = startDate ? shiftDate(startDate, -BOUNDARY_LOOKBACK_DAYS) : undefined;
    const { where, params } = this._buildFilters(
      { experience, tableRef, startDate: queryStartDate, endDate },
      `event_type IN ('${EVENT_TYPES.TABLE_DIRTY}', '${EVENT_TYPES.TABLE_CLEARED}')`
    );

    const result = await this.pool.query(
      `SELECT ref, event_type, occurred_at FROM table_sim_events
       WHERE ${where}
       ORDER BY ref, occurred_at ASC`,
      params
    );

    const { sessions, observedStart, observedEnd } = pairDirtyCleared(result.rows);
    const { periodEnd } = computePeriodBounds({ startDate, endDate, observedStart, observedEnd });

    const byTable = new Map();
    const overall = [];
    for (const session of sessions) {
      const clearedAtMs = session.clearedAt ?? periodEnd ?? Date.now();
      const seconds = Math.round((clearedAtMs - session.dirtyAt) / 1000);
      if (seconds < 0) continue; // guards a clock/ordering anomaly rather than reporting a negative duration
      if (!byTable.has(session.ref)) byTable.set(session.ref, []);
      byTable.get(session.ref).push(seconds);
      overall.push(seconds);
    }

    return {
      overall: summarizeDurations(overall),
      by_table: [...byTable.entries()].map(([ref, arr]) => ({ ref, ...summarizeDurations(arr) })),
    };
  }

  /** Cheap connectivity check for /table-sim/health — throws if the DB is unreachable. */
  async ping() {
    await this.pool.query('SELECT 1');
  }

  /** Resolves an event_id back to its log row id, so an SSE client's Last-Event-ID can be resumed from. */
  async findLogId(eventId) {
    const result = await this.pool.query('SELECT id FROM table_sim_events WHERE event_id = $1', [eventId]);
    return result.rows[0] ? result.rows[0].id : null;
  }

  async close() {
    await this.pool.end();
  }
}

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

module.exports = { TableEventLog, rowToWireEnvelope };
