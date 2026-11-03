/*
 * Copyright (c) 2026 Intel Corporation
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Durable event log for the store activity service, in its own table
// (sim_events). Storage mechanics live in BaseEventLog; this adds the
// history / baseline-comparison / snapshot read models.

const { BaseEventLog } = require('../service-common/eventLog');

const VALID_GROUP_BY = new Set(['hour', 'day']);

class StoreActivityEventLog extends BaseEventLog {
  constructor(options = {}) {
    super({
      label: 'StoreActivityEventLog',
      tableName: 'sim_events',
      dbNameEnv: 'SIM_DB_NAME',
      refRequired: false,
      indexColumns: ['occurred_at', 'sim_date', 'event_type', 'ref'],
    }, options);
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
       FROM ${this.tableName}
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
        sql: `SELECT event_type, COUNT(*) AS count FROM ${this.tableName} WHERE ${clauses.join(' AND ')} GROUP BY event_type ORDER BY event_type`,
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
         FROM ${this.tableName}
         WHERE ${clauses.join(' AND ')}
         ORDER BY ref, occurred_at DESC, id DESC
       ) latest
       WHERE event_type <> 'customer.departed'
       ORDER BY ref`,
      params
    );
    return result.rows;
  }
}

module.exports = { StoreActivityEventLog };
