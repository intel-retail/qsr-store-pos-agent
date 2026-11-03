# EdgeMart Store Activity Service

Standalone, additive module under `backend/src/store-activity-service/`. It does not modify or
replace the existing browser simulator, `table-status.js`, `mcp-server.js`, or
`mcp-table-status.js` — it is a separate qualification layer that provides
store activity as a real, headless service (durable log, hub, MCP), per
[intel-retail/retail-use-cases#100](https://github.com/intel-retail/retail-use-cases/issues/100)
and [#101](https://github.com/intel-retail/retail-use-cases/issues/101).

It shares its building blocks (envelope, event log base class, producer base
class, hub, API-key/MCP-transport helpers, config parsing, Express app
scaffold) with the table occupancy and footfall services via
`backend/src/service-common/`.

> **Naming note:** the folder/service/route/MCP names no longer say "sim". For
> compatibility with existing deployments, the following keep their original
> names: env vars (`SIM_*`, `SOURCE`, `CAFE_TABLE_COUNT`), the MQTT topic
> prefix (`sim`), and the DB table (`sim_events`).

## What it is

- **Headless producer** (`producer.js`) — generates café-day events (arrivals, orders,
  table occupied/dirty/cleared, queue depth) in plain Node. No browser/DOM/Three.js.
  Live mode runs indefinitely — once a sim day's schedule finishes, it automatically
  rolls over to the next calendar day rather than going idle.
- **Seeded/deterministic** (`producer.js`, `service-common/rng.js`) — `generateSchedule(simDate)` is a
  pure function of seed + experience + date. The same seed + the same day always produces the same ordered events.
- **Durable, ordered event log** (`eventLog.js`) — a dedicated Postgres table
  (`sim_events`), not an in-memory Map. Supports append, tail, grouped history queries,
  and baseline comparison.
- **Hub** (`service-common/hub.js`, `EventHub`) — dedups by `event_id` and fans out to one SSE stream
  (`GET /store-activity/events/stream`, with `Last-Event-ID` reconnect/resume support) and one
  MQTT topic tree (`sim/<experience>/events/<event_type>`).
- **MCP server** (`mcp-store-activity-server.js`) — describe / read / act contract only. Live
  push goes through the hub, not MCP. Every read/act tool also has a plain-HTTP
  mirror on the headless service (see "HTTP surface" below) for clients that can't
  spawn an MCP stdio process.

## The SOURCE=sim|real switch

`SOURCE` controls where events for a given experience originate. Both the MCP surface
and the hub/log are identical either way, so an agent cannot tell the difference.

| `SOURCE` | Behavior |
| --- | --- |
| `sim` (default) | `index.js` starts the internal `StoreActivityProducer`, in `live` or `replay` mode (see `SIM_MODE`). Events are generated headlessly, appended to the log, and published to the hub. |
| `real` | The internal producer is disabled. `POST /store-activity/ingest` accepts envelopes (same schema as `envelope.js`) from an external/real pipeline, appends them to the same log, and publishes them to the same hub. |

To swap a real pipeline in later: point it at `POST /store-activity/ingest` with `SOURCE=real`,
using the envelope shape documented by the MCP `describe_service` tool. No change is
needed on the agent side — same MCP tools, same hub topics/stream.

## Modes and flags (env vars)

| Var | Default | Meaning |
| --- | --- | --- |
| `SOURCE` | `sim` | `sim` or `real` — see above. |
| `SIM_MODE` | `live` | `live` (headless real-time-accelerated production) or `replay` (re-emit a previously recorded day from the log). Only applies when `SOURCE=sim`. |
| `SIM_REPLAY_DATE` | today (UTC) | `YYYY-MM-DD` day to replay when `SIM_MODE=replay`. |
| `SIM_SEED` | `edgemart-default-seed` | Base seed. Same seed + same day = identical event sequence. |
| `SIM_SPEED` | `60` | Time-acceleration multiplier (60 = one sim-hour per real minute). |
| `SIM_BENCHMARK` | `0` | `1`/`true` disables the hub's SSE/MQTT fanout for clean, deterministic benchmark runs. The log still records every event. |
| `SIM_EXPERIENCE` | `cafe` | `cafe` or `grocery`. |
| `SIM_PORT` | `3100` | Port for the headless HTTP surface (`/store-activity/health`, `/store-activity/events/stream`, `/store-activity/ingest`). |
| `SIM_DB_NAME` | `CAFE_DB_NAME` or `pos_cafe` | Postgres database the log lives in. |
| `CAFE_TABLE_COUNT` | `15` | Table count used when generating café schedules. |
| `SIM_API_KEY` | unset | If set, `POST` routes (`/store-activity/ingest`, `/store-activity/actions/*`) require a matching `X-Api-Key` header (401 otherwise). Unset = open. |
| `SIM_CORS_ORIGIN` | `http://localhost:4200` | Comma-separated allowed CORS origins. `*` is treated as a literal origin string, not a wildcard — it will never match a real browser Origin, so it effectively disables CORS for any origin. |

## HTTP surface

Security middleware: [`helmet`](https://www.npmjs.com/package/helmet), CORS
(see `SIM_CORS_ORIGIN` above), a global rate limit (1000 req/15min), and a
tighter one (60 req/min) on the mutating routes below. All of it is additive —
responses/behavior for existing routes are unchanged, just extra headers/limits.

| Method & path | Auth | Purpose |
| --- | --- | --- |
| `GET /store-activity/health` | none | `{status, source, mode, benchmark, experience, db, mqtt}` — `db`/`mqtt` reflect real connectivity (`await pool.query('SELECT 1')` for db); returns HTTP 503 (not 200) if the DB is unreachable. |
| `GET /store-activity/events/stream` | none | SSE. Send a `Last-Event-ID` header (the last `event_id` you saw) on reconnect and missed events are replayed from the durable log before live events resume — nothing in the gap is silently dropped. |
| `POST /store-activity/ingest` | `X-Api-Key` if `SIM_API_KEY` set | SOURCE=real ingestion path, unchanged. |
| `GET /store-activity/event-types` | none | Same list as the MCP `list_event_types` tool. |
| `GET /store-activity/history?experience=&event_type=&group_by=&start_date=&end_date=` | none | Mirrors MCP `query_history`. |
| `GET /store-activity/compare?experience=&event_type=&date=&baseline_date=` | none | Mirrors MCP `compare_to_baseline`. `date`/`baseline_date` required. |
| `GET /store-activity/tail?since_id=&limit=` | none | Mirrors MCP `tail_events`. |
| `GET /store-activity/snapshot?experience=` | none | Mirrors MCP `get_current_snapshot`. |
| `POST /store-activity/actions/mark-table-cleared` `{experience, table_ref}` | `X-Api-Key` if set | Mirrors MCP `mark_table_cleared` — same envelope/log/hub path. |
| `POST /store-activity/actions/inject-event` `{experience, event_type, ref, severity, payload}` | `X-Api-Key` if set | Mirrors MCP `inject_event`. |

### Validation and error behavior

- Startup config is validated: a mistyped `SOURCE` or `SIM_MODE` is a startup
  error (not a silent default). A non-numeric value for a numeric env var logs
  a warning and falls back to the default. `CAFE_TABLE_COUNT` is clamped to 1..200.
- Ingested envelopes are validated strictly: valid `occurred_at` timestamp,
  `payload` must be an object, and `experience` ≤ 20, `ref` ≤ 100, `seed` ≤ 200 characters.
- Query parameters are validated: a malformed date or a repeated parameter
  (`?a=1&a=2`) is a 400 rather than a database error; `limit` is clamped.
- Unexpected server errors return a generic `Internal server error` body
  (details go to the log only); 4xx messages are passed through.
- `X-Api-Key` is compared in constant time.
- Action events (`mark-table-cleared`, `inject-event`) carry `source: 'real'`
  only when the service runs with `SOURCE=real`; otherwise `source: 'sim'`.

## Running it

```bash
# Headless service (log + hub + producer or real-pipeline ingest)
node backend/src/store-activity-service/index.js

# MCP server (describe / read / act) for an agent gateway to attach to
node backend/src/store-activity-service/mcp-store-activity-server.js

# Preload history in one command (benchmark flag not needed — this is log-only)
node backend/src/store-activity-service/seed-history.js --days=14

# Deterministic replay of a specific recorded day
SIM_MODE=replay SIM_REPLAY_DATE=2026-05-20 node backend/src/store-activity-service/index.js

# Benchmark run: log keeps recording, hub fanout is off
SIM_BENCHMARK=1 node backend/src/store-activity-service/index.js
```

## Deploying

There are two independent pieces to deploy: the **headless HTTP service**
(`index.js` — log + hub + producer/ingest) and the **MCP server**
(`mcp-store-activity-server.js` — stdio, spawned by an agent gateway). They share one
Postgres table and don't need to run on the same host.

### Headless service, via Docker Compose

Already wired up in the repo's [docker-compose.yml](../../../docker-compose.yml)
as the `store-activity-service` container: it reuses the existing `backend/Dockerfile`
image (same `package.json`, no extra deps) with its `command` overridden to
`node src/store-activity-service/index.js`, connects to the same `postgres`/`mqtt`
containers as `backend`, and publishes port `3100`.

```bash
docker compose up -d store-activity-service
curl http://localhost:3100/store-activity/health

# Preload history into the running stack's database (one-off, not a long-lived container)
docker compose run --rm store-activity-service node src/store-activity-service/seed-history.js --days=14

# Override any flag via the environment before starting the stack, e.g.:
SIM_BENCHMARK=1 SIM_SEED=demo-day docker compose up -d store-activity-service
```

`store-activity-service` here `depends_on: postgres, mqtt`, so `docker compose up -d
store-activity-service` also brings those two up (Compose starts declared dependencies).
It does **not** start `backend`, `frontend`, or `qmmd` — nothing in the repo's
compose file links them to `store-activity-service`.

To run a second instance in `replay` mode (e.g. for a benchmark) alongside the
live one, add another service block copying `store-activity-service` with a different
`container_name`/port and `SIM_MODE=replay`/`SIM_REPLAY_DATE` set.

### Fully standalone (no shared containers at all)

If you don't want even `postgres`/`mqtt` from the main stack, use
[`docker-compose.yml`](./docker-compose.yml) in this folder — its own
dedicated Postgres and MQTT broker, own volumes, no link to the repo-root
compose file:

```bash
docker compose -f backend/src/store-activity-service/docker-compose.yml up -d
curl http://localhost:3100/store-activity/health
docker compose -f backend/src/store-activity-service/docker-compose.yml run --rm store-activity-service \
  node src/store-activity-service/seed-history.js --days=14
```

This is what makes the service clonable onto a single box on its own, per the
epic's "stand alone" requirement. It publishes the same host port (`3100`) as
the main stack's `store-activity-service` block, so don't run both at the same time.

### Headless service, without Docker

```bash
cd backend
npm install
node src/store-activity-service/index.js
```

Reads `backend/.env` the same way the rest of the backend does — point
`DB_HOST`/`DB_PORT`/`SIM_DB_NAME`/`MQTT_BROKER_URL` at wherever Postgres/MQTT
actually run.

### MCP server

Not containerized — like the existing `mcp-server.js`/`mcp-table-status.js`,
it's spawned as a child process by whatever runs the agent gateway (Hermes),
over stdio. Registered in [hermes-config.json](../../../hermes-config.json)
as `store-activity-service`; copy that block into `~/.hermes/config.yaml`
(replacing the path with your actual checkout path), same as the other two
MCP servers:

```yaml
mcp_servers:
  store-activity-service:
    command: node
    args:
      - /path/to/pos-simulator/backend/src/store-activity-service/mcp-store-activity-server.js
    env:
      DB_HOST: localhost      # or the host Postgres is published on
      DB_PORT: "5432"
      SIM_DB_NAME: pos_cafe
      DB_USER: postgres
      DB_PASSWORD: ""
      SOURCE: sim
      MQTT_BROKER_URL: mqtt://localhost:1883
      MQTT_USERNAME: "<your MQTT_USERNAME>"
      MQTT_PASSWORD: "<your MQTT_PASSWORD>"
```

If the headless service runs in Docker (as above) and Hermes runs on the host
(the project's default setup), `localhost` works because `postgres`/`mqtt`
publish their ports to the host. If Hermes also runs in Docker, point
`DB_HOST`/`MQTT_BROKER_URL` at the container names (`postgres`, `mqtt`)
instead, on the same Compose network.

## Using it from another container

Three surfaces, depending on what the other container needs:

**HTTP/SSE (health, live event stream, real-pipeline ingest)** — reach it by
service name on the same Docker network, same as any other Compose service:

```yaml
services:
  my-consumer:
    # ...
    environment:
      STORE_ACTIVITY_SERVICE_URL: http://store-activity-service:3100   # container DNS name, not localhost
```

```js
const res = await fetch(`${process.env.STORE_ACTIVITY_SERVICE_URL}/store-activity/health`);
const events = new EventSource(`${process.env.STORE_ACTIVITY_SERVICE_URL}/store-activity/events/stream`);
```

This only works out of the box if `my-consumer` is defined in the *same*
compose file as `store-activity-service` (Compose puts every service in one file on the
same default network automatically). If it lives in a separate compose
project or a plain `docker run`, join the network explicitly — both compose
files here expose a fixed, well-known default network name for this:

```yaml
# in the other project's compose file
services:
  my-consumer:
    networks: [edgemart-net]   # or store-activity-service-net for the standalone stack
networks:
  edgemart-net:
    external: true
```

Or skip networks entirely and use the published host port from any container
that can reach the Docker host, e.g. `http://host.docker.internal:3100`
(same pattern already used for `HERMES_GATEWAY_URL` in the root compose file).

**MQTT** — subscribe to the same broker (`mqtt://mqtt:1883` or
`mqtt://store-activity-mqtt:1883` for the standalone stack) on topic `sim/+/events/#`
(or `sim/cafe/events/#` for one experience). Same network-reachability rules
as above. The broker does not allow anonymous connections: authenticate with
the `MQTT_USERNAME` / `MQTT_PASSWORD` the stack was started with.

**MCP (`mcp-store-activity-server.js`)** — this one's different: MCP here uses stdio, not
a network socket, so "another container" can only use it by *spawning* the
process itself (same image/checkout), not by calling into the store-activity-service
container over the network. In practice that means either running the MCP
server inside whatever container hosts the agent gateway (mount/build this
repo there and point its `command`/`args` at
`backend/src/store-activity-service/mcp-store-activity-server.js`, same as the `~/.hermes/config.yaml`
entry above), or fronting it with a stdio-to-HTTP/SSE MCP proxy if you need a
purely network-based integration.

## Using it from outside any container (a host process)

This is the default setup this repo documents (Hermes runs on the host, not
in Docker) — no Docker networking involved, just published ports on
`localhost`.

**MCP** — spawn `mcp-store-activity-server.js` directly with `node`, same as any other
local script; it needs the repo checked out locally (or on a shared/mounted
path) since stdio requires an actual child process, not a network call. This
is exactly what the `store-activity-service` entry in
[hermes-config.json](../../../hermes-config.json) does — `DB_HOST`/
`MQTT_BROKER_URL` point at `localhost` because `store-activity-postgres`'s/`mqtt`'s ports
are published to the host by whichever compose file you started:

```bash
DB_HOST=localhost DB_PORT=5432 SIM_DB_NAME=pos_cafe DB_PASSWORD="$DB_PASSWORD" \
MQTT_BROKER_URL=mqtt://localhost:1883 MQTT_USERNAME="$MQTT_USERNAME" MQTT_PASSWORD="$MQTT_PASSWORD" \
node backend/src/store-activity-service/mcp-store-activity-server.js
```

**HTTP/SSE** — the headless service's port is published the same way, so any
host process (a script, `curl`, a non-Hermes agent framework) can call it
directly:

```bash
curl http://localhost:3100/store-activity/health
curl -N http://localhost:3100/store-activity/events/stream   # -N: don't buffer, it's SSE
```

**MQTT** — connect a client to `mqtt://localhost:1883` and subscribe to
`sim/+/events/#`.

This works whether `store-activity-service` runs via the root `docker-compose.yml`, the
standalone `docker-compose.yml` in this folder, or not in Docker at all
(`node backend/src/store-activity-service/index.js` directly on the host) — from a host
process's point of view they're indistinguishable, which is the point of the
`SOURCE=sim|real` contract: nothing outside the container needs to know or
care which one is running.

## MCP tools

`describe_service`, `list_event_types`, `query_history`, `compare_to_baseline`,
`tail_events`, `get_current_snapshot` (read), plus `mark_table_cleared` and
`inject_event` (act). See `mcp-store-activity-server.js` for full input schemas. Every
tool here also has a plain-HTTP equivalent — see "HTTP surface" above — for
clients that aren't MCP-capable (browsers, curl, monitoring tools).

## Event envelope

```json
{
  "event_id": "uuid",
  "event_type": "table.dirty",
  "severity": "info|warning|critical",
  "source": "sim|real",
  "experience": "cafe|grocery",
  "ref": "table-4",
  "occurred_at": "2026-05-20T14:32:00.000Z",
  "sim_date": "2026-05-20",
  "seed": "edgemart-default-seed",
  "payload": {}
}
```
