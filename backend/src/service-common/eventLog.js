/*
 * Copyright (c) 2026 Intel Corporation
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Durable, ordered event log shared by every service (issue #100/#101). Each
// service still owns its own Postgres table; only the storage mechanics live
// here. Reuses the `pg` dependency already used elsewhere in this backend and
// does not touch any existing pool/table.

const { Pool } = require('pg');
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const { envInt } = require('./config');

const TABLE_NAME_PATTERN = /^[a-z_][a-z0-9_]*$/;
const INSERT_COLUMNS = '(event_id, experience, event_type, severity, source, ref, occurred_at, sim_date, seed, payload)';
const INSERT_CHUNK_ROWS = 500; // 10 params per row, well under pg's 65535 limit

function envelopeParams(envelope) {
  return [
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
  ];
}

class BaseEventLog {
  /**
   * @param {object} spec
   * @param {string} spec.label        log prefix, e.g. 'StoreActivityEventLog'
   * @param {string} spec.tableName    event table (interpolated into SQL, so must be a plain identifier)
   * @param {string} spec.dbNameEnv    env var that overrides the database name
   * @param {boolean} spec.refRequired whether every event must carry a ref (table id, zone, ...)
   * @param {string[]} spec.indexColumns columns to index in addition to the primary key
   */
  constructor({ label, tableName, dbNameEnv, refRequired, indexColumns }, options = {}) {
    if (!TABLE_NAME_PATTERN.test(tableName)) throw new Error(`Invalid table name: ${tableName}`);
    this.label = label;
    this.tableName = tableName;
    this.refRequired = refRequired;
    this.indexColumns = indexColumns;
    this.pool = options.pool || new Pool({
      host: process.env.DB_HOST || 'localhost',
      port: envInt('DB_PORT', 5432, { min: 1, max: 65535 }),
      database: process.env[dbNameEnv] || process.env.CAFE_DB_NAME || 'pos_cafe',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || '',
      max: 10,
      idleTimeoutMillis: 30000,
    });
    this.pool.on('error', (err) => {
      console.error(`[${this.label}] Unexpected pool error`, err.message);
    });
  }

  /** Idempotent — safe to call on every process start. */
  async init() {
    const t = this.tableName;
    await this.pool.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${t} (
        id BIGSERIAL PRIMARY KEY,
        event_id UUID NOT NULL UNIQUE,
        experience VARCHAR(20) NOT NULL,
        event_type VARCHAR(50) NOT NULL,
        severity VARCHAR(20) NOT NULL DEFAULT 'info',
        source VARCHAR(20) NOT NULL DEFAULT 'sim',
        ref VARCHAR(100)${this.refRequired ? ' NOT NULL' : ''},
        occurred_at TIMESTAMPTZ NOT NULL,
        recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        sim_date DATE NOT NULL,
        seed VARCHAR(200),
        payload JSONB NOT NULL DEFAULT '{}'::jsonb
      )
    `);
    for (const column of this.indexColumns) {
      await this.pool.query(`CREATE INDEX IF NOT EXISTS idx_${t}_${column} ON ${t} (${column})`);
    }
  }

  /**
   * Append one envelope, durably and in order. Idempotent on event_id so a
   * producer/replay retry can never double-write the log.
   * Returns the stored row, or null if the event_id was already present.
   */
  async append(envelope) {
    const result = await this.pool.query(
      `INSERT INTO ${this.tableName} ${INSERT_COLUMNS}
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
       ON CONFLICT (event_id) DO NOTHING
       RETURNING *`,
      envelopeParams(envelope)
    );
    return result.rows[0] || null;
  }

  /**
   * Bulk append in one transaction (all or nothing), skipping event_ids already
   * present. Returns how many rows were newly inserted. Used for history preload,
   * where a day is either fully recorded or absent.
   */
  async appendMany(envelopes) {
    if (envelopes.length === 0) return 0;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      let inserted = 0;
      for (let i = 0; i < envelopes.length; i += INSERT_CHUNK_ROWS) {
        const chunk = envelopes.slice(i, i + INSERT_CHUNK_ROWS);
        const placeholders = chunk.map((_, row) => {
          const base = row * 10;
          return `(${Array.from({ length: 9 }, (__, k) => `$${base + k + 1}`).join(', ')}, $${base + 10}::jsonb)`;
        });
        const result = await client.query(
          `INSERT INTO ${this.tableName} ${INSERT_COLUMNS} VALUES ${placeholders.join(', ')} ON CONFLICT (event_id) DO NOTHING`,
          chunk.flatMap(envelopeParams)
        );
        inserted += result.rowCount;
      }
      await client.query('COMMIT');
      return inserted;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  /** Poll-based tail: events appended after `sinceId`, oldest first. */
  async tail({ sinceId = 0, limit = 100 } = {}) {
    // sim_date::text (Postgres-side) avoids pg's DATE->Date parsing (which builds
    // the Date from local y/m/d components, shifting the day on non-UTC hosts) —
    // duplicate output column name wins with the last value, so this overrides `sim_date`.
    const result = await this.pool.query(
      `SELECT *, sim_date::text AS sim_date FROM ${this.tableName} WHERE id > $1 ORDER BY id ASC LIMIT $2`,
      [Math.max(0, sinceId), Math.min(Math.max(1, limit), 1000)]
    );
    return result.rows;
  }

  /**
   * Pages through tail() until the backlog since `sinceId` is fully drained,
   * instead of capping at tail()'s own per-call row limit — used by SSE
   * resume, whose "no missed events" contract a single capped tail() call
   * would otherwise silently violate on a long enough disconnect. `maxPages`
   * is a safety bound against a pathological case (e.g. a misconfigured
   * firehose producer outpacing drainage), not an expected limit.
   */
  async drainTail({ sinceId = 0, pageSize = 1000, maxPages = 10000 } = {}) {
    const rows = [];
    let cursor = sinceId;
    for (let page = 0; page < maxPages; page += 1) {
      const batch = await this.tail({ sinceId: cursor, limit: pageSize });
      rows.push(...batch);
      if (batch.length < pageSize) return rows;
      cursor = batch[batch.length - 1].id;
    }
    console.error(`[${this.label}] drainTail stopped after ${maxPages} pages (sinceId=${sinceId}) — backlog is still growing faster than it can be drained.`);
    return rows;
  }

  /** All events recorded for one simulated calendar day, in original order — the replay source. */
  async replayDay({ experience, simDate }) {
    const result = await this.pool.query(
      `SELECT * FROM ${this.tableName} WHERE experience = $1 AND sim_date = $2 ORDER BY occurred_at ASC, id ASC`,
      [experience, simDate]
    );
    return result.rows;
  }

  /** Most recent event by occurred_at (of one experience when given); for SOURCE=sim this is the simulation clock. */
  async latestEvent({ experience } = {}) {
    const result = await this.pool.query(
      `SELECT occurred_at, sim_date::text AS sim_date FROM ${this.tableName}
       WHERE ($1::text IS NULL OR experience = $1) ORDER BY occurred_at DESC, id DESC LIMIT 1`,
      [experience ?? null]
    );
    return result.rows[0] || null;
  }

  /** How many of the given deterministic event ids are already stored. */
  async countStored(eventIds) {
    if (eventIds.length === 0) return 0;
    const result = await this.pool.query(
      `SELECT COUNT(*)::int AS n FROM ${this.tableName} WHERE event_id = ANY($1::uuid[])`,
      [eventIds]
    );
    return result.rows[0].n;
  }

  /** Cheap connectivity check for the health route — throws if the DB is unreachable. */
  async ping() {
    await this.pool.query('SELECT 1');
  }

  /** Resolves an event_id back to its log row id, so an SSE client's Last-Event-ID can be resumed from. */
  async findLogId(eventId) {
    const result = await this.pool.query(`SELECT id FROM ${this.tableName} WHERE event_id = $1`, [eventId]);
    return result.rows[0] ? result.rows[0].id : null;
  }

  async close() {
    await this.pool.end();
  }
}

module.exports = { BaseEventLog };
