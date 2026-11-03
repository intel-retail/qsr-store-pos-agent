# EdgeMart Table Occupancy Service

Standalone module under `backend/src/table-occupancy-service/`. Does not modify
`store-activity-service/`, `table-status.js`, or `mcp-table-status.js` — it
builds on the shared code in `backend/src/service-common/` while keeping its
own durable log, so it can run independently of the store activity service.

> **Naming note:** the folder/service/route/MCP names no longer say "sim". For
> compatibility with existing deployments, the following keep their original
> names: env vars (`TABLE_SIM_*`, `SIM_*`, `SOURCE`), the MQTT topic prefix
> (`table-sim`), and the DB table (`table_sim_events`).

## What's shared vs. new

| Shared (`service-common/`) | New here |
| --- | --- |
| `rng.js` — `createSeededRng`/`deterministicUuid` | `envelope.js` — its own 3-type `EVENT_TYPES` (`table.occupied`/`table.dirty`/`table.cleared`), so ingest rejects customer/order/queue events |
| `hub.js` — `EventHub` (SSE + MQTT fanout), given a distinct `mqttTopicPrefix: 'table-sim'` | `eventLog.js` — `TableEventLog`, its own table (`table_sim_events`), plus `getUtilization`/`getDirtyDurationStats`/`getTableHistory` |
| `envelope.js` (`defineEnvelope`), `eventLog.js` (`BaseEventLog`), `producer.js` (`ScheduledProducer`), `serviceApp.js` (Express app, ingest, SSE, error handling), `seedHistory.js`, `config.js`, `publish.js`, `requireApiKey.js`, `mcpTransport.js` | `producer.js` — `TableOccupancyProducer`: per-table occupied→dirty→cleared→idle renewal process (no double-booking) |
| | `mcp-table-occupancy-server.js`, `index.js`, `seed-history.js` |

**Why its own log table, not the store activity service's `sim_events`:** each
service keeps its own durable log. The two services both emit `table.*` events
for the same table refs — they use separate log tables and separate MQTT
prefixes, so running both does not corrupt either log or either service's
utilization/dirty-duration math. Reusing the hub class is intentional (it's a
shared fan-out component); the log is not shared.

**Operational note:** avoid running this producer and the store activity
service's producer at the same time for the same experience/table set — both
would independently generate table state, so consumers subscribed to both
would see two inconsistent versions of the same physical tables. Pick one as
the table source of truth.

## MCP tools

`describe_service`, `list_event_types` (describe) · `get_utilization`,
`get_dirty_duration_stats`, `get_table_history` (read) · `mark_table_cleared`,
`mark_table_occupied` (act). See `mcp-table-occupancy-server.js` for input
schemas. Every tool here also has a plain-HTTP equivalent — see "HTTP surface"
below — for clients that aren't MCP-capable. The MCP server name is
`table-occupancy-service`.

Action events carry `source: 'real'` only when the service runs with
`SOURCE=real`; otherwise `source: 'sim'`.

## Env vars

Same `SOURCE`, `SIM_MODE`, `SIM_SEED`, `SIM_SPEED`, `SIM_BENCHMARK`,
`SIM_EXPERIENCE`, `SIM_REPLAY_DATE`, `CAFE_TABLE_COUNT` as the store activity service (see
[../store-activity-service/STORE-ACTIVITY-SERVICE.md](../store-activity-service/STORE-ACTIVITY-SERVICE.md)), plus:

| Var | Default | Meaning |
| --- | --- | --- |
| `TABLE_SIM_PORT` | `3200` | Port for `/table-occupancy/health`, `/table-occupancy/events/stream`, `/table-occupancy/ingest`. |
| `TABLE_SIM_DB_NAME` | `CAFE_DB_NAME` or `pos_cafe` | Database `table_sim_events` lives in. |
| `TABLE_SIM_API_KEY` | unset | If set, `POST` routes (`/table-occupancy/ingest`, `/table-occupancy/actions/*`) require a matching `X-Api-Key` header (401 otherwise). Compared in constant time. Unset = open. |
| `TABLE_SIM_CORS_ORIGIN` | `http://localhost:4200` | Comma-separated allowed CORS origins. `*` is treated as a literal origin string, not a wildcard — it will never match a real browser Origin, so it effectively disables CORS for any origin. |

Config is validated at startup: a mistyped `SOURCE` or `SIM_MODE` is a startup
error (not a silent default), a non-numeric value for a numeric env var logs a
warning and falls back to the default, and `CAFE_TABLE_COUNT` is clamped to
1..200.

## HTTP surface

Same security middleware as the store activity service (helmet, CORS, rate limiting — see
[../store-activity-service/STORE-ACTIVITY-SERVICE.md](../store-activity-service/STORE-ACTIVITY-SERVICE.md#http-surface)) plus:

| Method & path | Auth | Purpose |
| --- | --- | --- |
| `GET /table-occupancy/health` | none | Reports real `db`/`mqtt` connectivity; 503 if the DB is unreachable. |
| `GET /table-occupancy/events/stream` | none | SSE, supports `Last-Event-ID` reconnect/resume. |
| `POST /table-occupancy/ingest` | `X-Api-Key` if set | SOURCE=real ingestion path. 409 unless `SOURCE=real`; 400 for an invalid envelope or a missing `ref` (`table_sim_events.ref` is `NOT NULL`). |
| `GET /table-occupancy/event-types` | none | Mirrors MCP `list_event_types`. |
| `GET /table-occupancy/utilization?experience=&table_ref=&start_date=&end_date=` | none | Mirrors MCP `get_utilization`. |
| `GET /table-occupancy/dirty-duration?experience=&table_ref=&start_date=&end_date=` | none | Mirrors MCP `get_dirty_duration_stats`. |
| `GET /table-occupancy/history?experience=&table_ref=&limit=` | none | Mirrors MCP `get_table_history`. `table_ref` required. |
| `POST /table-occupancy/actions/mark-table-cleared` `{experience, table_ref}` | `X-Api-Key` if set | Mirrors MCP `mark_table_cleared`. |
| `POST /table-occupancy/actions/mark-table-occupied` `{experience, table_ref}` | `X-Api-Key` if set | Mirrors MCP `mark_table_occupied`. |

A malformed date query parameter is a 400. Unexpected server errors return a
generic `Internal server error` body (details go to the log only).

## Running it

```bash
node backend/src/table-occupancy-service/index.js
node backend/src/table-occupancy-service/mcp-table-occupancy-server.js
node backend/src/table-occupancy-service/seed-history.js --days=14
SIM_MODE=replay SIM_REPLAY_DATE=2026-05-20 node backend/src/table-occupancy-service/index.js
```

Deployment (Docker, standalone stack, cross-container/host access) follows
the same pattern documented in
[../store-activity-service/STORE-ACTIVITY-SERVICE.md](../store-activity-service/STORE-ACTIVITY-SERVICE.md) — swap the
port (`3200`) and script paths. In the root `docker-compose.yml` the service
is `table-occupancy-service` (MCP sidecar: `table-occupancy-service-mcp`).
