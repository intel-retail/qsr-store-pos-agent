# EdgeMart Footfall / Movement Sim Service

Standalone module under `backend/src/footfall-sim-service/`. Does not modify
`sim-service/` or `table-sim-service/` — reuses their *generic* building
blocks directly, with its own durable log and its own event-type enum.

## What's reused vs. new

| Reused (imported, unchanged) | New here |
| --- | --- |
| `sim-service/rng.js` — `createSeededRng`/`deterministicUuid` | `envelope.js` — own `EVENT_TYPES` (`footfall.count`, `zone.density_changed`); reuses `SEVERITIES`/`SOURCES` from sim-service's envelope but can't reuse its `createEnvelope`/`validateEnvelope` — those hard-validate against sim-service's own fixed enum, which doesn't include footfall/density and can't be parameterized without modifying that file |
| `sim-service/hub.js` — `SimEventHub` (SSE + MQTT), given its own `mqttTopicPrefix: 'footfall-sim'` | `eventLog.js` — own table `footfall_sim_events`, plus `getTotalFootfall`/`getBusyTimePatterns` |
| | `producer.js` — 15-minute interval footfall generator per zone with a time-of-day curve (morning rush, lunch peak, evening bump), emitting `zone.density_changed` only when the density level actually moves |
| | `mcp-footfall-sim-server.js`, `index.js`, `seed-history.js` |

No action tools by design (**A: none** in the requirement) — `mcp-footfall-sim-server.js` only exposes describe/read tools.

## MCP tools

`describe_service`, `list_event_types` (describe) · `get_total_footfall`,
`get_busy_time_patterns` (read). No act tools. Every read tool here also has a
plain-HTTP equivalent — see "HTTP surface" below — for clients that aren't
MCP-capable.

## Env vars

Same `SOURCE`, `SIM_MODE`, `SIM_SEED`, `SIM_SPEED`, `SIM_BENCHMARK`,
`SIM_EXPERIENCE`, `SIM_REPLAY_DATE` as sim-service (see
[../sim-service/SIM-SERVICE.md](../sim-service/SIM-SERVICE.md)), plus:

| Var | Default | Meaning |
| --- | --- | --- |
| `FOOTFALL_SIM_PORT` | `3300` | Port for `/footfall-sim/health`, `/footfall-sim/events/stream`, `/footfall-sim/ingest`. |
| `FOOTFALL_SIM_DB_NAME` | `CAFE_DB_NAME` or `pos_cafe` | Database `footfall_sim_events` lives in. |
| `FOOTFALL_SIM_API_KEY` | unset | If set, `POST /footfall-sim/ingest` requires a matching `X-Api-Key` header (401 otherwise). Unset = open. |
| `FOOTFALL_SIM_CORS_ORIGIN` | `http://localhost:4200` | Comma-separated allowed CORS origins. Set to `*` to allow any origin. |

## HTTP surface

Same security middleware as sim-service (helmet, CORS, rate limiting — see
[../sim-service/SIM-SERVICE.md](../sim-service/SIM-SERVICE.md#http-surface)) plus:

| Method & path | Auth | Purpose |
| --- | --- | --- |
| `GET /footfall-sim/health` | none | Reports real `db`/`mqtt` connectivity; 503 if the DB is unreachable. |
| `GET /footfall-sim/events/stream` | none | SSE, supports `Last-Event-ID` reconnect/resume like sim-service's stream. |
| `POST /footfall-sim/ingest` | `X-Api-Key` if set | SOURCE=real ingestion path, unchanged (rejects a missing `ref` with 400 — `footfall_sim_events.ref` is `NOT NULL`). |
| `GET /footfall-sim/event-types` | none | Mirrors MCP `list_event_types`. |
| `GET /footfall-sim/total?experience=&zone=&start_date=&end_date=` | none | Mirrors MCP `get_total_footfall`. |
| `GET /footfall-sim/busy-patterns?experience=&zone=&start_date=&end_date=` | none | Mirrors MCP `get_busy_time_patterns`. |

No action routes — this service is read-only by design, same as its MCP surface.

## Running it

```bash
node backend/src/footfall-sim-service/index.js
node backend/src/footfall-sim-service/mcp-footfall-sim-server.js
node backend/src/footfall-sim-service/seed-history.js --days=14
SIM_MODE=replay SIM_REPLAY_DATE=2026-05-20 node backend/src/footfall-sim-service/index.js
```

Deployment follows the same pattern as
[../sim-service/SIM-SERVICE.md](../sim-service/SIM-SERVICE.md) — swap the
port (`3300`) and script paths.
