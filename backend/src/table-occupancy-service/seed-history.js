/*
 * Copyright (c) 2026 Intel Corporation
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Preload history CLI — "restores in one command":
//   node backend/src/table-occupancy-service/seed-history.js --days=14

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const { TableEventLog } = require('./eventLog');
const { TableOccupancyProducer } = require('./producer');
const { loadCommonConfig, loadTableCount } = require('../service-common/config');
const { runSeedHistoryCli } = require('../service-common/seedHistory');

const tableCount = loadTableCount();

runSeedHistoryCli({
  config: loadCommonConfig(),
  createLog: () => new TableEventLog(),
  createProducer: ({ log, seed, experience }) => new TableOccupancyProducer({ log, hub: null, seed, experience, tableCount }),
});
