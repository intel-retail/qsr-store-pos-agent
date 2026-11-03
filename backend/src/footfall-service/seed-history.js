/*
 * Copyright (c) 2026 Intel Corporation
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Preload history CLI — "restores in one command":
//   node backend/src/footfall-service/seed-history.js --days=14

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const { FootfallEventLog } = require('./eventLog');
const { FootfallProducer } = require('./producer');
const { loadCommonConfig } = require('../service-common/config');
const { runSeedHistoryCli } = require('../service-common/seedHistory');

runSeedHistoryCli({
  config: loadCommonConfig(),
  createLog: () => new FootfallEventLog(),
  createProducer: ({ log, seed, experience }) => new FootfallProducer({ log, hub: null, seed, experience }),
});
