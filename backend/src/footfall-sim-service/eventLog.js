/*
 * Copyright (c) 2026 Intel Corporation
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Durable, ordered event log for the footfall/movement sim service. Its own
// table (footfall_sim_events) — same "each service owns its log" reasoning
// as table-sim-service; a zone's footfall stream shouldn't share a table with
// anything else's event stream.

const { Pool } = require('pg');
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const { EVENT_TYPES } = require('./envelope');

class FootfallEventLog {
  constructor(options = {}) {
    this.pool = options.pool || new Pool({
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432'),
      database: process.env.FOOTFALL_SIM_DB_NAME || process.env.CAFE_DB_NAME || 'pos_cafe',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || '',
      max: 10,
      idleTimeoutMillis: 30000,
    });
    this.pool.on('error', (err) => {
      console.error('[FootfallEventLog] Unexpected pool error', err.message);
    });
  }

  /** Idempotent — safe to call on every process start. */
  async init() {
    await this.pool.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS footfall_sim_events (
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
    await this.pool.query('CREATE INDEX IF NOT EXISTS idx_footfall_sim_events_ref ON footfall_sim_events (ref)');
    await this.pool.query('CREATE INDEX IF NOT EXISTS idx_footfall_sim_events_occurred_at ON footfall_sim_events (occurred_at)');
    await this.pool.query('CREATE INDEX IF NOT EXISTS idx_footfall_sim_events_sim_date ON footfall_sim_events (sim_date)');
  }

  /** Idempotent on event_id. */
  async append(envelope) {
    const result = await this.pool.query(
      `INSERT INTO footfall_sim_events
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
      `SELECT * FROM footfall_sim_events WHERE id > $1 ORDER BY id ASC LIMIT $2`,
      [Math.max(0, sinceId), Math.min(Math.max(1, limit), 1000)]
    );
    return result.rows;
  }

  /** All events recorded for one simulated calendar day, in original order — the replay source. */
  async replayDay({ experience, simDate }) {
    const result = await this.pool.query(
      `SELECT * FROM footfall_sim_events WHERE experience = $1 AND sim_date = $2 ORDER BY occurred_at ASC, id ASC`,
      [experience, simDate]
    );
    return result.rows;
  }

  _buildFilters({ experience, zone, startDate, endDate }, extraClause) {
    const clauses = [extraClause];
    const params = [];
    if (experience) { params.push(experience); clauses.push(`experience = $${params.length}`); }
    if (zone) { params.push(zone); clauses.push(`ref = $${params.length}`); }
    if (startDate) { params.push(startDate); clauses.push(`occurred_at::date >= $${params.length}`); }
    if (endDate) { params.push(endDate); clauses.push(`occurred_at::date <= $${params.length}`); }
    return { where: clauses.join(' AND '), params };
  }

  /** Total footfall over a period: overall and broken down by zone. */
  async getTotalFootfall({ experience, zone, startDate, endDate } = {}) {
    const { where, params } = this._buildFilters(
      { experience, zone, startDate, endDate },
      `event_type = '${EVENT_TYPES.FOOTFALL_COUNT}'`
    );

    // payload->>'count' is guarded with a digits-only check before casting —
    // a malformed count from the SOURCE=real ingestion path (payload isn't
    // validated per event type) would otherwise abort the whole aggregate.
    const countExpr = "CASE WHEN payload->>'count' ~ '^[0-9]+$' THEN (payload->>'count')::int ELSE 0 END";

    const overall = await this.pool.query(
      `SELECT COALESCE(SUM(${countExpr}), 0) AS total_footfall, COUNT(*) AS event_count
       FROM footfall_sim_events WHERE ${where}`,
      params
    );
    const byZone = await this.pool.query(
      `SELECT ref AS zone, COALESCE(SUM(${countExpr}), 0) AS total_footfall, COUNT(*) AS event_count
       FROM footfall_sim_events WHERE ${where}
       GROUP BY ref ORDER BY ref`,
      params
    );

    return {
      total_footfall: Number(overall.rows[0].total_footfall),
      event_count: Number(overall.rows[0].event_count),
      by_zone: byZone.rows.map((r) => ({
        zone: r.zone,
        total_footfall: Number(r.total_footfall),
        event_count: Number(r.event_count),
      })),
    };
  }

  /** Busy-time pattern: average footfall per hour-of-day, across all observed days — the "morning rush" view. */
  async getBusyTimePatterns({ experience, zone, startDate, endDate } = {}) {
    const { where, params } = this._buildFilters(
      { experience, zone, startDate, endDate },
      `event_type = '${EVENT_TYPES.FOOTFALL_COUNT}'`
    );

    // One denominator for every hour bucket, not "days that hour happened to
    // have data" — otherwise a sparsely-populated hour (e.g. real data with
    // gaps) looks artificially busy per-day just because it has few samples.
    // Prefer the requested range; fall back to the dataset's observed span.
    let totalDays;
    if (startDate && endDate) {
      const spanMs = new Date(`${endDate}T00:00:00.000Z`).getTime() - new Date(`${startDate}T00:00:00.000Z`).getTime();
      totalDays = Math.floor(spanMs / 86_400_000) + 1;
    } else {
      const daysResult = await this.pool.query(
        `SELECT COUNT(DISTINCT occurred_at::date) AS days FROM footfall_sim_events WHERE ${where}`,
        params
      );
      totalDays = Number(daysResult.rows[0].days) || 0;
    }

    const countExpr = "CASE WHEN payload->>'count' ~ '^[0-9]+$' THEN (payload->>'count')::int ELSE 0 END";
    const result = await this.pool.query(
      `SELECT EXTRACT(HOUR FROM occurred_at)::int AS hour,
              COALESCE(SUM(${countExpr}), 0) AS total_footfall
       FROM footfall_sim_events WHERE ${where}
       GROUP BY hour ORDER BY hour`,
      params
    );

    return result.rows.map((r) => ({
      hour: r.hour,
      total_footfall: Number(r.total_footfall),
      days_observed: totalDays,
      avg_footfall_per_day: totalDays > 0 ? Number((Number(r.total_footfall) / totalDays).toFixed(1)) : 0,
    }));
  }

  /** Cheap connectivity check for /footfall-sim/health — throws if the DB is unreachable. */
  async ping() {
    await this.pool.query('SELECT 1');
  }

  /** Resolves an event_id back to its log row id, so an SSE client's Last-Event-ID can be resumed from. */
  async findLogId(eventId) {
    const result = await this.pool.query('SELECT id FROM footfall_sim_events WHERE event_id = $1', [eventId]);
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

module.exports = { FootfallEventLog, rowToWireEnvelope };
