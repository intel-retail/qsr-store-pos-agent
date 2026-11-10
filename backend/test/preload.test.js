/*
 * Copyright (c) 2026 Intel Corporation
 *
 * SPDX-License-Identifier: Apache-2.0
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { startProducer } = require('../src/service-common/serviceApp');
const { pastDates } = require('../src/service-common/seedHistory');
const { BaseEventLog } = require('../src/service-common/eventLog');

const DAY_EVENTS = 10;

// `counts`: date -> rows already stored for the seed; every day's full schedule is DAY_EVENTS long.
function fakeProducer({ counts = {} }) {
  const calls = { materialized: [], live: 0 };
  return {
    calls,
    experience: 'cafe',
    seed: 's',
    generateSchedule: () => new Array(DAY_EVENTS),
    log: { countsByDay: async () => new Map(Object.entries(counts)) },
    materializeDay: async (d) => { calls.materialized.push(d); return { total: 1, inserted: 1, skipped: 0 }; },
    runLive: async () => { calls.live++; return 0; },
  };
}

const baseConfig = { SOURCE: 'sim', MODE: 'live', SPEED: 60, SEED: 's', PRELOAD_DAYS: 3 };
const run = (producer, overrides = {}) =>
  startProducer({ label: 't', routePrefix: '/t', config: { ...baseConfig, ...overrides }, producer });

test('preloads every past day when the log has none, oldest first', async () => {
  const producer = fakeProducer({});
  await run(producer);
  assert.equal(producer.calls.materialized.length, 3);
  assert.deepEqual(producer.calls.materialized, [...producer.calls.materialized].sort());
  assert.equal(producer.calls.live, 1);
});

test('fills only the days that are missing', async () => {
  const dates = pastDates(3);
  const producer = fakeProducer({ counts: { [dates[0]]: DAY_EVENTS, [dates[2]]: DAY_EVENTS } });
  await run(producer);
  assert.deepEqual(producer.calls.materialized, [dates[1]]);
});

test('re-materializes a partially written day', async () => {
  const dates = pastDates(3);
  const producer = fakeProducer({ counts: { [dates[0]]: DAY_EVENTS, [dates[1]]: DAY_EVENTS - 1, [dates[2]]: DAY_EVENTS } });
  await run(producer);
  assert.deepEqual(producer.calls.materialized, [dates[1]]);
});

test('skips preload when every day is complete', async () => {
  const counts = Object.fromEntries(pastDates(3).map((d) => [d, DAY_EVENTS]));
  const producer = fakeProducer({ counts });
  await run(producer);
  assert.equal(producer.calls.materialized.length, 0);
});

test('skips preload when PRELOAD_DAYS is 0', async () => {
  const producer = fakeProducer({});
  await run(producer, { PRELOAD_DAYS: 0 });
  assert.equal(producer.calls.materialized.length, 0);
});

test('SOURCE=real never preloads or produces', async () => {
  const producer = fakeProducer({});
  assert.equal(await run(producer, { SOURCE: 'real' }), null);
  assert.equal(producer.calls.materialized.length, 0);
});

function fakePool({ failOnInsert = null } = {}) {
  const queries = [];
  const client = {
    query: async (sql, params) => {
      queries.push({ sql: sql.trim().split(/\s+/)[0], params });
      if (failOnInsert !== null && sql.startsWith('INSERT') && queries.filter((q) => q.sql === 'INSERT').length === failOnInsert) {
        throw new Error('boom');
      }
      return { rowCount: params ? params.length / 10 : 0 };
    },
    release: () => { queries.released = true; },
  };
  return { queries, on() {}, connect: async () => client };
}

const envelopes = (n) => Array.from({ length: n }, (_, i) => ({
  event_id: `id-${i}`, experience: 'cafe', event_type: 't', severity: 'info', source: 'sim',
  ref: null, occurred_at: '2026-05-20T07:00:00.000Z', sim_date: '2026-05-20', seed: 's', payload: {},
}));

test('appendMany inserts in chunks inside one transaction', async () => {
  const pool = fakePool();
  const log = new BaseEventLog({ label: 'x', tableName: 'x_events', dbNameEnv: 'X', refRequired: false, indexColumns: [] }, { pool });
  assert.equal(await log.appendMany(envelopes(1200)), 1200);
  assert.deepEqual(pool.queries.map((q) => q.sql), ['BEGIN', 'INSERT', 'INSERT', 'INSERT', 'COMMIT']);
  assert.equal(pool.queries.find((q) => q.sql === 'INSERT').params.length, 5000);
  assert.ok(pool.queries.released);
});

test('appendMany rolls back and rethrows when an insert fails', async () => {
  const pool = fakePool({ failOnInsert: 2 });
  const log = new BaseEventLog({ label: 'x', tableName: 'x_events', dbNameEnv: 'X', refRequired: false, indexColumns: [] }, { pool });
  await assert.rejects(log.appendMany(envelopes(1200)), /boom/);
  assert.equal(pool.queries.at(-1).sql, 'ROLLBACK');
  assert.ok(!pool.queries.some((q) => q.sql === 'COMMIT'));
  assert.ok(pool.queries.released);
});
