# EdgeMart Table Occupancy & Cleaning Sim Service

Standalone module under `backend/src/table-sim-service/`. Does not modify
`sim-service/`, `table-status.js`, or `mcp-table-status.js` — it reuses their
*generic* building blocks directly (no duplicated code) while keeping its own
durable log, so it can run independently of sim-service.

## What's reused vs. new

| Reused from `sim-service/` (imported, unchanged) | New here |
| --- | --- |
| `envelope.js` — `EVENT_TYPES`/`SEVERITIES`/`createEnvelope`/`validateEnvelope` | `eventLog.js` — its own table (`table_sim_events`), plus `getUtilization`/`getDirtyDurationStats`/`getTableHistory` |
| `rng.js` — `createSeededRng`/`deterministicUuid` | `producer.js` — per-table occupied→dirty→cleared→idle renewal process (no double-booking) |
| `hub.js` — `SimEventHub` (SSE + MQTT fanout), given a distinct `mqttTopicPrefix: 'table-sim'` | `mcp-table-sim-server.js`, `index.js`, `seed-history.js` |

**Why its own log table, not sim-service's `sim_events`:** issue #100/#101 says
each service keeps its own durable log. Two independent producers (this one
and sim-service's café-day producer) both emit `table.*` events for the same
table refs — writing them into one shared table would let one producer's
history corrupt the other's utilization/dirty-duration math. Reusing the hub
is intentional (it's meant to be a shared fan-out point across services); the
log is not.

**Operational note:** don't run this producer and sim-service's producer at
the same time for the same experience/table set — both would independently
"own" the same physical tables. Pick one as the table source of truth.

## MCP tools

`describe_service`, `list_event_types` (describe) · `get_utilization`,
`get_dirty_duration_stats`, `get_table_history` (read) · `mark_table_cleared`,
`mark_table_occupied` (act). See `mcp-table-sim-server.js` for input schemas.
Every tool here also has a plain-HTTP equivalent — see "HTTP surface" below —
for clients that aren't MCP-capable.

## Env vars

Same `SOURCE`, `SIM_MODE`, `SIM_SEED`, `SIM_SPEED`, `SIM_BENCHMARK`,
`SIM_EXPERIENCE`, `SIM_REPLAY_DATE`, `CAFE_TABLE_COUNT` as sim-service (see
[../sim-service/SIM-SERVICE.md](../sim-service/SIM-SERVICE.md)), plus:

| Var | Default | Meaning |
| --- | --- | --- |
| `TABLE_SIM_PORT` | `3200` | Port for `/table-sim/health`, `/table-sim/events/stream`, `/table-sim/ingest`. |
| `TABLE_SIM_DB_NAME` | `CAFE_DB_NAME` or `pos_cafe` | Database `table_sim_events` lives in. |
| `TABLE_SIM_API_KEY` | unset | If set, `POST` routes (`/table-sim/ingest`, `/table-sim/actions/*`) require a matching `X-Api-Key` header (401 otherwise). Unset = open. |
| `TABLE_SIM_CORS_ORIGIN` | `http://localhost:4200` | Comma-separated allowed CORS origins. Set to `*` to allow any origin. |

## HTTP surface

Same security middleware as sim-service (helmet, CORS, rate limiting — see
[../sim-service/SIM-SERVICE.md](../sim-service/SIM-SERVICE.md#http-surface)) plus:

| Method & path | Auth | Purpose |
| --- | --- | --- |
| `GET /table-sim/health` | none | Reports real `db`/`mqtt` connectivity; 503 if the DB is unreachable. |
| `GET /table-sim/events/stream` | none | SSE, supports `Last-Event-ID` reconnect/resume like sim-service's stream. |
| `POST /table-sim/ingest` | `X-Api-Key` if set | SOURCE=real ingestion path, unchanged (rejects a missing `ref` with 400 — `table_sim_events.ref` is `NOT NULL`). |
| `GET /table-sim/event-types` | none | Mirrors MCP `list_event_types`. |
| `GET /table-sim/utilization?experience=&table_ref=&start_date=&end_date=` | none | Mirrors MCP `get_utilization`. |
| `GET /table-sim/dirty-duration?experience=&table_ref=&start_date=&end_date=` | none | Mirrors MCP `get_dirty_duration_stats`. |
| `GET /table-sim/history?experience=&table_ref=&limit=` | none | Mirrors MCP `get_table_history`. `table_ref` required. |
| `POST /table-sim/actions/mark-table-cleared` `{experience, table_ref}` | `X-Api-Key` if set | Mirrors MCP `mark_table_cleared`. |
| `POST /table-sim/actions/mark-table-occupied` `{experience, table_ref}` | `X-Api-Key` if set | Mirrors MCP `mark_table_occupied`. |

## Running it

```bash
node backend/src/table-sim-service/index.js
node backend/src/table-sim-service/mcp-table-sim-server.js
node backend/src/table-sim-service/seed-history.js --days=14
SIM_MODE=replay SIM_REPLAY_DATE=2026-05-20 node backend/src/table-sim-service/index.js
```

Deployment (Docker, standalone stack, cross-container/host access) follows
the same pattern documented in
[../sim-service/SIM-SERVICE.md](../sim-service/SIM-SERVICE.md) — swap the
port (`3200`) and script paths.
