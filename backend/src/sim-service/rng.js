/*
 * Copyright (c) 2026 Intel Corporation
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Deterministic seeded RNG. Same (baseSeed, key) always produces the same
// numeric seed and therefore the same output sequence — this is what makes
// "the same day replays identically" possible.

// xmur3 string hash -> 32-bit seed generator.
function xmur3(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}

// mulberry32 PRNG: fast, deterministic, good enough distribution for simulation.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Returns a next()-style RNG function seeded from `${baseSeed}:${key}`. */
function createSeededRng(baseSeed, key) {
  const seedFn = xmur3(`${baseSeed}:${key}`);
  return mulberry32(seedFn());
}

/**
 * Deterministic, content-derived UUID (v4-shaped, not random). Same `key` always
 * produces the same id, so regenerating a schedule (restart, replay, re-seed)
 * never mints a new event_id for the same logical event — the log's
 * ON CONFLICT (event_id) DO NOTHING dedup can actually do its job.
 */
function deterministicUuid(key) {
  const hex = [0, 1, 2, 3]
    .map((i) => xmur3(`${key}#${i}`)().toString(16).padStart(8, '0'))
    .join('');
  const variantNibble = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `${variantNibble}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join('-');
}

module.exports = { createSeededRng, mulberry32, xmur3, deterministicUuid };
