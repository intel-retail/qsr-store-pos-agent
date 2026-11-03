/*
 * Copyright (c) 2026 Intel Corporation
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Durable event log for the footfall service, in its own table
// (footfall_sim_events). Storage mechanics live in BaseEventLog; this adds the
// total-footfall and busy-time read models.

const { BaseEventLog } = require('../service-common/eventLog');
const { EVENT_TYPES } = require('./envelope');

class FootfallEventLog extends BaseEventLog {
  constructor(options = {}) {
    super({
      label: 'FootfallEventLog',
      tableName: 'footfall_sim_events',
      dbNameEnv: 'FOOTFALL_SIM_DB_NAME',
      refRequired: true,
      indexColumns: ['ref', 'occurred_at', 'sim_date'],
    }, options);
  }

  _buildFilters({ experience, zone, startDate, endDate }, extraClause) {
    const clauses = [extraClause];
    const params = [];
    if (experience) { params.push(experience); clauses.push(`experience = $${params.length}`); }
    if (zone) { params.push(zone); clauses.push(`ref = $${params.length}`); }
    // UTC-anchored — occurred_at::date truncates in the session TimeZone, which would
    // shift which calendar day a boundary event falls into on a non-UTC host.
    if (startDate) { params.push(startDate); clauses.push(`(occurred_at AT TIME ZONE 'UTC')::date >= $${params.length}::date`); }
    if (endDate) { params.push(endDate); clauses.push(`(occurred_at AT TIME ZONE 'UTC')::date <= $${params.length}::date`); }
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
       FROM ${this.tableName} WHERE ${where}`,
      params
    );
    const byZone = await this.pool.query(
      `SELECT ref AS zone, COALESCE(SUM(${countExpr}), 0) AS total_footfall, COUNT(*) AS event_count
       FROM ${this.tableName} WHERE ${where}
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
      // UTC-anchored, same reasoning as _buildFilters above.
      const daysResult = await this.pool.query(
        `SELECT COUNT(DISTINCT (occurred_at AT TIME ZONE 'UTC')::date) AS days FROM ${this.tableName} WHERE ${where}`,
        params
      );
      totalDays = Number(daysResult.rows[0].days) || 0;
    }

    const countExpr = "CASE WHEN payload->>'count' ~ '^[0-9]+$' THEN (payload->>'count')::int ELSE 0 END";
    // Hour also anchored to UTC — EXTRACT(HOUR FROM ts) implicitly converts to the
    // session TimeZone first, which would silently shift every reported busy hour
    // by the server's UTC offset (the actual bug this comment is guarding against).
    const result = await this.pool.query(
      `SELECT EXTRACT(HOUR FROM occurred_at AT TIME ZONE 'UTC')::int AS hour,
              COALESCE(SUM(${countExpr}), 0) AS total_footfall
       FROM ${this.tableName} WHERE ${where}
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
}

module.exports = { FootfallEventLog };
