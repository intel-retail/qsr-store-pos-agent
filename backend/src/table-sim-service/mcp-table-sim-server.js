/*
 * Copyright (c) 2026 Intel Corporation
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// MCP server for the table occupancy & cleaning sim service: describe / read /
// act only — identical contract shape to sim-service's MCP server (issue
// #100/#101), reusing its hub and envelope modules directly. Push events go
// to the hub, not through MCP.

const { z } = require('zod');
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const { TableEventLog } = require('./eventLog');
const { SimEventHub } = require('../sim-service/hub');
const { EVENT_TYPES, SEVERITIES, createEnvelope } = require('../sim-service/envelope');
const { connectTransport } = require('../sim-service/mcpTransport');

const SOURCE = process.env.SOURCE || 'sim'; // 'sim' | 'real'
const BENCHMARK = process.env.SIM_BENCHMARK === '1' || process.env.SIM_BENCHMARK === 'true';
const EXPERIENCE_DEFAULT = process.env.SIM_EXPERIENCE || 'cafe';

const TABLE_EVENT_TYPE_DESCRIPTIONS = {
  [EVENT_TYPES.TABLE_OCCUPIED]: 'A table was seated by a dine-in customer.',
  [EVENT_TYPES.TABLE_DIRTY]: 'A table was vacated and needs clearing.',
  [EVENT_TYPES.TABLE_CLEARED]: 'A table was cleared and is available again.',
};

const TOOLS = [
  {
    name: 'describe_service',
    description: 'Describe this table occupancy & cleaning service: source mode, envelope schema, and capabilities.',
    parameters: z.object({}),
  },
  {
    name: 'list_event_types',
    description: 'List the table event types this service publishes, with what triggers each.',
    parameters: z.object({}),
  },
  {
    name: 'get_utilization',
    description: 'Read: per-table utilization (occupied time / period time) and occupied-cycle count over a date range.',
    parameters: z.object({
      experience: z.string().describe("default 'cafe'").optional(),
      table_ref: z.string().describe("Limit to one table, e.g. 'table-4'").optional(),
      start_date: z.string().describe('YYYY-MM-DD').optional(),
      end_date: z.string().describe('YYYY-MM-DD').optional(),
    }),
  },
  {
    name: 'get_dirty_duration_stats',
    description: 'Read: how long tables sat dirty before being cleared — count/avg/min/max, overall and per table. This is what "dirty > N minutes" detection is built on.',
    parameters: z.object({
      experience: z.string().optional(),
      table_ref: z.string().optional(),
      start_date: z.string().describe('YYYY-MM-DD').optional(),
      end_date: z.string().describe('YYYY-MM-DD').optional(),
    }),
  },
  {
    name: 'get_table_history',
    description: 'Read: the full occupied/dirty/cleared timeline for one table, most recent first.',
    parameters: z.object({
      experience: z.string().optional(),
      table_ref: z.string().describe("e.g. 'table-4'"),
      limit: z.number().describe('Max rows (default 100)').optional(),
    }),
  },
  {
    name: 'mark_table_cleared',
    description: 'Action: mark a table cleared. Appends a table.cleared event to the durable log and publishes it to the hub.',
    parameters: z.object({
      experience: z.string().optional(),
      table_ref: z.string().describe("e.g. 'table-4'"),
    }),
  },
  {
    name: 'mark_table_occupied',
    description: 'Action: mark a table occupied. Appends a table.occupied event to the durable log and publishes it to the hub.',
    parameters: z.object({
      experience: z.string().optional(),
      table_ref: z.string().describe("e.g. 'table-4'"),
    }),
  },
];

let log = null;
let hub = null;

function getLog() {
  if (!log) log = new TableEventLog();
  return log;
}

function getHub() {
  if (!hub) {
    // Distinct topic prefix from sim-service's hub, so the two producers'
    // table.* streams never land on the same MQTT topic tree.
    hub = new SimEventHub({ enabled: !BENCHMARK, mqttTopicPrefix: 'table-sim' });
    hub.connectMqtt();
  }
  return hub;
}

function handleDescribeService() {
  return {
    name: 'edgemart-table-sim-service',
    source: SOURCE,
    benchmark_mode: BENCHMARK,
    contract: 'describe / read / act (issue #100 / #101). Live push events go to the hub (SSE + MQTT topic tree), not through MCP.',
    envelope_schema: {
      event_id: 'uuid',
      event_type: Object.keys(TABLE_EVENT_TYPE_DESCRIPTIONS).map((k) => k),
      severity: Object.values(SEVERITIES),
      source: ['sim', 'real'],
      experience: ['cafe'],
      ref: "table id, e.g. 'table-4'",
      occurred_at: 'ISO-8601 timestamp',
      sim_date: 'YYYY-MM-DD calendar day the event belongs to',
      seed: 'seed that generated this event, null for real/manual events',
      payload: 'event-specific object',
    },
  };
}

function handleListEventTypes() {
  return Object.entries(TABLE_EVENT_TYPE_DESCRIPTIONS).map(([event_type, description]) => ({ event_type, description }));
}

function handleGetUtilization(args, experience) {
  return getLog().getUtilization({
    experience,
    tableRef: args.table_ref,
    startDate: args.start_date,
    endDate: args.end_date,
  });
}

function handleGetDirtyDurationStats(args, experience) {
  return getLog().getDirtyDurationStats({
    experience,
    tableRef: args.table_ref,
    startDate: args.start_date,
    endDate: args.end_date,
  });
}

function handleGetTableHistory(args, experience) {
  if (!args.table_ref) return { error: 'table_ref is required' };
  return getLog().getTableHistory({ experience, tableRef: args.table_ref, limit: args.limit || 100 });
}

/** Shared by mark_table_cleared/mark_table_occupied — same shape, only the event_type differs. */
async function markTable(args, experience, eventType) {
  if (!args.table_ref) return { error: 'table_ref is required' };
  const envelope = createEnvelope({
    eventType,
    severity: SEVERITIES.INFO,
    source: 'sim',
    experience,
    ref: args.table_ref,
    simDate: new Date().toISOString().slice(0, 10),
    payload: { via: 'mcp-action' },
  });
  const saved = await getLog().append(envelope);
  if (saved) getHub().publish(envelope);
  return { success: true, event: envelope };
}

function handleMarkTableCleared(args, experience) {
  return markTable(args, experience, EVENT_TYPES.TABLE_CLEARED);
}

function handleMarkTableOccupied(args, experience) {
  return markTable(args, experience, EVENT_TYPES.TABLE_OCCUPIED);
}

// One handler per tool so no single function accumulates every tool's branches.
const TOOL_HANDLERS = {
  describe_service: handleDescribeService,
  list_event_types: handleListEventTypes,
  get_utilization: handleGetUtilization,
  get_dirty_duration_stats: handleGetDirtyDurationStats,
  get_table_history: handleGetTableHistory,
  mark_table_cleared: handleMarkTableCleared,
  mark_table_occupied: handleMarkTableOccupied,
};

async function handleTool(name, args = {}) {
  const experience = args.experience || EXPERIENCE_DEFAULT;
  const handler = TOOL_HANDLERS[name];
  if (!handler) return { error: `Unknown tool: ${name}` };
  return handler(args, experience);
}

async function main() {
  await getLog().init();
  await connectTransport({ name: 'edgemart-table-sim-service', label: 'table-sim-service', httpPort: 3201, tools: TOOLS, handleTool });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
