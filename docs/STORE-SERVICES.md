# EdgeMart Store Services — Starting Them & Using Them From Outside

Three independent services, one durable-log pattern each, per
[intel-retail/retail-use-cases#100](https://github.com/intel-retail/retail-use-cases/issues/100)
/[#101](https://github.com/intel-retail/retail-use-cases/issues/101). Each has
its own detailed doc — this page is the quick-start + integration overview
across all three. They share common code in `backend/src/service-common/`.

> **Compatibility note:** names no longer say "sim", but env vars (`SIM_*`,
> `TABLE_SIM_*`, `FOOTFALL_SIM_*`, `SOURCE`), MQTT topic prefixes (`sim`,
> `table-sim`, `footfall-sim`) and DB tables (`sim_events`, `table_sim_events`,
> `footfall_sim_events`) are unchanged, so existing deployments keep working.

| Service | Folder | Headless port | MCP server | Events | Actions |
| --- | --- | --- | --- | --- | --- |
| Store activity (café-day) | `backend/src/store-activity-service/` | `3100` | `mcp-store-activity-server.js` | customer/order/table/queue events | `mark_table_cleared`, `inject_event` |
| Table occupancy & cleaning | `backend/src/table-occupancy-service/` | `3200` | `mcp-table-occupancy-server.js` | `table.occupied`/`dirty`/`cleared` | `mark_table_cleared`, `mark_table_occupied` |
| Footfall / movement | `backend/src/footfall-service/` | `3300` | `mcp-footfall-server.js` | `footfall.count`, `zone.density_changed` | none (read-only) |

Details: [store-activity-service/STORE-ACTIVITY-SERVICE.md](../backend/src/store-activity-service/STORE-ACTIVITY-SERVICE.md) ·
[table-occupancy-service/TABLE-OCCUPANCY-SERVICE.md](../backend/src/table-occupancy-service/TABLE-OCCUPANCY-SERVICE.md) ·
[footfall-service/FOOTFALL-SERVICE.md](../backend/src/footfall-service/FOOTFALL-SERVICE.md)

## Starting them

Each service is two independent pieces — a headless HTTP process (log + hub +
producer/ingest) and an MCP server (stdio) — started separately, same shape
for all three:

```bash
cd backend
npm install     # once

# Headless HTTP service (pick the port that matches the service)
node src/store-activity-service/index.js                 # :3100
node src/table-occupancy-service/index.js            # :3200
node src/footfall-service/index.js         # :3300

# MCP server (stdio, for an agent gateway to spawn)
node src/store-activity-service/mcp-store-activity-server.js
node src/table-occupancy-service/mcp-table-occupancy-server.js
node src/footfall-service/mcp-footfall-server.js

# Preload history — "restores in one command", per service
node src/store-activity-service/seed-history.js --days=14
node src/table-occupancy-service/seed-history.js --days=14
node src/footfall-service/seed-history.js --days=14
```

Common env vars, same meaning across all three (see each service's own doc
for the full reference): `SOURCE` (`sim`|`real`), `SIM_MODE` (`live`|`replay`),
`SIM_SEED`, `SIM_SPEED`, `SIM_BENCHMARK`, `SIM_EXPERIENCE`, `SIM_REPLAY_DATE`,
`SIM_PRELOAD_DAYS` (default `0`; compose sets `14`) — with `SOURCE=sim`, any of that many
past days that is missing or holds fewer events than its full schedule is filled in at startup,
so a fresh, interrupted or cut-off day completes.

A live `SOURCE=sim` service resumes the simulated clock from its newest stored event on
every start: it publishes only events after that point and never re-publishes stored ones, so
a restart neither repeats events nor leaves a silent gap before new ones appear.
Each also has its own `*_API_KEY` (optional — if set, requires a matching
`X-Api-Key` header on mutating routes) and `*_CORS_ORIGIN` (default
`http://localhost:4200`, comma-separated list) env var — e.g.
`SIM_API_KEY`/`SIM_CORS_ORIGIN`, `TABLE_SIM_API_KEY`/`TABLE_SIM_CORS_ORIGIN`,
`FOOTFALL_SIM_API_KEY`/`FOOTFALL_SIM_CORS_ORIGIN`.

**Container images:** each service and its MCP sidecar share one image, built from
`backend/Dockerfile` and named `${IMAGE_REGISTRY}/<service>:${IMAGE_TAG}` (defaults:
`qsr-store-pos-agent/<service>:latest`):

| Service | Image (default name) |
|---|---|
| `store-activity-service` | `qsr-store-pos-agent/store-activity-service:latest` |
| `table-occupancy-service` | `qsr-store-pos-agent/table-occupancy-service:latest` |
| `footfall-service` | `qsr-store-pos-agent/footfall-service:latest` |

To publish them to a registry, log in, then build and push with a lowercase
`IMAGE_REGISTRY` that has no trailing slash:

```bash
export IMAGE_REGISTRY=<registry>/<path> IMAGE_TAG=<tag>
docker compose build store-activity-service table-occupancy-service footfall-service
docker compose push store-activity-service table-occupancy-service footfall-service
```

A host that only pulls the images must set the same `IMAGE_REGISTRY` and `IMAGE_TAG`
in `.env`. Rebuild with `--build` after code changes; a reused `latest` tag is not
refreshed by `up` or `--force-recreate`.

**Via Docker:** all three are wired into [`docker-compose.yml`](../docker-compose.yml)
— `docker compose up -d store-activity-service table-occupancy-service footfall-service`
(each `depends_on: postgres, mqtt`, so Compose brings those up too). All three
share the same `postgres`/`mqtt` containers as `backend`, on the same
`edgemart-net` network, each with its own published port (`3100`/`3200`/`3300`)
and its own durable-log table in the same `pos_cafe` database. `store-activity-service`
also has its own fully-standalone stack (own Postgres/MQTT, no shared
containers) at [`backend/src/store-activity-service/docker-compose.yml`](../backend/src/store-activity-service/docker-compose.yml).

## How an outside service uses them

Same three surfaces for every service — only the base path/port/MQTT prefix
differ:

| | store-activity-service | table-occupancy-service | footfall-service |
| --- | --- | --- | --- |
| HTTP base | `http://localhost:3100` | `http://localhost:3200` | `http://localhost:3300` |
| Health (checks real DB/MQTT connectivity, 503 if DB down) | `/store-activity/health` | `/table-occupancy/health` | `/footfall/health` |
| SSE stream (supports `Last-Event-ID` reconnect/resume) | `/store-activity/events/stream` | `/table-occupancy/events/stream` | `/footfall/events/stream` |
| Real-pipeline ingest | `POST /store-activity/ingest` | `POST /table-occupancy/ingest` | `POST /footfall/ingest` |
| Read tools (HTTP mirrors of MCP) | `/store-activity/{event-types,history,compare,tail,snapshot}` | `/table-occupancy/{event-types,utilization,dirty-duration,history}` | `/footfall/{event-types,total,busy-patterns}` |
| Action tools (HTTP mirrors of MCP) | `POST /store-activity/actions/{mark-table-cleared,inject-event}` | `POST /table-occupancy/actions/{mark-table-cleared,mark-table-occupied}` | none (read-only) |
| MQTT topic tree | `sim/<experience>/events/<event_type>` | `table-sim/<experience>/events/<event_type>` | `footfall-sim/<experience>/events/<event_type>` |

Every MCP tool (read and act) has a plain-HTTP equivalent on the headless
service, for clients that can't spawn an MCP stdio process — browsers, curl,
monitoring tools. Ingest and action routes accept an optional `X-Api-Key`
header (see the `*_API_KEY` env vars above); all other routes are unauthenticated.

**1. HTTP/SSE** — reach the published port directly:
```bash
curl http://localhost:3200/table-occupancy/health
curl -N http://localhost:3300/footfall/events/stream

# Read tools without MCP, e.g. table utilization for a date range:
curl "http://localhost:3200/table-occupancy/utilization?table_ref=table-4&start_date=2026-05-01&end_date=2026-05-20"

# Action tools without MCP (add -H "X-Api-Key: ..." if the service has one configured):
curl -X POST http://localhost:3200/table-occupancy/actions/mark-table-cleared \
  -H 'Content-Type: application/json' -d '{"table_ref": "table-4"}'
```
From another container on the same Docker network, use the service's
container/DNS name instead of `localhost` (e.g. `http://store-activity-service:3100`) —
see [store-activity-service/STORE-ACTIVITY-SERVICE.md](../backend/src/store-activity-service/STORE-ACTIVITY-SERVICE.md#using-it-from-another-container)
for the full container-to-container/network-joining pattern; it applies the
same way to the other two once they're containerized.

**2. MQTT** — subscribe to `mqtt://localhost:1883` (or the container name from
inside Docker) on the relevant topic tree, e.g. `table-sim/+/events/#` (MQTT prefixes are unchanged).

**3. MCP** — both transports are available, not stdio-only:

- **stdio** — the consumer (typically an agent gateway like Hermes) spawns
  the MCP server itself; not reachable over the network. All three are
  already registered as a reference in [hermes-config.json](../hermes-config.json)
  (`store-activity-service`, `table-occupancy-service`,
  `footfall-service`) — copy the relevant block into
  `~/.hermes/config.yaml`, replacing the path with your actual checkout:

```yaml
mcp_servers:
  table-occupancy-service:
    command: node
    args:
      - /path/to/pos-simulator/backend/src/table-occupancy-service/mcp-table-occupancy-server.js
    env:
      DB_HOST: localhost
      DB_PORT: "5432"
      TABLE_SIM_DB_NAME: pos_cafe
      DB_USER: postgres
      DB_PASSWORD: ""
      SOURCE: sim
      MQTT_BROKER_URL: mqtt://localhost:1883
      MQTT_USERNAME: "<your MQTT_USERNAME>"
      MQTT_PASSWORD: "<your MQTT_PASSWORD>"
```

- **streamable-HTTP** — the root [`docker-compose.yml`](../docker-compose.yml)
  publishes all three over the network, `POST /mcp` on `3101`
  (`store-activity-service`), `3201` (`table-occupancy-service`), and `3301`
  (`footfall-service`) — for an agent framework that registers
  MCP services by URL instead of spawning a stdio child (e.g.
  intel-retail/qsr-agent's `agent-config/hermes/remote-mcp.yaml`, which uses
  exactly this). Set `MCP_API_KEY` to require a matching `X-Api-Key` (or
  `Authorization: Bearer`) header on these endpoints; unset, they're open.

Each MCP server's actual tool list (`describe_service`, `list_event_types`,
plus the service-specific read/act tools) is discoverable by calling
`describe_service`/`list_event_types` at runtime, or by reading the
`TOOLS` array at the top of each `mcp-*-server.js` file.

## Pushing events to qsr-agent

Set `QSR_AGENT_EVENT_URL` (for example `http://host.docker.internal:8600/autonomy/events`)
and each service POSTs its events to the agent's webhook, in the agent's envelope:
`event_id`, `event_type`, `service` (the Hermes MCP server name), `store_id`,
`occurred_at`, and a `data` object holding the payload plus `ref`, `severity`,
`experience`, `source` and `simulated`. This covers producer events, `SOURCE=real`
ingests and actions made through the MCP sidecars. It is off in benchmark and replay mode.

The agent runs one model call per event, so each event type is throttled (below), and these
are sent by default: `queue.depth_changed` (store-activity; set
`QSR_AGENT_QUEUE_MIN_DEPTH` to only forward a building queue), `table.dirty`
(table-occupancy; set `QSR_AGENT_DIRTY_MIN_TABLES` to only forward once that many tables are
dirty) and `zone.density_changed` plus `footfall.count` (footfall). Setting `QSR_AGENT_EVENT_TYPES` (comma list, `*` for
every event) replaces those defaults and their filters. `QSR_AGENT_MIN_INTERVAL_MS` (default 30000) keeps only the first event per
type and `ref` in each window. `QSR_AGENT_STORE_ID` must equal the agent's
`QSR_RESTAURANT_ID`. Forwarded `event_id`s get an `@<run>` suffix that changes on every service start, so a
reset sim log that replays the same deterministic ids is not dropped as a duplicate by the agent
(`QSR_AGENT_EVENT_ID_SALT` pins or, if empty, disables it). Transient failures (network, 429, 5xx) are retried for about 25 seconds (six attempts, backoff capped at 10 s); other
4xx responses are logged and dropped.

## SOURCE=sim|real, per service

Each service's `SOURCE` switch is independent — you can run one in `real`
mode (ingesting from an actual pipeline via its `/…/ingest` endpoint) while
the other two stay in `sim` mode. Nothing on the agent/MCP side changes
either way; that's the point of the contract. Via the root `docker-compose.yml`,
control this per service with `SIM_SOURCE`, `TABLE_SIM_SOURCE`, and
`FOOTFALL_SIM_SOURCE` — each defaults to `sim` and only affects its own
service (and its MCP sidecar).
