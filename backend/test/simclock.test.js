/*
 * Copyright (c) 2026 Intel Corporation
 *
 * SPDX-License-Identifier: Apache-2.0
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { actionTiming, currentTimeMs } = require('../src/service-common/publish');
const { StoreActivityProducer } = require('../src/store-activity-service/producer');

const latest = { occurred_at: new Date('2026-05-22T10:30:00.000Z'), sim_date: '2026-05-22' };
const logWith = (row) => ({ latestEvent: async () => row });

test('sim actions are stamped with the sim clock', async () => {
  assert.deepEqual(await actionTiming(logWith(latest), 'sim'), {
    simDate: '2026-05-22',
    occurredAt: '2026-05-22T10:30:00.000Z',
  });
  assert.equal(await currentTimeMs(logWith(latest), 'sim'), latest.occurred_at.getTime());
});

test('real actions use the wall clock and never read the log', async () => {
  const log = { latestEvent: async () => { throw new Error('should not be called'); } };
  const timing = await actionTiming(log, 'real');
  assert.equal(timing.occurredAt, undefined);
  assert.match(timing.simDate, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(Math.abs(await currentTimeMs(log, 'real') - Date.now()) < 1000);
});

test('an empty sim log falls back to the wall clock', async () => {
  assert.equal((await actionTiming(logWith(null), 'sim')).occurredAt, undefined);
});

test('store-activity: tables are never double-booked, even when scarce', () => {
  const producer = new StoreActivityProducer({ log: {}, seed: 'seed-a', tableCount: 2 });
  const schedule = producer.generateSchedule('2026-05-20');
  const state = new Map();
  for (const e of schedule.filter((x) => x.event_type.startsWith('table.'))) {
    const prev = state.get(e.ref) ?? 'table.cleared';
    const expected = { 'table.cleared': 'table.occupied', 'table.occupied': 'table.dirty', 'table.dirty': 'table.cleared' };
    assert.equal(e.event_type, expected[prev], `${e.ref}: ${prev} -> ${e.event_type}`);
    state.set(e.ref, e.event_type);
  }
  // Demoted diners must be reported as takeout on arrival.
  const seated = schedule.filter((e) => e.event_type === 'table.occupied').length;
  const dineInArrivals = schedule.filter((e) => e.event_type === 'customer.arrived' && e.payload.dineIn).length;
  assert.equal(seated, dineInArrivals);
});
