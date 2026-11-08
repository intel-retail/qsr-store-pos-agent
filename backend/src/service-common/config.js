/*
 * Copyright (c) 2026 Intel Corporation
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Environment parsing shared by every service entry point and MCP server.
// Malformed numeric values fall back to the default with a warning instead of
// becoming NaN (parseInt/parseFloat do), which would otherwise leak into
// ports, table counts and timer delays.

const { assertSimDate } = require('./envelope');

function warn(name, raw, detail) {
  console.warn(`[config] ${name}="${raw}" ${detail}`);
}

/** Integer env var; non-integers fall back to `fallback`, out-of-range values clamp to [min, max]. */
function envInt(name, fallback, { min = -Infinity, max = Infinity } = {}) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value)) {
    warn(name, raw, `is not an integer; using ${fallback}`);
    return fallback;
  }
  const clamped = Math.min(Math.max(value, min), max);
  if (clamped !== value) warn(name, raw, `is outside [${min}, ${max}]; using ${clamped}`);
  return clamped;
}

/** Positive finite number env var; anything else falls back to `fallback`. */
function envPositiveNumber(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    warn(name, raw, `is not a positive number; using ${fallback}`);
    return fallback;
  }
  return value;
}

function envFlag(name) {
  return process.env[name] === '1' || process.env[name] === 'true';
}

/** Enum env var; an unknown value is a startup error, since a typo like SOURCE=Real would silently disable a service path. */
function envChoice(name, choices, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  if (!choices.includes(raw)) {
    throw new Error(`${name} must be one of: ${choices.join(', ')} (got "${raw}")`);
  }
  return raw;
}

// '*' is treated as a literal origin string to match (never matches a real
// browser Origin header), not a wildcard: CORS is always an explicit allowlist.
function parseCorsOrigins(envName, label) {
  const origins = (process.env[envName] || 'http://localhost:4200').split(',').map((s) => s.trim());
  if (origins.includes('*')) {
    console.error(`[${label}] ${envName}=* no longer allows any origin — list the specific origin(s) to allow instead.`);
  }
  return origins;
}

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

/** Settings every producer-backed service reads from the environment. */
function loadCommonConfig() {
  const replayDate = process.env.SIM_REPLAY_DATE || todayUtc();
  assertSimDate(replayDate, 'SIM_REPLAY_DATE');
  return {
    SOURCE: envChoice('SOURCE', ['sim', 'real'], 'sim'),
    MODE: envChoice('SIM_MODE', ['live', 'replay'], 'live'),
    BENCHMARK: envFlag('SIM_BENCHMARK'),
    EXPERIENCE: process.env.SIM_EXPERIENCE || 'cafe',
    SEED: process.env.SIM_SEED || 'edgemart-default-seed',
    SPEED: envPositiveNumber('SIM_SPEED', 60),
    PRELOAD_DAYS: envInt('SIM_PRELOAD_DAYS', 0, { min: 0, max: 365 }),
    REPLAY_DATE: replayDate,
  };
}

const TABLE_COUNT_LIMITS = { min: 1, max: 200 };

function loadTableCount() {
  return envInt('CAFE_TABLE_COUNT', 15, TABLE_COUNT_LIMITS);
}

/** Broker credentials from MQTT_USERNAME / MQTT_PASSWORD (empty object when unset, e.g. a local anonymous broker). */
function mqttAuthOptions() {
  const username = process.env.MQTT_USERNAME;
  const password = process.env.MQTT_PASSWORD;
  return username ? { username, password } : {};
}

module.exports = {
  envInt,
  envPositiveNumber,
  envFlag,
  envChoice,
  parseCorsOrigins,
  todayUtc,
  loadCommonConfig,
  loadTableCount,
  mqttAuthOptions,
};
