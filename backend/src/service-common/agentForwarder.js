/*
 * Copyright (c) 2026 Intel Corporation
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Pushes selected store events to the qsr-agent autonomy webhook
// (POST /autonomy/events). Subscribes to the in-process hub, so producer events,
// SOURCE=real ingests and actions from the MCP sidecars (which arrive over MQTT)
// are all covered. Disabled unless QSR_AGENT_EVENT_URL is set.

const QUEUE_LIMIT = 500;
const MAX_ATTEMPTS = 6;
const MAX_BACKOFF_MS = 10_000;
const MAX_KEYS = 5000;

/** Envelope -> the agent's {event_id, event_type, service, store_id, occurred_at, data} contract. */
function toAgentEvent(envelope, { service, storeId }) {
  return {
    event_id: envelope.event_id,
    event_type: envelope.event_type,
    service,
    store_id: storeId,
    occurred_at: envelope.occurred_at,
    data: {
      ...envelope.payload,
      ref: envelope.ref,
      severity: envelope.severity,
      experience: envelope.experience,
      source: envelope.source,
      simulated: envelope.source === 'sim',
      venue: service,
    },
  };
}

function nonNegative(raw, fallback) {
  const n = Number(raw);
  return raw !== undefined && raw !== '' && Number.isFinite(n) && n >= 0 ? n : fallback;
}

function parseEventTypes(raw, fallback) {
  const names = (raw ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (names.includes('*')) return null;
  return new Set(names.length > 0 ? names : fallback);
}

/**
 * @param {object} opts
 * @param {import('events').EventEmitter} opts.hub
 * @param {string} opts.label
 * @param {string} opts.service            Hermes MCP server name, e.g. 'table-occupancy-service'
 * @param {string[]} opts.defaultEventTypes forwarded unless QSR_AGENT_EVENT_TYPES overrides ('*' = all)
 * @param {Function} [opts.defaultFilter]   (envelope, env) => boolean; applies only while QSR_AGENT_EVENT_TYPES is unset
 * @param {object} opts.config             { SOURCE, MODE, BENCHMARK }
 * @param {Function} [opts.fetchImpl]
 * @returns {{stop: Function, stats: Function}|null} null when forwarding is off
 */
function attachAgentForwarder({ hub, label, service, defaultEventTypes, defaultFilter, config, fetchImpl = globalThis.fetch, env = process.env }) {
  const url = env.QSR_AGENT_EVENT_URL;
  if (!url) return null;
  if (config.BENCHMARK) {
    console.log(`[${label}] agent forwarding off: benchmark mode`);
    return null;
  }
  if (config.SOURCE === 'sim' && config.MODE === 'replay') {
    console.log(`[${label}] agent forwarding off: replay mode would re-send historical events`);
    return null;
  }

  const storeId = env.QSR_AGENT_STORE_ID || 'qsr-001';
  const allowed = parseEventTypes(env.QSR_AGENT_EVENT_TYPES, defaultEventTypes);
  const filter = (env.QSR_AGENT_EVENT_TYPES ?? '').trim() ? null : defaultFilter;
  const minIntervalMs = nonNegative(env.QSR_AGENT_MIN_INTERVAL_MS, 30000);
  const timeoutMs = nonNegative(env.QSR_AGENT_TIMEOUT_MS, 10000);
  const headers = { 'Content-Type': 'application/json' };
  if (env.QSR_AGENT_API_KEY) headers.Authorization = `Bearer ${env.QSR_AGENT_API_KEY}`;

  const queue = [];
  const lastSent = new Map();
  const stats = { sent: 0, duplicate: 0, failed: 0, throttled: 0, dropped: 0 };
  let draining = false;
  let stopped = false;
  let retryTimer = null;

  async function post(event) {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status === 429 || res.status >= 500) throw Object.assign(new Error(`HTTP ${res.status}`), { retry: true });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res.json().catch(() => ({}));
  }

  async function sendWithRetry(event) {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        const body = await post(event);
        if (body.duplicate) stats.duplicate += 1; else stats.sent += 1;
        return;
      } catch (err) {
        const transient = err.retry || err.name === 'TimeoutError' || err instanceof TypeError;
        if (!transient || attempt === MAX_ATTEMPTS || stopped) {
          stats.failed += 1;
          console.error(`[${label}] agent forward failed for ${event.event_type} ${event.event_id}: ${err.message}`);
          return;
        }
        await new Promise((resolve) => {
          retryTimer = setTimeout(resolve, Math.min(1000 * 2 ** (attempt - 1), MAX_BACKOFF_MS));
          retryTimer.unref?.();
        });
      }
    }
  }

  async function drain() {
    if (draining) return;
    draining = true;
    try {
      while (queue.length > 0 && !stopped) await sendWithRetry(queue.shift());
    } finally {
      draining = false;
    }
  }

  function onEvent(envelope) {
    if (allowed && !allowed.has(envelope.event_type)) return;
    if (filter && !filter(envelope, env)) return;
    // The agent runs one model call per event and re-reads live state over MCP, so
    // bursts of the same kind carry no extra information; keep the first in each window.
    const key = `${envelope.event_type}:${envelope.ref ?? ''}`;
    const now = Date.now();
    if (now - (lastSent.get(key) ?? -Infinity) < minIntervalMs) {
      stats.throttled += 1;
      return;
    }
    lastSent.set(key, now);
    if (lastSent.size > MAX_KEYS) lastSent.delete(lastSent.keys().next().value);

    if (queue.length >= QUEUE_LIMIT) {
      queue.shift();
      stats.dropped += 1;
    }
    queue.push(toAgentEvent(envelope, { service, storeId }));
    drain();
  }

  hub.on('event', onEvent);
  console.log(`[${label}] forwarding ${allowed ? [...allowed].join(',') : 'all'} events to ${url} as ${service}/${storeId}`);

  return {
    stats: () => ({ ...stats, queued: queue.length }),
    stop: () => {
      stopped = true;
      clearTimeout(retryTimer);
      hub.off('event', onEvent);
    },
  };
}

module.exports = { attachAgentForwarder, toAgentEvent };
