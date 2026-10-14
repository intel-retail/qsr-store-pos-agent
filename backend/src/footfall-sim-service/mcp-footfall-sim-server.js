/*
 * Copyright (c) 2026 Intel Corporation
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// MCP server for the footfall/movement sim service: describe / read only —
// no action tools (this service has none by design). Reuses sim-service's
// hub directly. Push events go to the hub, not through MCP.

const { z } = require('zod');
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const { FootfallEventLog } = require('./eventLog');
const { SimEventHub } = require('../sim-service/hub');
const { EVENT_TYPES } = require('./envelope');
const { connectTransport } = require('../sim-service/mcpTransport');

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
    parameters: z.object({}),
  },
  {
    name: 'list_event_types',
    description: 'List the footfall/density event types this service publishes.',
    parameters: z.object({}),
  },
  {
    name: 'get_total_footfall',
    description: 'Read: total footfall over a period, overall and broken down by zone.',
    parameters: z.object({
      experience: z.string().describe("default 'cafe'").optional(),
      zone: z.string().describe("Limit to one zone, e.g. 'entrance'").optional(),
      start_date: z.string().describe('YYYY-MM-DD').optional(),
      end_date: z.string().describe('YYYY-MM-DD').optional(),
    }),
  },
  {
    name: 'get_busy_time_patterns',
    description: 'Read: average footfall per hour-of-day across all observed days — surfaces recurring busy periods like the morning rush.',
    parameters: z.object({
      experience: z.string().optional(),
      zone: z.string().optional(),
      start_date: z.string().describe('YYYY-MM-DD').optional(),
      end_date: z.string().describe('YYYY-MM-DD').optional(),
    }),
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
  await connectTransport({ name: 'edgemart-footfall-sim-service', label: 'footfall-sim-service', httpPort: 3301, tools: TOOLS, handleTool });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
