/*
 * Copyright (c) 2026 Intel Corporation
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Preload-history CLI shared by the three services: materializes N
// deterministic days directly into a service's durable log (no hub fanout, no
// real-time pacing) so a freshly cloned box already has history for
// comparative questions. Safe to re-run — deterministic ids mean only gaps
// are filled.

const MAX_DAYS = 3650;

function parseArg(name, fallback) {
  const prefix = `--${name}=`;
  const match = process.argv.find((a) => a.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}

/**
 * @param {object} opts
 * @param {Function} opts.createLog                  () => event log
 * @param {Function} opts.createProducer             ({ log, seed, experience }) => producer
 * @param {{SEED: string, EXPERIENCE: string}} opts.config
 */
async function runSeedHistory({ createLog, createProducer, config }) {
  const daysArg = parseArg('days', '14');
  const days = Number(daysArg);
  if (!Number.isInteger(days) || days <= 0 || days > MAX_DAYS) {
    console.error(`[seed-history] --days must be an integer between 1 and ${MAX_DAYS} (got "${daysArg}")`);
    process.exit(1);
  }
  const { SEED: seed, EXPERIENCE: experience } = config;

  const log = createLog();
  try {
    await log.init();
    const producer = createProducer({ log, seed, experience });

    const today = new Date();
    for (let i = days; i >= 1; i--) {
      const d = new Date(today);
      d.setUTCDate(d.getUTCDate() - i);
      const simDate = d.toISOString().slice(0, 10);
      const { total, inserted, skipped } = await producer.materializeDay(simDate);
      console.log(`[seed-history] ${simDate}: ${inserted} inserted, ${skipped} already present (${total} total)`);
    }
    console.log(`[seed-history] done — ${days} day(s) preloaded for experience=${experience}, seed=${seed}`);
  } finally {
    await log.close();
  }
}

/** Runs `runSeedHistory` as a CLI entry point (logs and exits non-zero on failure). */
function runSeedHistoryCli(opts) {
  runSeedHistory(opts).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { runSeedHistory, runSeedHistoryCli };
