/*
 * Copyright (c) 2026 Intel Corporation
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Event hub: dedups and fans out envelope events on one SSE stream and one
// MQTT topic tree, mirroring the alert-agent-service "rule-based mode" shape
// described in issue #101. Push only — MCP is not involved in this path.
//
// A single flag (benchmark mode) disables fanout entirely for clean,
// deterministic benchmark runs while the durable log keeps recording.

const EventEmitter = require('events');

const DEFAULT_MAX_SEEN = 5000;

class SimEventHub extends EventEmitter {
  constructor(options = {}) {
    super();
    this.enabled = options.enabled !== false;
    this.mqttBrokerUrl = options.mqttBrokerUrl || process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883';
    this.mqttTopicPrefix = options.mqttTopicPrefix || 'sim';
    this.maxSeen = options.maxSeen || DEFAULT_MAX_SEEN;
    this._seenEventIds = new Set();
    this.sseClients = new Set();
    this.mqttClient = null;
  }

  /** Best-effort MQTT connection; hub still works SSE-only if mqtt is unavailable/disabled. */
  connectMqtt() {
    if (!this.enabled) return;
    let mqtt;
    try {
      mqtt = require('mqtt');
    } catch {
      console.warn('[SimHub] mqtt package not installed; SSE-only fanout.');
      return;
    }
    this.mqttClient = mqtt.connect(this.mqttBrokerUrl, {
      reconnectPeriod: 5000,
      connectTimeout: 10000,
      // pid + random suffix, not just Date.now() — two hubs (e.g. sim-service and
      // table-sim-service) starting in the same millisecond would otherwise get an
      // identical client ID, and MQTT brokers disconnect the older duplicate on
      // every connect, causing the two processes to fight forever.
      clientId: `sim-hub-${this.mqttTopicPrefix}-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    });
    this.mqttClient.on('error', (err) => console.error('[SimHub] MQTT error:', err.message));

    // Subscribe to our own topic tree so events published by another process on
    // this broker (e.g. an MCP server's action tools, which run in a separate
    // process with their own hub instance) still reach this hub's SSE clients,
    // not just events this specific process originated.
    this.mqttClient.on('connect', () => {
      this.mqttClient.subscribe(`${this.mqttTopicPrefix}/+/events/#`, (err) => {
        if (err) console.error('[SimHub] MQTT subscribe error:', err.message);
      });
    });
    this.mqttClient.on('message', (_topic, buf) => this._onMqttMessage(buf));
  }

  /** Envelope arriving from another process via MQTT — dedup, then mirror to SSE (it's already on MQTT). */
  _onMqttMessage(buf) {
    let envelope;
    try {
      envelope = JSON.parse(buf.toString());
    } catch (err) {
      console.error('[SimHub] Failed to parse incoming MQTT payload:', err.message);
      return;
    }
    // A missing event_id would dedup-poison _seenEventIds against `undefined`,
    // silently swallowing every subsequent malformed message — reject up front instead.
    if (!envelope || typeof envelope.event_id !== 'string' || !envelope.event_type) {
      console.warn('[SimHub] Ignoring malformed MQTT payload (missing event_id/event_type).');
      return;
    }
    this._deliver(envelope, { alreadyOnMqtt: true });
  }

  /**
   * Register an Express response as an SSE subscriber, synchronously and
   * before any backfill lookup — so a client reconnecting with Last-Event-ID
   * can never miss an event published while its backfill query runs. `getReplay`
   * (if given) is awaited *after* registering; anything it returns that was
   * already delivered live in the meantime is de-duped via `_sentEventIds`.
   */
  attachSSE(req, res, { getReplay } = {}) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.write(': connected\n\n');
    if (!this.enabled) {
      res.write(': benchmark-mode active, fanout disabled\n\n');
    }
    res._sentEventIds = new Set();
    this.sseClients.add(res);

    if (getReplay) {
      Promise.resolve(getReplay())
        .then((replay) => {
          for (const envelope of replay) {
            if (res._sentEventIds.has(envelope.event_id) || res.writableEnded) continue;
            this._writeSseMessage(res, envelope);
          }
        })
        .catch((err) => console.error('[SimHub] Failed to write SSE replay:', err.message));
    }

    // Keep the connection alive (and visibly non-stalled) even when no events
    // fire for a while, e.g. overnight or while benchmark mode is on.
    const heartbeat = setInterval(() => {
      if (!res.writableEnded) res.write(': keepalive\n\n');
    }, 15000);

    req.on('close', () => {
      clearInterval(heartbeat);
      this.sseClients.delete(res);
    });
  }

  /** `id:` is the envelope's event_id, so a client's Last-Event-ID header round-trips cleanly. */
  _writeSseMessage(res, envelope) {
    res.write(`id: ${envelope.event_id}\ndata: ${JSON.stringify(envelope)}\n\n`);
  }

  /**
   * Publish an envelope: dedups by event_id, then fans out to SSE + MQTT
   * unless benchmark mode has disabled fanout. Always emits locally so an
   * in-process listener (e.g. the agent inbox writer) still sees it.
   */
  publish(envelope) {
    return this._deliver(envelope, { alreadyOnMqtt: false });
  }

  /** Shared by publish() (locally-originated) and _onMqttMessage() (received from another process). */
  _deliver(envelope, { alreadyOnMqtt }) {
    if (this._seenEventIds.has(envelope.event_id)) return false;
    this._seenEventIds.add(envelope.event_id);
    if (this._seenEventIds.size > this.maxSeen) {
      this._seenEventIds.delete(this._seenEventIds.values().next().value);
    }

    this.emit('event', envelope);

    if (!this.enabled) return true;

    for (const client of this.sseClients) {
      this._writeSseMessage(client, envelope);
      if (client._sentEventIds) client._sentEventIds.add(envelope.event_id);
    }

    if (!alreadyOnMqtt && this.mqttClient) {
      const topic = `${this.mqttTopicPrefix}/${envelope.experience}/events/${envelope.event_type}`;
      this.mqttClient.publish(topic, JSON.stringify(envelope));
    }

    return true;
  }

  close() {
    if (this.mqttClient) this.mqttClient.end();
    for (const client of this.sseClients) client.end();
    this.sseClients.clear();
  }
}

module.exports = { SimEventHub };
