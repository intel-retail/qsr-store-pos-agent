/*
 * Copyright (c) 2026 Intel Corporation
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// MCP server for the footfall/movement sim service: describe / read only —
// no action tools (this service has none by design). Reuses sim-service's
// hub directly. Push events go to the hub, not through MCP.

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js');
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const { FootfallEventLog } = require('./eventLog');
const { SimEventHub } = require('../sim-service/hub');
const { EVENT_TYPES } = require('./envelope');

const SOURCE = process.env.SOURCE || 'sim'; // 'sim' | 'real'
const BENCHMARK = process.env.SIM_BENCHMARK === '1' || process.env.SIM_BENCHMARK === 'true';
const EXPERIENCE_DEFAULT = process.env.SIM_EXPERIENCE || 'cafe';

const FOOTFALL_EVENT_TYPE_DESCRIPTIONS = {
  [EVENT_TYPES.FOOTFALL_COUNT]: 'Number of people observed in a zone during a 15-minute interval.',
  [EVENT_TYPES.ZONE_DENSITY_CHANGED]: "A zone's density level (low/medium/high) changed.",
};

const TOOLS = [
  {
    name: 'describe_service',
    description: 'Describe this footfall/movement service: source mode, envelope schema, and capabilities.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'list_event_types',
    description: 'List the footfall/density event types this service publishes.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_total_footfall',
    description: 'Read: total footfall over a period, overall and broken down by zone.',
    inputSchema: {
      type: 'object',
      properties: {
        experience: { type: 'string', description: "default 'cafe'" },
        zone: { type: 'string', description: "Limit to one zone, e.g. 'entrance'" },
        start_date: { type: 'string', description: 'YYYY-MM-DD' },
        end_date: { type: 'string', description: 'YYYY-MM-DD' },
      },
    },
  },
  {
    name: 'get_busy_time_patterns',
    description: 'Read: average footfall per hour-of-day across all observed days — surfaces recurring busy periods like the morning rush.',
    inputSchema: {
      type: 'object',
      properties: {
        experience: { type: 'string' },
        zone: { type: 'string' },
        start_date: { type: 'string', description: 'YYYY-MM-DD' },
        end_date: { type: 'string', description: 'YYYY-MM-DD' },
      },
    },
  },
];

let log = null;

function getLog() {
  if (!log) log = new FootfallEventLog();
  return log;
}

async function handleTool(name, args = {}) {
  const experience = args.experience || EXPERIENCE_DEFAULT;

  switch (name) {
    case 'describe_service':
      return {
        name: 'edgemart-footfall-sim-service',
        source: SOURCE,
        benchmark_mode: BENCHMARK,
        contract: 'describe / read (no actions) — issue #100 / #101. Live push events go to the hub (SSE + MQTT topic tree), not through MCP.',
        envelope_schema: {
          event_id: 'uuid',
          event_type: Object.keys(FOOTFALL_EVENT_TYPE_DESCRIPTIONS).map((k) => k),
          severity: 'info',
          source: ['sim', 'real'],
          experience: ['cafe'],
          ref: "zone name, e.g. 'entrance'",
          occurred_at: 'ISO-8601 timestamp',
          sim_date: 'YYYY-MM-DD calendar day the event belongs to',
          seed: 'seed that generated this event, null for real/manual events',
          payload: 'event-specific object (count, or density/count/capacity)',
        },
      };

    case 'list_event_types':
      return Object.entries(FOOTFALL_EVENT_TYPE_DESCRIPTIONS).map(([event_type, description]) => ({ event_type, description }));

    case 'get_total_footfall':
      return getLog().getTotalFootfall({
        experience,
        zone: args.zone,
        startDate: args.start_date,
        endDate: args.end_date,
      });

    case 'get_busy_time_patterns':
      return getLog().getBusyTimePatterns({
        experience,
        zone: args.zone,
        startDate: args.start_date,
        endDate: args.end_date,
      });

    default:
      return { error: `Unknown tool: ${name}` };
  }
}

async function main() {
  await getLog().init();

  const server = new Server(
    { name: 'edgemart-footfall-sim-service', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      const result = await handleTool(request.params.name, request.params.arguments || {});
      // A "soft" validation failure (e.g. missing arg) comes back as a
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
  console.error('[footfall-sim-service] MCP server running on stdio');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
