# EdgeMart Sim Services — Starting Them & Using Them From Outside

Three independent sim services, one durable-log pattern each, per
[intel-retail/retail-use-cases#100](https://github.com/intel-retail/retail-use-cases/issues/100)
/[#101](https://github.com/intel-retail/retail-use-cases/issues/101). Each has
its own detailed doc — this page is the quick-start + integration overview
across all three.

| Service | Folder | Headless port | MCP server | Events | Actions |
| --- | --- | --- | --- | --- | --- |
| Sim service (café-day) | `backend/src/sim-service/` | `3100` | `mcp-sim-server.js` | customer/order/table/queue events | `mark_table_cleared`, `inject_event` |
| Table occupancy & cleaning | `backend/src/table-sim-service/` | `3200` | `mcp-table-sim-server.js` | `table.occupied`/`dirty`/`cleared` | `mark_table_cleared`, `mark_table_occupied` |
| Footfall / movement | `backend/src/footfall-sim-service/` | `3300` | `mcp-footfall-sim-server.js` | `footfall.count`, `zone.density_changed` | none (read-only) |

Details: [sim-service/SIM-SERVICE.md](../backend/src/sim-service/SIM-SERVICE.md) ·
[table-sim-service/TABLE-SIM-SERVICE.md](../backend/src/table-sim-service/TABLE-SIM-SERVICE.md) ·
[footfall-sim-service/FOOTFALL-SIM-SERVICE.md](../backend/src/footfall-sim-service/FOOTFALL-SIM-SERVICE.md)

## Starting them

Each service is two independent pieces — a headless HTTP process (log + hub +
producer/ingest) and an MCP server (stdio) — started separately, same shape
for all three:

```bash
cd backend
npm install     # once

# Headless HTTP service (pick the port that matches the service)
node src/sim-service/index.js                 # :3100
node src/table-sim-service/index.js            # :3200
node src/footfall-sim-service/index.js         # :3300

# MCP server (stdio, for an agent gateway to spawn)
node src/sim-service/mcp-sim-server.js
node src/table-sim-service/mcp-table-sim-server.js
node src/footfall-sim-service/mcp-footfall-sim-server.js

# Preload history — "restores in one command", per service
node src/sim-service/seed-history.js --days=14
node src/table-sim-service/seed-history.js --days=14
node src/footfall-sim-service/seed-history.js --days=14
```

Common env vars, same meaning across all three (see each service's own doc
for the full reference): `SOURCE` (`sim`|`real`), `SIM_MODE` (`live`|`replay`),
`SIM_SEED`, `SIM_SPEED`, `SIM_BENCHMARK`, `SIM_EXPERIENCE`, `SIM_REPLAY_DATE`.

Each also has its own `*_API_KEY` (optional — if set, requires a matching
`X-Api-Key` header on mutating routes) and `*_CORS_ORIGIN` (default
`http://localhost:4200`, comma-separated list, or `*` for any origin) env var
— e.g. `SIM_API_KEY`/`SIM_CORS_ORIGIN`, `TABLE_SIM_API_KEY`/`TABLE_SIM_CORS_ORIGIN`,
`FOOTFALL_SIM_API_KEY`/`FOOTFALL_SIM_CORS_ORIGIN`.

**Via Docker:** all three are wired into [`docker-compose.yml`](../docker-compose.yml)
— `docker compose up -d sim-service table-sim-service footfall-sim-service`
(each `depends_on: postgres, mqtt`, so Compose brings those up too). All three
share the same `postgres`/`mqtt` containers as `backend`, on the same
`edgemart-net` network, each with its own published port (`3100`/`3200`/`3300`)
and its own durable-log table in the same `pos_cafe` database. `sim-service`
also has its own fully-standalone stack (own Postgres/MQTT, no shared
containers) at [`backend/src/sim-service/docker-compose.yml`](../backend/src/sim-service/docker-compose.yml).

## How an outside service uses them

Same three surfaces for every service — only the base path/port/MQTT prefix
differ:

| | sim-service | table-sim-service | footfall-sim-service |
| --- | --- | --- | --- |
| HTTP base | `http://localhost:3100` | `http://localhost:3200` | `http://localhost:3300` |
| Health (checks real DB/MQTT connectivity, 503 if DB down) | `/sim/health` | `/table-sim/health` | `/footfall-sim/health` |
| SSE stream (supports `Last-Event-ID` reconnect/resume) | `/sim/events/stream` | `/table-sim/events/stream` | `/footfall-sim/events/stream` |
| Real-pipeline ingest | `POST /sim/ingest` | `POST /table-sim/ingest` | `POST /footfall-sim/ingest` |
| Read tools (HTTP mirrors of MCP) | `/sim/{event-types,history,compare,tail,snapshot}` | `/table-sim/{event-types,utilization,dirty-duration,history}` | `/footfall-sim/{event-types,total,busy-patterns}` |
| Action tools (HTTP mirrors of MCP) | `POST /sim/actions/{mark-table-cleared,inject-event}` | `POST /table-sim/actions/{mark-table-cleared,mark-table-occupied}` | none (read-only) |
| MQTT topic tree | `sim/<experience>/events/<event_type>` | `table-sim/<experience>/events/<event_type>` | `footfall-sim/<experience>/events/<event_type>` |

Every MCP tool (read and act) has a plain-HTTP equivalent on the headless
service, for clients that can't spawn an MCP stdio process — browsers, curl,
monitoring tools. Ingest and action routes accept an optional `X-Api-Key`
header (see the `*_API_KEY` env vars above); all other routes are unauthenticated.

**1. HTTP/SSE** — reach the published port directly:
```bash
curl http://localhost:3200/table-sim/health
curl -N http://localhost:3300/footfall-sim/events/stream

# Read tools without MCP, e.g. table utilization for a date range:
curl "http://localhost:3200/table-sim/utilization?table_ref=table-4&start_date=2026-05-01&end_date=2026-05-20"

# Action tools without MCP (add -H "X-Api-Key: ..." if the service has one configured):
curl -X POST http://localhost:3200/table-sim/actions/mark-table-cleared \
  -H 'Content-Type: application/json' -d '{"table_ref": "table-4"}'
```
From another container on the same Docker network, use the service's
container/DNS name instead of `localhost` (e.g. `http://sim-service:3100`) —
see [sim-service/SIM-SERVICE.md](../backend/src/sim-service/SIM-SERVICE.md#using-it-from-another-container)
for the full container-to-container/network-joining pattern; it applies the
same way to the other two once they're containerized.

**2. MQTT** — subscribe to `mqtt://localhost:1883` (or the container name from
inside Docker) on the relevant topic tree, e.g. `table-sim/+/events/#`.

**3. MCP (stdio)** — not reachable over the network; the consumer (typically
an agent gateway like Hermes) spawns the MCP server itself. All three are
already registered as a reference in [hermes-config.json](../hermes-config.json)
(`edgemart-sim-service`, `edgemart-table-sim-service`,
`edgemart-footfall-sim-service`) — copy the relevant block into
`~/.hermes/config.yaml`, replacing the path with your actual checkout:

```yaml
mcp_servers:
  edgemart-table-sim-service:
    command: node
    args:
      - /path/to/pos-simulator/backend/src/table-sim-service/mcp-table-sim-server.js
    env:
      DB_HOST: localhost
      DB_PORT: "5432"
      TABLE_SIM_DB_NAME: pos_cafe
      DB_USER: postgres
      DB_PASSWORD: ""
      SOURCE: sim
      MQTT_BROKER_URL: mqtt://localhost:1883
```

Each MCP server's actual tool list (`describe_service`, `list_event_types`,
plus the service-specific read/act tools) is discoverable by calling
`describe_service`/`list_event_types` at runtime, or by reading the
`TOOLS` array at the top of each `mcp-*-server.js` file.

## SOURCE=sim|real, per service

Each service's `SOURCE` switch is independent — you can run one in `real`
mode (ingesting from an actual pipeline via its `/…/ingest` endpoint) while
the other two stay in `sim` mode. Nothing on the agent/MCP side changes
either way; that's the point of the contract.
