#!/usr/bin/env bash
# Manual test/verification script for the 3 store services running via the
# repo's root docker-compose.yml (postgres + mqtt + store-activity-service +
# table-occupancy-service + footfall-service containers), instead of bare
# `node` processes. See scripts/test-store-services.sh for the non-Docker
# equivalent. Not part of the app runtime — copy or scp this onto the
# Docker host and run it there.

REPO_DIR="${REPO_DIR:-$HOME/project/qsr-store-pos-agent}"
cd "$REPO_DIR"

# Secrets come from the environment or the repo-root .env (copy .env.example); there are no built-in defaults.
set -a; [ -f .env ] && . ./.env; set +a
: "${DB_PASSWORD:?Set DB_PASSWORD (see .env.example)}"
: "${MQTT_USERNAME:?Set MQTT_USERNAME (see .env.example)}"
: "${MQTT_PASSWORD:?Set MQTT_PASSWORD (see .env.example)}"
export DB_PASSWORD MQTT_USERNAME MQTT_PASSWORD

### ---------- 0. Stop anything that would conflict on ports 3100/3200/3300/5432/1883 ----------
pkill -f "src/store-activity-service/index.js" 2>/dev/null
pkill -f "src/table-occupancy-service/index.js" 2>/dev/null
pkill -f "src/footfall-service/index.js" 2>/dev/null
sudo systemctl stop postgresql mosquitto 2>/dev/null
sleep 2

### ---------- 1. Build and start postgres, mqtt, and the 3 services ----------
docker compose up -d --build postgres mqtt store-activity-service table-occupancy-service footfall-service
sleep 10   # give containers + producers + MQTT connect/subscribe time to settle
docker compose ps
docker compose logs --tail=20 store-activity-service table-occupancy-service footfall-service

### ---------- 2. Health checks (all three should show "mqtt": "ok") ----------
curl -s http://localhost:3100/store-activity/health   | jq .
curl -s http://localhost:3200/table-occupancy/health  | jq .
curl -s http://localhost:3300/footfall/health         | jq .

### ---------- 3. Seed history into the fresh dockerized database ----------
docker compose run --rm store-activity-service node src/store-activity-service/seed-history.js --days=7
docker compose run --rm table-occupancy-service node src/table-occupancy-service/seed-history.js --days=7
docker compose run --rm footfall-service node src/footfall-service/seed-history.js --days=7
docker compose run --rm store-activity-service node src/store-activity-service/seed-history.js --days=-5 || echo "expected failure above (invalid --days)"
sleep 1

### ---------- 4. store-activity-service read + action endpoints ----------
curl -s http://localhost:3100/store-activity/event-types | jq .
curl -s "http://localhost:3100/store-activity/history?experience=cafe&group_by=day" | jq .
curl -s "http://localhost:3100/store-activity/history?experience=cafe&group_by=hour" | jq '.[0:3]'
curl -s "http://localhost:3100/store-activity/tail?limit=10" | jq .
curl -s "http://localhost:3100/store-activity/snapshot?experience=cafe" | jq .
curl -s -X POST http://localhost:3100/store-activity/actions/mark-table-cleared \
  -H 'Content-Type: application/json' -d '{"experience":"cafe","table_ref":"table-4"}' | jq .
curl -s -X POST http://localhost:3100/store-activity/actions/inject-event \
  -H 'Content-Type: application/json' \
  -d '{"experience":"cafe","event_type":"table.occupied","ref":"table-4","severity":"info","payload":{}}' | jq .
sleep 1

### ---------- 5. SSE stream (with resume) ----------
timeout 5 curl -N http://localhost:3100/store-activity/events/stream
sleep 1
LAST_ID=$(curl -s "http://localhost:3100/store-activity/tail?limit=1" | jq -r '.[0].event_id')
timeout 5 curl -N -H "Last-Event-ID: $LAST_ID" http://localhost:3100/store-activity/events/stream
sleep 1

### ---------- 6. table-occupancy-service ----------
curl -s "http://localhost:3200/table-occupancy/utilization?table_ref=table-4&start_date=$(date -u -d '7 days ago' +%F)&end_date=$(date -u +%F)" | jq .
curl -s "http://localhost:3200/table-occupancy/dirty-duration?table_ref=table-4&start_date=$(date -u -d '7 days ago' +%F)&end_date=$(date -u +%F)" | jq .
curl -s "http://localhost:3200/table-occupancy/history?table_ref=table-4&limit=20" | jq .
curl -s -X POST http://localhost:3200/table-occupancy/actions/mark-table-occupied \
  -H 'Content-Type: application/json' -d '{"experience":"cafe","table_ref":"table-4"}' | jq .
curl -s -X POST http://localhost:3200/table-occupancy/actions/mark-table-cleared \
  -H 'Content-Type: application/json' -d '{"experience":"cafe","table_ref":"table-4"}' | jq .
sleep 1

### ---------- 7. footfall-service (read-only) ----------
curl -s "http://localhost:3300/footfall/total?start_date=$(date -u -d '7 days ago' +%F)&end_date=$(date -u +%F)" | jq .
curl -s "http://localhost:3300/footfall/busy-patterns?start_date=$(date -u -d '7 days ago' +%F)&end_date=$(date -u +%F)" | jq .
sleep 1

### ---------- 8. MQTT fan-out (mqtt container publishes to host-mapped 1883) ----------
# MQTT topic prefixes are unchanged: sim/, table-sim/, footfall-sim/
mosquitto_sub -h localhost -u "$MQTT_USERNAME" -P "$MQTT_PASSWORD" -t 'sim/+/events/#' -t 'table-sim/+/events/#' -t 'footfall-sim/+/events/#' -v &
SUB_PID=$!
sleep 3
curl -s -X POST http://localhost:3100/store-activity/actions/inject-event \
  -H 'Content-Type: application/json' \
  -d '{"experience":"cafe","event_type":"table.dirty","ref":"table-2","severity":"info","payload":{}}' > /dev/null
sleep 2
kill "$SUB_PID" 2>/dev/null
sleep 1

### ---------- 9. Confirm no MQTT client-ID collisions (broker log via container stdout) ----------
docker compose logs mqtt | grep -i "hub-" | tail -n 20
# expect: no repeating "already connected, closing old connection" for the same client id

### ---------- 10. MCP servers (stdio, run as host processes against the published container ports) ----------
npm install -g @modelcontextprotocol/inspector 2>/dev/null
cd backend
DB_HOST=localhost DB_PORT=5432 SIM_DB_NAME=pos_cafe DB_USER=postgres DB_PASSWORD="$DB_PASSWORD" \
  MQTT_BROKER_URL=mqtt://localhost:1883 \
  npx @modelcontextprotocol/inspector --cli node src/store-activity-service/mcp-store-activity-server.js --method tools/list
DB_HOST=localhost DB_PORT=5432 TABLE_SIM_DB_NAME=pos_cafe DB_USER=postgres DB_PASSWORD="$DB_PASSWORD" \
  MQTT_BROKER_URL=mqtt://localhost:1883 \
  npx @modelcontextprotocol/inspector --cli node src/table-occupancy-service/mcp-table-occupancy-server.js --method tools/list
DB_HOST=localhost DB_PORT=5432 FOOTFALL_SIM_DB_NAME=pos_cafe DB_USER=postgres DB_PASSWORD="$DB_PASSWORD" \
  MQTT_BROKER_URL=mqtt://localhost:1883 \
  npx @modelcontextprotocol/inspector --cli node src/footfall-service/mcp-footfall-server.js --method tools/list
cd "$REPO_DIR"
sleep 1

### ---------- 11. Auth & CORS (one-off container with env overrides, port 3100 freed first) ----------
docker compose stop store-activity-service
sleep 2
# SIM_CORS_ORIGIN is always an explicit allowlist (no '*' wildcard) —
# list the one origin this test expects to be allowed, plus the default.
docker compose run -d --rm --service-ports --name store-activity-service-authtest \
  -e SIM_API_KEY=test123 -e SIM_CORS_ORIGIN='http://localhost:4200,http://allowed.example' store-activity-service
sleep 8
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3100/store-activity/actions/mark-table-cleared \
  -H 'Content-Type: application/json' -d '{"table_ref":"table-4"}'   # expect 401
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3100/store-activity/actions/mark-table-cleared \
  -H 'Content-Type: application/json' -H 'X-Api-Key: test123' -d '{"table_ref":"table-4"}'   # expect 200
curl -s -D - -o /dev/null -H 'Origin: http://allowed.example' http://localhost:3100/store-activity/health | grep -i access-control-allow-origin   # expect the header, reflecting this origin
curl -s -D - -o /dev/null -H 'Origin: http://random-site.example' http://localhost:3100/store-activity/health | grep -i access-control-allow-origin   # expect no output - not on the allowlist
docker stop store-activity-service-authtest 2>/dev/null
sleep 2

### ---------- 12. Replay mode (same one-off pattern) ----------
docker compose run -d --rm --service-ports --name store-activity-service-replaytest \
  -e SIM_MODE=replay -e SIM_REPLAY_DATE=$(date -u -d '2 days ago' +%F) store-activity-service
sleep 5
docker logs --tail=30 store-activity-service-replaytest
docker stop store-activity-service-replaytest 2>/dev/null
sleep 2

### ---------- 13. Restore the normal long-running store-activity-service container ----------
docker compose up -d store-activity-service
sleep 3
curl -s http://localhost:3100/store-activity/health | jq .

### ---------- 14. Cleanup ----------
echo "done — stack is left running. To tear down: docker compose down"
echo "To restore native Postgres/Mosquitto: sudo systemctl start postgresql mosquitto"
