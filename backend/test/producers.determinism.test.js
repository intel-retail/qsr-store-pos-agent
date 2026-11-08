/*
 * Copyright (c) 2026 Intel Corporation
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Determinism checks for the three sim producers. generateSchedule() is pure,
// so no database or hub is needed — a stub log satisfies the constructor.

const test = require('node:test');
const assert = require('node:assert/strict');

const { StoreActivityProducer } = require('../src/store-activity-service/producer');
const { TableOccupancyProducer } = require('../src/table-occupancy-service/producer');
const { FootfallProducer } = require('../src/footfall-service/producer');

const SIM_DATE = '2026-05-20';
const OTHER_DATE = '2026-05-21';

const factories = {
  'store-activity': (seed) => new StoreActivityProducer({ log: {}, seed }),
  'table-occupancy': (seed) => new TableOccupancyProducer({ log: {}, seed }),
  footfall: (seed) => new FootfallProducer({ log: {}, seed }),
};

for (const [name, make] of Object.entries(factories)) {
  test(`${name}: same seed and date give an identical schedule`, () => {
    const a = make('seed-a').generateSchedule(SIM_DATE);
    const b = make('seed-a').generateSchedule(SIM_DATE);
    assert.ok(a.length > 0);
    assert.deepEqual(a, b);
  });

  test(`${name}: different seed or date changes the schedule`, () => {
    const base = make('seed-a').generateSchedule(SIM_DATE);
    assert.notDeepEqual(make('seed-b').generateSchedule(SIM_DATE), base);
    assert.notDeepEqual(make('seed-a').generateSchedule(OTHER_DATE), base);
  });

  test(`${name}: event ids are unique and events are time-ordered`, () => {
    const schedule = make('seed-a').generateSchedule(SIM_DATE);
    assert.equal(new Set(schedule.map((e) => e.event_id)).size, schedule.length);
    const times = schedule.map((e) => new Date(e.occurred_at).getTime());
    assert.deepEqual(times, [...times].sort((x, y) => x - y));
  });

  test(`${name}: materializeDay is idempotent against an id-unique log`, async () => {
    const seen = new Set();
    const log = {
      appendMany: async (envelopes) => envelopes.filter((e) => !seen.has(e.event_id) && seen.add(e.event_id)).length,
    };
    const producer = make('seed-a');
    producer.log = log;
    const first = await producer.materializeDay(SIM_DATE);
    const second = await producer.materializeDay(SIM_DATE);
    assert.equal(first.inserted, first.total);
    assert.equal(second.inserted, 0);
    assert.equal(second.skipped, first.total);
  });
}

test('table-occupancy: a table never has overlapping sessions', () => {
  const schedule = factories['table-occupancy']('seed-a').generateSchedule(SIM_DATE);
  const expectedNext = { 'table.occupied': 'table.dirty', 'table.dirty': 'table.cleared', 'table.cleared': 'table.occupied' };
  const lastByTable = new Map();
  for (const e of schedule) {
    const last = lastByTable.get(e.ref);
    if (last) assert.equal(e.event_type, expectedNext[last], `${e.ref}: ${last} -> ${e.event_type}`);
    else assert.equal(e.event_type, 'table.occupied');
    lastByTable.set(e.ref, e.event_type);
  }
});

test('footfall: lunch hours are busier than off-peak hours', () => {
  const schedule = factories.footfall('seed-a').generateSchedule(SIM_DATE);
  const avgCount = (hours) => {
    const counts = schedule
      .filter((e) => e.event_type === 'footfall.count' && hours.includes(new Date(e.occurred_at).getUTCHours()))
      .map((e) => e.payload.count);
    return counts.reduce((a, b) => a + b, 0) / counts.length;
  };
  assert.ok(avgCount([12, 13]) > avgCount([10, 11, 15, 16]));
});
