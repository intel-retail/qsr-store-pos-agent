/*
 * Copyright (c) 2026 Intel Corporation
 *
 * SPDX-License-Identifier: Apache-2.0
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { READ_ONLY, ACTION, toolNames } = require('../src/service-common/mcpTransport');

test('annotation constants cannot be mutated through one tool', () => {
  assert.ok(Object.isFrozen(READ_ONLY));
  assert.ok(Object.isFrozen(ACTION));
  assert.throws(() => { 'use strict'; READ_ONLY.readOnlyHint = false; }, TypeError);
});

test('toolNames splits by readOnlyHint and treats unannotated tools as actions', () => {
  const tools = [
    { name: 'get_x', annotations: READ_ONLY },
    { name: 'set_x', annotations: ACTION },
    { name: 'legacy' },
    { name: 'odd', annotations: { readOnlyHint: 'yes' } },
  ];
  assert.deepEqual(toolNames(tools, true), ['get_x']);
  assert.deepEqual(toolNames(tools, false), ['set_x', 'legacy', 'odd']);
});
