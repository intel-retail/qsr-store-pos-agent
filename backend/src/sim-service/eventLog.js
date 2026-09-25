/*
 * Copyright (c) 2026 Intel Corporation
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Durable, ordered event log for the sim service (issue #100/#101 contract).
// Backed by its own Postgres table (sim_events) — no shared runtime component,
// no in-memory Map. Reuses the existing `pg` dependency already used elsewhere
// in this backend; does not touch any existing pool/table.

const { Pool } = require('pg');
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const VALID_GROUP_BY = new Set(['hour', 'day']);

class SimEventLog {
  constructor(options = {}) {
    this.pool = options.pool || new Pool({
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432'),
      database: process.env.SIM_DB_NAME || process.env.CAFE_DB_NAME || 'pos_cafe',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || '',
      max: 10,
      idleTimeoutMillis: 30000,
    });
    this.pool.on('error', (err) => {
      console.error('[SimEventLog] Unexpected pool error', err.message);
    });
  }

  /** Idempotent — safe to call on every process start. */
  async init() {
    await this.pool.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS sim_events (
        id BIGSERIAL PRIMARY KEY,
        event_id UUID NOT NULL UNIQUE,
        experience VARCHAR(20) NOT NULL,
        event_type VARCHAR(50) NOT NULL,
        severity VARCHAR(20) NOT NULL DEFAULT 'info',
        source VARCHAR(20) NOT NULL DEFAULT 'sim',
        ref VARCHAR(100),
        occurred_at TIMESTAMPTZ NOT NULL,
        recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        sim_date DATE NOT NULL,
        seed VARCHAR(200),
        payload JSONB NOT NULL DEFAULT '{}'::jsonb
      )
    `);
    await this.pool.query('CREATE INDEX IF NOT EXISTS idx_sim_events_occurred_at ON sim_events (occurred_at)');
    await this.pool.query('CREATE INDEX IF NOT EXISTS idx_sim_events_sim_date ON sim_events (sim_date)');
    await this.pool.query('CREATE INDEX IF NOT EXISTS idx_sim_events_event_type ON sim_events (event_type)');
    await this.pool.query('CREATE INDEX IF NOT EXISTS idx_sim_events_ref ON sim_events (ref)');
  }

  /**
   * Append one envelope, durably and in order. Idempotent on event_id so a
   * producer/replay retry can never double-write the log.
   * Returns the stored row, or null if the event_id was already present.
   */
  async append(envelope) {
    const result = await this.pool.query(
      `INSERT INTO sim_events
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
    // sim_date::text (Postgres-side) avoids pg's DATE->Date parsing (which builds
    // the Date from local y/m/d components, shifting the day on non-UTC hosts) —
    // duplicate output column name wins with the last value, so this overrides `sim_date`.
    const result = await this.pool.query(
      `SELECT *, sim_date::text AS sim_date FROM sim_events WHERE id > $1 ORDER BY id ASC LIMIT $2`,
      [Math.max(0, sinceId), Math.min(Math.max(1, limit), 1000)]
    );
    return result.rows;
  }

  /** Grouped counts by period (hour|day), optionally filtered — the comparative question path. */
  async queryHistory({ experience, eventType, groupBy = 'day', startDate, endDate } = {}) {
    const bucket = VALID_GROUP_BY.has(groupBy) ? groupBy : 'day';
    // Anchor bucketing to UTC (not the session/server TimeZone) and format as text
    // server-side — date_trunc('hour', timestamptz) truncates in the session TimeZone,
    // which on a half-hour-offset zone (e.g. UTC+5:30) lands hour buckets on :30, not
    // :00; casting/formatting to text also sidesteps pg's local-timezone Date parsing.
    const bucketExpr = bucket === 'hour'
      ? `to_char(date_trunc('hour', occurred_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD"T"HH24:MI:SS".000Z"')`
      : "(occurred_at AT TIME ZONE 'UTC')::date::text";
    const dayFilterExpr = "(occurred_at AT TIME ZONE 'UTC')::date";

    const clauses = [];
    const params = [];
    if (experience) { params.push(experience); clauses.push(`experience = $${params.length}`); }
    if (eventType) { params.push(eventType); clauses.push(`event_type = $${params.length}`); }
    if (startDate) { params.push(startDate); clauses.push(`${dayFilterExpr} >= $${params.length}::date`); }
    if (endDate) { params.push(endDate); clauses.push(`${dayFilterExpr} <= $${params.length}::date`); }
    const whereSql = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    const result = await this.pool.query(
      `SELECT ${bucketExpr} AS period, event_type, COUNT(*) AS count
       FROM sim_events
       ${whereSql}
       GROUP BY period, event_type
       ORDER BY period ASC`,
      params
    );
    return result.rows;
  }

  /** Compare one date's event counts against a baseline date, per event type. */
  async compareToBaseline({ experience, eventType, date, baselineDate }) {
    const buildQuery = (targetDate) => {
      // UTC-anchored, same reasoning as queryHistory's dayFilterExpr above.
      const clauses = ["(occurred_at AT TIME ZONE 'UTC')::date = $1::date"];
      const params = [targetDate];
      if (experience) { params.push(experience); clauses.push(`experience = $${params.length}`); }
      if (eventType) { params.push(eventType); clauses.push(`event_type = $${params.length}`); }
      return {
        sql: `SELECT event_type, COUNT(*) AS count FROM sim_events WHERE ${clauses.join(' AND ')} GROUP BY event_type ORDER BY event_type`,
        params,
      };
    };
    const target = buildQuery(date);
    const baseline = buildQuery(baselineDate);
    const [targetResult, baselineResult] = await Promise.all([
      this.pool.query(target.sql, target.params),
      this.pool.query(baseline.sql, baseline.params),
    ]);
    return { date, baseline_date: baselineDate, current: targetResult.rows, baseline: baselineResult.rows };
  }

  /** Latest event per ref (e.g. per table) — a read-model snapshot derived from the log. */
  async getCurrentSnapshot({ experience } = {}) {
    const clauses = ['ref IS NOT NULL'];
    const params = [];
    if (experience) { params.push(experience); clauses.push(`experience = $${params.length}`); }
    // Excludes refs whose latest state is customer.departed — a departed customer's ref
    // is a one-time id that will never recur, so it isn't "current" state; without this
    // the snapshot grows unbounded with every customer ever simulated, drowning out the
    // actually-current table/queue rows this tool is meant to surface.
    const result = await this.pool.query(
      `SELECT * FROM (
         SELECT DISTINCT ON (ref) ref, experience, event_type, severity, occurred_at, payload
         FROM sim_events
         WHERE ${clauses.join(' AND ')}
         ORDER BY ref, occurred_at DESC, id DESC
       ) latest
       WHERE event_type <> 'customer.departed'
       ORDER BY ref`,
      params
    );
    return result.rows;
  }

  /** All events recorded for one simulated calendar day, in original order — the replay source. */
  async replayDay({ experience, simDate }) {
    const result = await this.pool.query(
      `SELECT * FROM sim_events WHERE experience = $1 AND sim_date = $2 ORDER BY occurred_at ASC, id ASC`,
      [experience, simDate]
    );
    return result.rows;
  }

  /** Cheap connectivity check for /sim/health — throws if the DB is unreachable. */
  async ping() {
    await this.pool.query('SELECT 1');
  }

  /** Resolves an event_id back to its log row id, so an SSE client's Last-Event-ID can be resumed from. */
  async findLogId(eventId) {
    const result = await this.pool.query('SELECT id FROM sim_events WHERE event_id = $1', [eventId]);
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

module.exports = { SimEventLog, rowToWireEnvelope };
