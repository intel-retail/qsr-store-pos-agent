/*
 * Copyright (c) 2026 Intel Corporation
 *
 * SPDX-License-Identifier: Apache-2.0
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { ScheduledProducer } = require('../src/service-common/producer');

const DAY = '2026-11-08';
const hourMs = (h) => Date.parse(`${DAY}T00:00:00.000Z`) + h * 3600_000;

class HourlyProducer extends ScheduledProducer {
  generateSchedule(simDate) {
    return Array.from({ length: 10 }, (_, i) => ({
      event_id: `${simDate}-${i}`,
      occurred_at: new Date(Date.parse(`${simDate}T07:00:00.000Z`) + i * 3600_000).toISOString(),
    }));
  }
}

function setup({ latest, missing = [] }) {
  const published = [];
  const backfilled = [];
  const tailMs = latest ? new Date(latest.occurred_at).getTime() : -Infinity;
  const log = {
    latestEvent: async () => latest,
    appendMany: async (envs) => { backfilled.push(...envs.map((e) => e.event_id)); return envs.length; },
    // Like the real log: an id that is already stored (at or before the tail, unless listed in `missing`) is not re-inserted.
    append: async (env) => (new Date(env.occurred_at).getTime() <= tailMs && !missing.includes(env.event_id) ? null : env),
  };
  const hub = { publish: (env) => published.push(env.event_id) };
  const producer = new HourlyProducer({ label: 't', log, hub, seed: 's' });
  return { producer, published, backfilled };
}

// One simulated hour per real second; fires up to the next-day rollover (19+ s away) but not past it.
const run = async (t, producer, opts) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = await producer.runLive({ simDate: DAY, speed: 3600, ...opts });
  t.mock.timers.tick(15_000);
  producer.stop();
  return pending;
};

test('without resume the whole day is published from the start', async (t) => {
  const { producer, published } = setup({ latest: null });
  assert.equal(await run(t, producer), 10);
  assert.equal(published.length, 10);
});

test('resume publishes only what is after the stored tail and backfills the rest silently', async (t) => {
  const latest = { occurred_at: new Date(hourMs(10)), sim_date: DAY }; // 10:00 = event index 3
  const { producer, published, backfilled } = setup({ latest });
  assert.equal(await run(t, producer, { resume: true }), 7);
  assert.deepEqual(backfilled, [0, 1, 2].map((i) => `${DAY}-${i}`));
  assert.deepEqual(published, [4, 5, 6, 7, 8, 9].map((i) => `${DAY}-${i}`));
});

test('resume publishes a sibling event at the tail instant that was never stored', async (t) => {
  const latest = { occurred_at: new Date(hourMs(10)), sim_date: DAY };
  const { producer, published } = setup({ latest, missing: [`${DAY}-3`] });
  await run(t, producer, { resume: true });
  assert.deepEqual(published, [3, 4, 5, 6, 7, 8, 9].map((i) => `${DAY}-${i}`));
});

test('resume continues on a later stored day instead of replaying today', async (t) => {
  const latest = { occurred_at: new Date(Date.parse('2026-11-10T12:00:00.000Z')), sim_date: '2026-11-10' };
  const { producer, published } = setup({ latest });
  await run(t, producer, { resume: true });
  assert.ok(published.length > 0 && published.every((id) => id.startsWith('2026-11-10-')));
});

test('resume with an old tail behaves like a fresh day', async (t) => {
  const latest = { occurred_at: new Date(hourMs(-20)), sim_date: '2026-11-07' };
  const { producer, published, backfilled } = setup({ latest });
  assert.equal(await run(t, producer, { resume: true }), 10);
  assert.equal(backfilled.length, 0);
  assert.equal(published.length, 10);
});
