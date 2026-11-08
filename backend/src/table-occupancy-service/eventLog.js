/*
 * Copyright (c) 2026 Intel Corporation
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Durable event log for the table occupancy service, in its own table
// (table_sim_events) so this service's per-table stream never interleaves with
// another service's writes. Storage mechanics live in BaseEventLog; this adds
// the utilization / dirty-duration / history read models.

const { BaseEventLog } = require('../service-common/eventLog');
const { EVENT_TYPES } = require('./envelope');

// Module-level scan/summarize helpers, factored out of the query methods below
// so each stays a short, low-branch function (kept in sync with query column
// order: ref, event_type, occurred_at).

// Generous margin above real session lengths (occupied dwell <=45min, dirty
// cleanup <=20min) — wide enough that a session already in progress when a
// query window opens is never missed, without scanning the whole table.
const BOUNDARY_LOOKBACK_DAYS = 1;

// Far beyond a real dirty-to-cleared gap (<=20min), so an older open dirty mark means the clear was never recorded.
const STALE_DIRTY_HOURS = 24;

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

/** Like a positive clipOverlapMs, but also keeps a zero-length session (e.g. dirty right now) that lies inside the period. */
function touchesPeriod(startMs, endMs, periodStart, periodEnd) {
  if (periodStart == null || periodEnd == null) return false;
  if (endMs > startMs) return clipOverlapMs(startMs, endMs, periodStart, periodEnd) > 0;
  return startMs >= periodStart && startMs <= periodEnd;
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
 * whatever days happened to have events in them. `periodEnd` specifically
 * falls back to "now" rather than the observed span: with no `endDate`, the
 * caller means "as of now", and an open session's duration is measured
 * through `periodEnd` elsewhere in this file — falling back to the last
 * *observed* event instead would make an open session (which is often that
 * very last observed event) measure as ~0 duration instead of "ongoing,
 * elapsed so far".
 */
function computePeriodBounds({ startDate, endDate, observedStart, nowMs }) {
  const periodStart = startDate ? new Date(`${startDate}T00:00:00.000Z`).getTime() : observedStart;
  const periodEnd = endDate ? new Date(`${endDate}T23:59:59.999Z`).getTime() : nowMs;
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

class TableEventLog extends BaseEventLog {
  constructor(options = {}) {
    super({
      label: 'TableEventLog',
      tableName: 'table_sim_events',
      dbNameEnv: 'TABLE_SIM_DB_NAME',
      refRequired: true,
      indexColumns: ['ref', 'occurred_at', 'sim_date'],
    }, options);
  }

  /**
   * Refs whose latest state-change event is table.dirty, i.e. tables waiting to be cleared right now.
   * A dirty mark more than STALE_DIRTY_HOURS older than the newest event is treated as a lost clear.
   */
  async getDirtyTableRefs({ experience }) {
    const result = await this.pool.query(
      `SELECT ref FROM (
         SELECT DISTINCT ON (ref) ref, event_type, occurred_at FROM ${this.tableName}
         WHERE experience = $1 AND event_type IN ('${EVENT_TYPES.TABLE_OCCUPIED}', '${EVENT_TYPES.TABLE_DIRTY}', '${EVENT_TYPES.TABLE_CLEARED}')
         ORDER BY ref, occurred_at DESC, id DESC
       ) latest
       WHERE event_type = '${EVENT_TYPES.TABLE_DIRTY}'
         AND occurred_at >= (SELECT MAX(occurred_at) FROM ${this.tableName} WHERE experience = $1) - make_interval(hours => $2)`,
      [experience, STALE_DIRTY_HOURS]
    );
    return result.rows.map((r) => r.ref);
  }

  /** Per-table state-change timeline, most recent first. */
  async getTableHistory({ experience, tableRef, limit = 100 }) {
    if (!tableRef) throw new Error('tableRef is required');
    const clauses = ['ref = $1'];
    const params = [tableRef];
    if (experience) { params.push(experience); clauses.push(`experience = $${params.length}`); }
    params.push(Math.min(Math.max(1, limit), 1000));
    // sim_date::text avoids pg's DATE->Date parsing (local y/m/d construction), which
    // shifts the calendar day on non-UTC hosts when the driver's Date is serialized.
    const result = await this.pool.query(
      `SELECT event_type, severity, source, occurred_at, sim_date::text AS sim_date, payload
       FROM ${this.tableName}
       WHERE ${clauses.join(' AND ')}
       ORDER BY occurred_at DESC, id DESC LIMIT $${params.length}`,
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
    // UTC-anchored — occurred_at::date truncates in the session TimeZone, which would
    // shift which calendar day a boundary event falls into on a non-UTC host.
    if (startDate) { params.push(startDate); clauses.push(`(occurred_at AT TIME ZONE 'UTC')::date >= $${params.length}::date`); }
    if (endDate) { params.push(endDate); clauses.push(`(occurred_at AT TIME ZONE 'UTC')::date <= $${params.length}::date`); }
    return { where: clauses.join(' AND '), params };
  }

  /**
   * Utilization per table over a period: occupied time (table.occupied ->
   * table.dirty) divided by the requested period span. Queries a day further
   * back than requested so a session already open when the window starts
   * isn't dropped; a session still open at the end of the window (or right
   * now) counts its overlap with the window rather than being skipped.
   */
  async getUtilization({ experience, tableRef, startDate, endDate, nowMs = Date.now() } = {}) {
    const queryStartDate = startDate ? shiftDate(startDate, -BOUNDARY_LOOKBACK_DAYS) : undefined;
    const { where, params } = this._buildFilters(
      { experience, tableRef, startDate: queryStartDate, endDate },
      `event_type IN ('${EVENT_TYPES.TABLE_OCCUPIED}', '${EVENT_TYPES.TABLE_DIRTY}')`
    );

    const result = await this.pool.query(
      `SELECT ref, event_type, occurred_at FROM ${this.tableName}
       WHERE ${where}
       ORDER BY ref, occurred_at ASC, id ASC`,
      params
    );

    const { sessions, observedStart } = pairOccupiedDirty(result.rows);
    const { periodStart, periodEnd, periodMs } = computePeriodBounds({ startDate, endDate, observedStart, nowMs });

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
  async getDirtyDurationStats({ experience, tableRef, startDate, endDate, nowMs = Date.now() } = {}) {
    const queryStartDate = startDate ? shiftDate(startDate, -BOUNDARY_LOOKBACK_DAYS) : undefined;
    const { where, params } = this._buildFilters(
      { experience, tableRef, startDate: queryStartDate, endDate },
      `event_type IN ('${EVENT_TYPES.TABLE_DIRTY}', '${EVENT_TYPES.TABLE_CLEARED}')`
    );

    const result = await this.pool.query(
      `SELECT ref, event_type, occurred_at FROM ${this.tableName}
       WHERE ${where}
       ORDER BY ref, occurred_at ASC, id ASC`,
      params
    );

    const { sessions, observedStart } = pairDirtyCleared(result.rows);
    const { periodStart, periodEnd } = computePeriodBounds({ startDate, endDate, observedStart, nowMs });

    const byTable = new Map();
    const overall = [];
    for (const session of sessions) {
      const clearedAtMs = session.clearedAt ?? periodEnd ?? Date.now();
      // The 1-day lookback (queryStartDate above) exists so a session that
      // crosses into the requested period from before it isn't missed — not
      // to admit one that both starts and ends entirely before the period,
      // which would otherwise inflate these stats with out-of-range data.
      if (!touchesPeriod(session.dirtyAt, clearedAtMs, periodStart, periodEnd)) continue;
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
}

module.exports = { TableEventLog };
