# EdgeMart Footfall Service

Standalone module under `backend/src/footfall-service/`. Independent of the
other two services — it builds on the shared code in `backend/src/service-common/`
with its own durable log and its own event-type enum.

> **Naming note:** the folder/service/route/MCP names no longer say "sim". For
> compatibility with existing deployments, the following keep their original
> names: env vars (`FOOTFALL_SIM_*`, `SIM_*`, `SOURCE`), the MQTT topic prefix
> (`footfall-sim`), and the DB table (`footfall_sim_events`).

## What's shared vs. new

| Shared (`service-common/`) | New here |
| --- | --- |
| `rng.js` — `createSeededRng`/`deterministicUuid` | `envelope.js` — own `EVENT_TYPES` (`footfall.count`, `zone.density_changed`), `DENSITY_LEVELS`, and `validatePayload` (`count` must be a non-negative integer) |
| `hub.js` — `EventHub` (SSE + MQTT), given its own `mqttTopicPrefix: 'footfall-sim'` | `eventLog.js` — `FootfallEventLog`, own table `footfall_sim_events`, plus `getTotalFootfall`/`getBusyTimePatterns` |
| `envelope.js` (`defineEnvelope`), `eventLog.js` (`BaseEventLog`), `producer.js` (`ScheduledProducer`), `serviceApp.js` (Express app, ingest, SSE, error handling), `seedHistory.js`, `config.js`, `requireApiKey.js`, `mcpTransport.js` | `producer.js` — `FootfallProducer`: 15-minute interval footfall generator per zone with a time-of-day curve (morning rush, lunch peak, evening bump), emitting `zone.density_changed` only when the density level actually moves |
| | `mcp-footfall-server.js`, `index.js`, `seed-history.js` |

No action tools by design — `mcp-footfall-server.js` only exposes describe/read tools.

## MCP tools

`describe_service`, `list_event_types` (describe) · `get_total_footfall`,
`get_busy_time_patterns` (read). No act tools. Every read tool here also has a
plain-HTTP equivalent — see "HTTP surface" below — for clients that aren't
MCP-capable. The MCP server name is `footfall-service`.

## Env vars

Same `SOURCE`, `SIM_MODE`, `SIM_SEED`, `SIM_SPEED`, `SIM_BENCHMARK`,
`SIM_EXPERIENCE`, `SIM_REPLAY_DATE` as the store activity service (see
[../store-activity-service/STORE-ACTIVITY-SERVICE.md](../store-activity-service/STORE-ACTIVITY-SERVICE.md)), plus:

| Var | Default | Meaning |
| --- | --- | --- |
| `FOOTFALL_SIM_PORT` | `3300` | Port for `/footfall/health`, `/footfall/events/stream`, `/footfall/ingest`. |
| `FOOTFALL_SIM_DB_NAME` | `CAFE_DB_NAME` or `pos_cafe` | Database `footfall_sim_events` lives in. |
| `FOOTFALL_SIM_API_KEY` | unset | If set, `POST /footfall/ingest` requires a matching `X-Api-Key` header (401 otherwise). Compared in constant time. Unset = open. |
| `FOOTFALL_SIM_CORS_ORIGIN` | `http://localhost:4200` | Comma-separated allowed CORS origins. `*` is treated as a literal origin string, not a wildcard — it will never match a real browser Origin, so it effectively disables CORS for any origin. |

Config is validated at startup: a mistyped `SOURCE` or `SIM_MODE` is a startup
error (not a silent default), and a non-numeric value for a numeric env var
logs a warning and falls back to the default.

## HTTP surface

Same security middleware as the store activity service (helmet, CORS, rate limiting — see
[../store-activity-service/STORE-ACTIVITY-SERVICE.md](../store-activity-service/STORE-ACTIVITY-SERVICE.md#http-surface)) plus:

| Method & path | Auth | Purpose |
| --- | --- | --- |
| `GET /footfall/health` | none | Reports real `db`/`mqtt` connectivity; 503 if the DB is unreachable. |
| `GET /footfall/events/stream` | none | SSE, supports `Last-Event-ID` reconnect/resume. |
| `POST /footfall/ingest` | `X-Api-Key` if set | SOURCE=real ingestion path. 409 unless `SOURCE=real`; 400 for an invalid envelope, an invalid payload, or a missing `ref` (`footfall_sim_events.ref` is `NOT NULL`). |
| `GET /footfall/event-types` | none | Mirrors MCP `list_event_types`. |
| `GET /footfall/total?experience=&zone=&start_date=&end_date=` | none | Mirrors MCP `get_total_footfall`. |
| `GET /footfall/busy-patterns?experience=&zone=&start_date=&end_date=` | none | Mirrors MCP `get_busy_time_patterns`. |

A malformed `start_date`/`end_date` is a 400. Unexpected server errors return
a generic `Internal server error` body (details go to the log only).

No action routes — this service is read-only by design, same as its MCP surface.

## Running it

```bash
node backend/src/footfall-service/index.js
node backend/src/footfall-service/mcp-footfall-server.js
node backend/src/footfall-service/seed-history.js --days=14
SIM_MODE=replay SIM_REPLAY_DATE=2026-05-20 node backend/src/footfall-service/index.js
```

Deployment follows the same pattern as
[../store-activity-service/STORE-ACTIVITY-SERVICE.md](../store-activity-service/STORE-ACTIVITY-SERVICE.md) — swap the
port (`3300`) and script paths. In the root `docker-compose.yml` the service
is `footfall-service` (MCP sidecar: `footfall-service-mcp`).
