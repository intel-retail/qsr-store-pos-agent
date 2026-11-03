/*
 * Copyright (c) 2026 Intel Corporation
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Preload history CLI — "restores in one command":
//   node backend/src/store-activity-service/seed-history.js --days=14
//
// Materializes N deterministic days directly into the durable log (no hub
// fanout, no real-time pacing) so a freshly cloned box already has enough
// history for comparative questions (query_history / compare_to_baseline).

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const { StoreActivityEventLog } = require('./eventLog');
const { StoreActivityProducer } = require('./producer');
const { loadCommonConfig, loadTableCount } = require('../service-common/config');
const { runSeedHistoryCli } = require('../service-common/seedHistory');

const tableCount = loadTableCount();

runSeedHistoryCli({
  config: loadCommonConfig(),
  createLog: () => new StoreActivityEventLog(),
  createProducer: ({ log, seed, experience }) => new StoreActivityProducer({ log, hub: null, seed, experience, tableCount }),
});
