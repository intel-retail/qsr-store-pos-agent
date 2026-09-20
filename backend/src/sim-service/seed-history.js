/*
 * Copyright (c) 2026 Intel Corporation
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Preload history CLI — "restores in one command":
//   node backend/src/sim-service/seed-history.js --days=14
//
// Materializes N deterministic days directly into the durable log (no hub
// fanout, no real-time pacing) so a freshly cloned box already has enough
// history for comparative questions (query_history / compare_to_baseline).

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const { SimEventLog } = require('./eventLog');
const { SimProducer } = require('./producer');

function parseArg(name, fallback) {
  const prefix = `--${name}=`;
  const match = process.argv.find((a) => a.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}

async function main() {
  const daysArg = parseArg('days', '14');
  const days = parseInt(daysArg, 10);
  if (!Number.isInteger(days) || days <= 0) {
    console.error(`[seed-history] --days must be a positive integer (got "${daysArg}")`);
    process.exit(1);
  }
  const seed = process.env.SIM_SEED || 'edgemart-default-seed';
  const experience = process.env.SIM_EXPERIENCE || 'cafe';
  const tableCount = parseInt(process.env.CAFE_TABLE_COUNT || '15');

  const log = new SimEventLog();
  await log.init();
  const producer = new SimProducer({ log, hub: null, seed, experience, tableCount });

  const today = new Date();
  for (let i = days; i >= 1; i--) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    const simDate = d.toISOString().slice(0, 10);
    const { total, inserted, skipped } = await producer.materializeDay(simDate);
    console.log(`[seed-history] ${simDate}: ${inserted} inserted, ${skipped} already present (${total} total)`);
  }

  await log.close();
  console.log(`[seed-history] done — ${days} day(s) preloaded for experience=${experience}, seed=${seed}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
