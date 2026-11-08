/*
 * Copyright (c) 2026 Intel Corporation
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// MCP server for the store activity service: describe / read / act only.
// Push events (live or replay) go to the hub separately — MCP is not involved
// in that path, it is how an agent queries history and acts.
//
// Standalone process, run alongside (not instead of) the existing
// backend/src/mcp-server.js and mcp-table-status.js.

const { z } = require('zod');
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const { StoreActivityEventLog } = require('./eventLog');
const { EventHub } = require('../service-common/hub');
const { EVENT_TYPES, SEVERITIES, createEnvelope } = require('./envelope');
const { optionalSimDate, assertSimDate } = require('../service-common/envelope');
const { connectTransport } = require('../service-common/mcpTransport');
const { loadCommonConfig } = require('../service-common/config');
const { appendAndPublish, actionSource, actionTiming } = require('../service-common/publish');

const { SOURCE, BENCHMARK, EXPERIENCE: EXPERIENCE_DEFAULT } = loadCommonConfig(); // SOURCE: 'sim' | 'real' — see STORE-ACTIVITY-SERVICE.md
const SERVICE_NAME = 'store-activity-service';

const EVENT_TYPE_DESCRIPTIONS = {
  [EVENT_TYPES.CUSTOMER_ARRIVED]: 'A customer entered the store/café.',
  [EVENT_TYPES.CUSTOMER_DEPARTED]: 'A customer left, dine-in or takeout.',
  [EVENT_TYPES.TABLE_OCCUPIED]: 'A table was seated by a dine-in customer.',
  [EVENT_TYPES.TABLE_DIRTY]: 'A table was vacated and needs clearing.',
  [EVENT_TYPES.TABLE_CLEARED]: 'A table was cleared and is available again.',
  [EVENT_TYPES.ORDER_PLACED]: 'An order was placed.',
  [EVENT_TYPES.ORDER_COMPLETED]: 'An order was prepared and handed off.',
  [EVENT_TYPES.QUEUE_DEPTH_CHANGED]: 'The number of customers waiting on an order changed.',
};

const TOOLS = [
  {
    name: 'describe_service',
    description: 'Describe this service: source mode, envelope schema, and capabilities. Call this first if you have never seen this service before.',
    parameters: z.object({}),
  },
  {
    name: 'list_event_types',
    description: 'List every event type this service can publish, with what triggers it.',
    parameters: z.object({}),
  },
  {
    name: 'query_history',
    description: 'Read event counts grouped by period (hour or day), optionally filtered by experience/event type/date range.',
    parameters: z.object({
      experience: z.string().describe("'cafe' or 'grocery', default 'cafe'").optional(),
      event_type: z.string().describe('Filter to one event type').optional(),
      group_by: z.enum(['hour', 'day']).describe('Bucket size, default day').optional(),
      start_date: z.string().describe('YYYY-MM-DD').optional(),
      end_date: z.string().describe('YYYY-MM-DD').optional(),
    }),
  },
  {
    name: 'compare_to_baseline',
    description: 'Compare event counts for one date against a baseline date, per event type.',
    parameters: z.object({
      experience: z.string().optional(),
      event_type: z.string().optional(),
      date: z.string().describe('YYYY-MM-DD'),
      baseline_date: z.string().describe('YYYY-MM-DD'),
    }),
  },
  {
    name: 'tail_events',
    description: 'Read events appended after a given log id (poll-based tail of the durable log).',
    parameters: z.object({
      since_id: z.number().describe('Return events with id greater than this (default 0)').optional(),
      limit: z.number().describe('Max rows (default 100)').optional(),
    }),
  },
  {
    name: 'get_current_snapshot',
    description: 'Get the latest known state per ref (e.g. per table) derived from the log — current table/queue status.',
    parameters: z.object({
      experience: z.string().optional(),
    }),
  },
  {
    name: 'mark_table_cleared',
    description: 'Action: mark a table cleared. Appends a table.cleared event to the durable log and publishes it to the hub, the same path a real action would use.',
    parameters: z.object({
      experience: z.string().optional(),
      table_ref: z.string().describe("e.g. 'table-4'"),
    }),
  },
  {
    name: 'inject_event',
    description: 'Action: manually inject an event of any known type onto the same envelope/log/hub path the producer uses. Useful for testing, and for a real pipeline (SOURCE=real) to submit events.',
    parameters: z.object({
      experience: z.string().optional(),
      event_type: z.string().describe('One of the types returned by list_event_types'),
      ref: z.string().optional(),
      severity: z.enum(Object.values(SEVERITIES)).optional(),
      payload: z.record(z.string(), z.unknown()).optional(),
    }),
  },
];

let log = null;
let hub = null;

function getLog() {
  if (!log) log = new StoreActivityEventLog();
  return log;
}

function getHub() {
  if (!hub) {
    hub = new EventHub({ enabled: !BENCHMARK });
    hub.connectMqtt();
  }
  return hub;
}

function handleDescribeService() {
  return {
    name: SERVICE_NAME,
    source: SOURCE,
    benchmark_mode: BENCHMARK,
    contract: 'describe / read / act. Live push events go to the hub (SSE + MQTT topic tree), not through MCP.',
    envelope_schema: {
      event_id: 'uuid',
      event_type: 'enum — see list_event_types',
      severity: Object.values(SEVERITIES),
      source: ['sim', 'real'],
      experience: ['cafe', 'grocery'],
      ref: 'string correlation handle (table id, customer id, "queue"), used to drill into detail via a read tool',
      occurred_at: 'ISO-8601 timestamp',
      sim_date: 'YYYY-MM-DD calendar day the event belongs to',
      seed: 'seed that generated this event, null for real/manual events',
      payload: 'event-specific object',
    },
  };
}

function handleListEventTypes() {
  return Object.entries(EVENT_TYPE_DESCRIPTIONS).map(([event_type, description]) => ({ event_type, description }));
}

function handleQueryHistory(args, experience) {
  return getLog().queryHistory({
    experience,
    eventType: args.event_type,
    groupBy: args.group_by || 'day',
    startDate: optionalSimDate(args.start_date, 'start_date'),
    endDate: optionalSimDate(args.end_date, 'end_date'),
  });
}

function handleCompareToBaseline(args, experience) {
  if (!args.date || !args.baseline_date) return { error: 'date and baseline_date are required' };
  assertSimDate(args.date, 'date');
  assertSimDate(args.baseline_date, 'baseline_date');
  return getLog().compareToBaseline({
    experience,
    eventType: args.event_type,
    date: args.date,
    baselineDate: args.baseline_date,
  });
}

function handleTailEvents(args) {
  return getLog().tail({ sinceId: args.since_id || 0, limit: args.limit || 100 });
}

function handleGetCurrentSnapshot(args, experience) {
  return getLog().getCurrentSnapshot({ experience });
}

async function handleMarkTableCleared(args, experience) {
  if (!args.table_ref) return { error: 'table_ref is required' };
  const envelope = createEnvelope({
    eventType: EVENT_TYPES.TABLE_CLEARED,
    severity: SEVERITIES.INFO,
    source: actionSource(SOURCE),
    experience,
    ref: args.table_ref,
    ...(await actionTiming(getLog(), SOURCE)),
    payload: { via: 'mcp-action' },
  });
  await appendAndPublish(getLog(), getHub(), envelope);
  return { success: true, event: envelope };
}

async function handleInjectEvent(args, experience) {
  if (!Object.values(EVENT_TYPES).includes(args.event_type)) {
    return { error: `Unknown event_type: ${args.event_type}` };
  }
  const envelope = createEnvelope({
    eventType: args.event_type,
    severity: args.severity || SEVERITIES.INFO,
    source: actionSource(SOURCE),
    experience,
    ref: args.ref || null,
    ...(await actionTiming(getLog(), SOURCE)),
    payload: args.payload || {},
  });
  await appendAndPublish(getLog(), getHub(), envelope);
  return { success: true, event: envelope };
}

// One handler per tool so no single function accumulates every tool's branches.
const TOOL_HANDLERS = {
  describe_service: handleDescribeService,
  list_event_types: handleListEventTypes,
  query_history: handleQueryHistory,
  compare_to_baseline: handleCompareToBaseline,
  tail_events: handleTailEvents,
  get_current_snapshot: handleGetCurrentSnapshot,
  mark_table_cleared: handleMarkTableCleared,
  inject_event: handleInjectEvent,
};

async function handleTool(name, args = {}) {
  const experience = args.experience || EXPERIENCE_DEFAULT;
  const handler = TOOL_HANDLERS[name];
  if (!handler) return { error: `Unknown tool: ${name}` };
  return handler(args, experience);
}

async function main() {
  await getLog().init();
  await connectTransport({ name: SERVICE_NAME, label: 'store-activity-service', httpPort: 3101, tools: TOOLS, handleTool });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
