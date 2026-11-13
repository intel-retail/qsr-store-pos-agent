/*
 * Copyright (c) 2026 Intel Corporation
 *
 * SPDX-License-Identifier: Apache-2.0
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const { attachAgentForwarder, toAgentEvent } = require('../src/service-common/agentForwarder');

const envelope = (over = {}) => ({
  event_id: 'e1', experience: 'cafe', event_type: 'table.dirty', severity: 'info', source: 'sim',
  ref: 'table-4', occurred_at: '2026-11-08T10:00:00.000Z', sim_date: '2026-11-08', seed: 's', payload: { note: 'x' },
  ...over,
});

const response = (status, body = { ok: true, duplicate: false }) => ({
  status, ok: status < 400, json: async () => body, text: async () => JSON.stringify(body),
});

function setup({ env = {}, config = { SOURCE: 'sim', MODE: 'live', BENCHMARK: false }, fetchImpl, defaultFilter } = {}) {
  const hub = new EventEmitter();
  const calls = [];
  const fetchFake = fetchImpl || (async (url, init) => { calls.push({ url, init, body: JSON.parse(init.body) }); return response(202); });
  const wrapped = async (url, init) => { const r = await fetchFake(url, init); if (fetchImpl) calls.push({ url, init, body: JSON.parse(init.body) }); return r; };
  const forwarder = attachAgentForwarder({
    hub, label: 't', service: 'table-occupancy-service', defaultEventTypes: ['table.dirty'], defaultFilter, config, fetchImpl: wrapped,
    env: { QSR_AGENT_EVENT_URL: 'http://agent:8600/autonomy/events', QSR_AGENT_MIN_INTERVAL_MS: '0', QSR_AGENT_EVENT_ID_SALT: '', ...env },
  });
  return { hub, calls, forwarder };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test('maps an envelope to the agent contract', () => {
  const event = toAgentEvent(envelope(), { service: 'table-occupancy-service', storeId: 'qsr-001' });
  assert.deepEqual(event, {
    event_id: 'e1',
    event_type: 'table.dirty',
    service: 'table-occupancy-service',
    store_id: 'qsr-001',
    occurred_at: '2026-11-08T10:00:00.000Z',
    data: { note: 'x', ref: 'table-4', severity: 'info', experience: 'cafe', source: 'sim', simulated: true, venue: 'table-occupancy-service' },
  });
});

test('salts event ids per run so a reset log does not collide with ids the agent already holds', async () => {
  const explicit = setup({ env: { QSR_AGENT_EVENT_ID_SALT: 'run1' } });
  explicit.hub.emit('event', envelope());
  await settle();
  assert.equal(explicit.calls[0].body.event_id, 'e1@run1');

  const auto = setup({ env: { QSR_AGENT_EVENT_ID_SALT: undefined } });
  auto.hub.emit('event', envelope());
  await settle();
  assert.match(auto.calls[0].body.event_id, /^e1@[0-9a-z]+$/);
});

test('is off without QSR_AGENT_EVENT_URL, in benchmark and in replay', () => {
  assert.equal(attachAgentForwarder({ hub: new EventEmitter(), label: 't', service: 's', defaultEventTypes: [], config: {}, env: {} }), null);
  assert.equal(setup({ config: { SOURCE: 'sim', MODE: 'live', BENCHMARK: true } }).forwarder, null);
  assert.equal(setup({ config: { SOURCE: 'sim', MODE: 'replay', BENCHMARK: false } }).forwarder, null);
});

test('posts allowed events and ignores others', async () => {
  const { hub, calls } = setup();
  hub.emit('event', envelope());
  hub.emit('event', envelope({ event_id: 'e2', event_type: 'table.cleared' }));
  await settle();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://agent:8600/autonomy/events');
  assert.equal(calls[0].body.event_id, 'e1');
  assert.equal(calls[0].init.headers.Authorization, undefined);
});

test('QSR_AGENT_EVENT_TYPES overrides defaults and * forwards everything', async () => {
  const only = setup({ env: { QSR_AGENT_EVENT_TYPES: 'table.cleared' } });
  only.hub.emit('event', envelope());
  only.hub.emit('event', envelope({ event_id: 'e2', event_type: 'table.cleared' }));
  await settle();
  assert.deepEqual(only.calls.map((c) => c.body.event_id), ['e2']);

  const all = setup({ env: { QSR_AGENT_EVENT_TYPES: '*' } });
  all.hub.emit('event', envelope({ event_type: 'anything' }));
  await settle();
  assert.equal(all.calls.length, 1);
});

test('default filter drops minor events, but an explicit type list bypasses it', async () => {
  const defaultFilter = (e) => e.payload?.density === 'high';
  const { hub, calls } = setup({ defaultFilter });
  hub.emit('event', envelope({ event_id: 'lo', ref: 'a', payload: { density: 'low' } }));
  hub.emit('event', envelope({ event_id: 'hi', ref: 'b', payload: { density: 'high' } }));
  await settle();
  assert.deepEqual(calls.map((c) => c.body.event_id), ['hi']);

  const explicit = setup({ defaultFilter, env: { QSR_AGENT_EVENT_TYPES: 'table.dirty' } });
  explicit.hub.emit('event', envelope({ event_id: 'lo', payload: { density: 'low' } }));
  await settle();
  assert.equal(explicit.calls.length, 1);
});

test('throttles repeats per event type and ref, not across refs', async () => {
  const { hub, calls, forwarder } = setup({ env: { QSR_AGENT_MIN_INTERVAL_MS: '60000' } });
  hub.emit('event', envelope({ event_id: 'a' }));
  hub.emit('event', envelope({ event_id: 'b' }));
  hub.emit('event', envelope({ event_id: 'c', ref: 'table-5' }));
  await settle();
  assert.deepEqual(calls.map((c) => c.body.event_id), ['a', 'c']);
  assert.equal(forwarder.stats().throttled, 1);
});

test('sends the bearer token when configured', async () => {
  const { hub, calls } = setup({ env: { QSR_AGENT_API_KEY: 'k' } });
  hub.emit('event', envelope());
  await settle();
  assert.equal(calls[0].init.headers.Authorization, 'Bearer k');
});

test('a 4xx is not retried and does not stop later events', async () => {
  let n = 0;
  const { hub, calls, forwarder } = setup({ fetchImpl: async () => (++n === 1 ? response(400, { error: 'bad' }) : response(202)) });
  hub.emit('event', envelope({ event_id: 'a' }));
  hub.emit('event', envelope({ event_id: 'b', ref: 'table-5' }));
  await settle(); await settle();
  assert.equal(calls.length, 2);
  assert.equal(forwarder.stats().failed, 1);
  assert.equal(forwarder.stats().sent, 1);
});

test('a transient failure is retried with the same event', async () => {
  let n = 0;
  const { hub, calls, forwarder } = setup({ fetchImpl: async () => (++n === 1 ? response(503) : response(202)) });
  hub.emit('event', envelope());
  await new Promise((resolve) => setTimeout(resolve, 1200));
  assert.equal(calls.length, 2);
  assert.equal(calls[0].body.event_id, calls[1].body.event_id);
  assert.equal(forwarder.stats().sent, 1);
  forwarder.stop();
});

test('a retryable response body is cancelled so the connection is released', async () => {
  let cancelled = 0;
  let n = 0;
  const { hub, forwarder } = setup({
    fetchImpl: async () => (++n === 1 ? { ...response(503), body: { cancel: async () => { cancelled += 1; } } } : response(202)),
  });
  hub.emit('event', envelope());
  await new Promise((resolve) => setTimeout(resolve, 1200));
  assert.equal(cancelled, 1);
  forwarder.stop();
});

test('counts duplicates reported by the agent', async () => {
  const { hub, forwarder } = setup({ fetchImpl: async () => response(202, { ok: true, duplicate: true }) });
  hub.emit('event', envelope());
  await settle();
  assert.equal(forwarder.stats().duplicate, 1);
});
