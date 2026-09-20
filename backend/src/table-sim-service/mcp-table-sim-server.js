/*
 * Copyright (c) 2026 Intel Corporation
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// MCP server for the table occupancy & cleaning sim service: describe / read /
// act only — identical contract shape to sim-service's MCP server (issue
// #100/#101), reusing its hub and envelope modules directly. Push events go
// to the hub, not through MCP.

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js');
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const { TableEventLog } = require('./eventLog');
const { SimEventHub } = require('../sim-service/hub');
const { EVENT_TYPES, SEVERITIES, createEnvelope } = require('../sim-service/envelope');

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
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'list_event_types',
    description: 'List the table event types this service publishes, with what triggers each.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_utilization',
    description: 'Read: per-table utilization (occupied time / period time) and occupied-cycle count over a date range.',
    inputSchema: {
      type: 'object',
      properties: {
        experience: { type: 'string', description: "default 'cafe'" },
        table_ref: { type: 'string', description: "Limit to one table, e.g. 'table-4'" },
        start_date: { type: 'string', description: 'YYYY-MM-DD' },
        end_date: { type: 'string', description: 'YYYY-MM-DD' },
      },
    },
  },
  {
    name: 'get_dirty_duration_stats',
    description: 'Read: how long tables sat dirty before being cleared — count/avg/min/max, overall and per table. This is what "dirty > N minutes" detection is built on.',
    inputSchema: {
      type: 'object',
      properties: {
        experience: { type: 'string' },
        table_ref: { type: 'string' },
        start_date: { type: 'string', description: 'YYYY-MM-DD' },
        end_date: { type: 'string', description: 'YYYY-MM-DD' },
      },
    },
  },
  {
    name: 'get_table_history',
    description: 'Read: the full occupied/dirty/cleared timeline for one table, most recent first.',
    inputSchema: {
      type: 'object',
      properties: {
        experience: { type: 'string' },
        table_ref: { type: 'string', description: "e.g. 'table-4'" },
        limit: { type: 'number', description: 'Max rows (default 100)' },
      },
      required: ['table_ref'],
    },
  },
  {
    name: 'mark_table_cleared',
    description: 'Action: mark a table cleared. Appends a table.cleared event to the durable log and publishes it to the hub.',
    inputSchema: {
      type: 'object',
      properties: {
        experience: { type: 'string' },
        table_ref: { type: 'string', description: "e.g. 'table-4'" },
      },
      required: ['table_ref'],
    },
  },
  {
    name: 'mark_table_occupied',
    description: 'Action: mark a table occupied. Appends a table.occupied event to the durable log and publishes it to the hub.',
    inputSchema: {
      type: 'object',
      properties: {
        experience: { type: 'string' },
        table_ref: { type: 'string', description: "e.g. 'table-4'" },
      },
      required: ['table_ref'],
    },
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

  const server = new Server(
    { name: 'edgemart-table-sim-service', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      const result = await handleTool(request.params.name, request.params.arguments || {});
      // A "soft" validation failure (e.g. missing table_ref) comes back as a
      // normal-looking { error } object rather than a thrown exception — flag
      // it the same way so a client can trust isError instead of parsing content.
      const isError = !!(result && typeof result === 'object' && !Array.isArray(result) && 'error' in result);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], isError };
    } catch (err) {
      return { content: [{ type: 'text', text: JSON.stringify({ error: err.message }) }], isError: true };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[table-sim-service] MCP server running on stdio');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
