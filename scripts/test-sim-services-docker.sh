#!/usr/bin/env bash
# Manual test/verification script for the 3 sim services running via the
# repo's root docker-compose.yml (postgres + mqtt + sim-service +
# table-sim-service + footfall-sim-service containers), instead of bare
# `node` processes. See scripts/test-sim-services.sh for the non-Docker
# equivalent. Not part of the app runtime — copy or scp this onto the
# Docker host and run it there.

REPO_DIR="${REPO_DIR:-$HOME/project/qsr-store-pos-agent}"
cd "$REPO_DIR"

### ---------- 0. Stop anything that would conflict on ports 3100/3200/3300/5432/1883 ----------
pkill -f "src/sim-service/index.js" 2>/dev/null
pkill -f "src/table-sim-service/index.js" 2>/dev/null
pkill -f "src/footfall-sim-service/index.js" 2>/dev/null
sudo systemctl stop postgresql mosquitto 2>/dev/null
sleep 2

### ---------- 1. Build and start postgres, mqtt, and the 3 sim services ----------
docker compose up -d --build postgres mqtt sim-service table-sim-service footfall-sim-service
sleep 10   # give containers + producers + MQTT connect/subscribe time to settle
docker compose ps
docker compose logs --tail=20 sim-service table-sim-service footfall-sim-service

### ---------- 2. Health checks (all three should show "mqtt": "ok") ----------
curl -s http://localhost:3100/sim/health          | jq .
curl -s http://localhost:3200/table-sim/health     | jq .
curl -s http://localhost:3300/footfall-sim/health  | jq .

### ---------- 3. Seed history into the fresh dockerized database ----------
docker compose run --rm sim-service node src/sim-service/seed-history.js --days=7
docker compose run --rm table-sim-service node src/table-sim-service/seed-history.js --days=7
docker compose run --rm footfall-sim-service node src/footfall-sim-service/seed-history.js --days=7
docker compose run --rm sim-service node src/sim-service/seed-history.js --days=-5 || echo "expected failure above (invalid --days)"
sleep 1

### ---------- 4. sim-service read + action endpoints ----------
curl -s http://localhost:3100/sim/event-types | jq .
curl -s "http://localhost:3100/sim/history?experience=cafe&group_by=day" | jq .
curl -s "http://localhost:3100/sim/history?experience=cafe&group_by=hour" | jq '.[0:3]'
curl -s "http://localhost:3100/sim/tail?limit=10" | jq .
curl -s "http://localhost:3100/sim/snapshot?experience=cafe" | jq .
curl -s -X POST http://localhost:3100/sim/actions/mark-table-cleared \
  -H 'Content-Type: application/json' -d '{"experience":"cafe","table_ref":"table-4"}' | jq .
curl -s -X POST http://localhost:3100/sim/actions/inject-event \
  -H 'Content-Type: application/json' \
  -d '{"experience":"cafe","event_type":"table.occupied","ref":"table-4","severity":"info","payload":{}}' | jq .
sleep 1

### ---------- 5. SSE stream (with resume) ----------
timeout 5 curl -N http://localhost:3100/sim/events/stream
sleep 1
LAST_ID=$(curl -s "http://localhost:3100/sim/tail?limit=1" | jq -r '.[0].event_id')
timeout 5 curl -N -H "Last-Event-ID: $LAST_ID" http://localhost:3100/sim/events/stream
sleep 1

### ---------- 6. table-sim-service ----------
curl -s "http://localhost:3200/table-sim/utilization?table_ref=table-4&start_date=$(date -u -d '7 days ago' +%F)&end_date=$(date -u +%F)" | jq .
curl -s "http://localhost:3200/table-sim/dirty-duration?table_ref=table-4&start_date=$(date -u -d '7 days ago' +%F)&end_date=$(date -u +%F)" | jq .
curl -s "http://localhost:3200/table-sim/history?table_ref=table-4&limit=20" | jq .
curl -s -X POST http://localhost:3200/table-sim/actions/mark-table-occupied \
  -H 'Content-Type: application/json' -d '{"experience":"cafe","table_ref":"table-4"}' | jq .
curl -s -X POST http://localhost:3200/table-sim/actions/mark-table-cleared \
  -H 'Content-Type: application/json' -d '{"experience":"cafe","table_ref":"table-4"}' | jq .
sleep 1

### ---------- 7. footfall-sim-service (read-only) ----------
curl -s "http://localhost:3300/footfall-sim/total?start_date=$(date -u -d '7 days ago' +%F)&end_date=$(date -u +%F)" | jq .
curl -s "http://localhost:3300/footfall-sim/busy-patterns?start_date=$(date -u -d '7 days ago' +%F)&end_date=$(date -u +%F)" | jq .
sleep 1

### ---------- 8. MQTT fan-out (mqtt container publishes to host-mapped 1883) ----------
mosquitto_sub -h localhost -t 'sim/+/events/#' -t 'table-sim/+/events/#' -t 'footfall-sim/+/events/#' -v &
SUB_PID=$!
sleep 3
curl -s -X POST http://localhost:3100/sim/actions/inject-event \
  -H 'Content-Type: application/json' \
  -d '{"experience":"cafe","event_type":"table.dirty","ref":"table-2","severity":"info","payload":{}}' > /dev/null
sleep 2
kill "$SUB_PID" 2>/dev/null
sleep 1

### ---------- 9. Confirm no MQTT client-ID collisions (broker log via container stdout) ----------
docker compose logs mqtt | grep -i "sim-hub" | tail -n 20
# expect: no repeating "already connected, closing old connection" for the same client id

### ---------- 10. MCP servers (stdio, run as host processes against the published container ports) ----------
npm install -g @modelcontextprotocol/inspector 2>/dev/null
cd backend
DB_HOST=localhost DB_PORT=5432 SIM_DB_NAME=pos_cafe DB_USER=postgres DB_PASSWORD=${DB_PASSWORD:-posdev2024} \
  MQTT_BROKER_URL=mqtt://localhost:1883 \
  npx @modelcontextprotocol/inspector --cli node src/sim-service/mcp-sim-server.js --method tools/list
DB_HOST=localhost DB_PORT=5432 TABLE_SIM_DB_NAME=pos_cafe DB_USER=postgres DB_PASSWORD=${DB_PASSWORD:-posdev2024} \
  MQTT_BROKER_URL=mqtt://localhost:1883 \
  npx @modelcontextprotocol/inspector --cli node src/table-sim-service/mcp-table-sim-server.js --method tools/list
DB_HOST=localhost DB_PORT=5432 FOOTFALL_SIM_DB_NAME=pos_cafe DB_USER=postgres DB_PASSWORD=${DB_PASSWORD:-posdev2024} \
  MQTT_BROKER_URL=mqtt://localhost:1883 \
  npx @modelcontextprotocol/inspector --cli node src/footfall-sim-service/mcp-footfall-sim-server.js --method tools/list
cd "$REPO_DIR"
sleep 1

### ---------- 11. Auth & CORS (one-off container with env overrides, port 3100 freed first) ----------
docker compose stop sim-service
sleep 2
# SIM_CORS_ORIGIN is now always an explicit allowlist (no '*' wildcard) —
# list the one origin this test expects to be allowed, plus the default.
docker compose run -d --rm --service-ports --name sim-service-authtest \
  -e SIM_API_KEY=test123 -e SIM_CORS_ORIGIN='http://localhost:4200,http://allowed.example' sim-service
sleep 8
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3100/sim/actions/mark-table-cleared \
  -H 'Content-Type: application/json' -d '{"table_ref":"table-4"}'   # expect 401
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3100/sim/actions/mark-table-cleared \
  -H 'Content-Type: application/json' -H 'X-Api-Key: test123' -d '{"table_ref":"table-4"}'   # expect 200
curl -s -D - -o /dev/null -H 'Origin: http://allowed.example' http://localhost:3100/sim/health | grep -i access-control-allow-origin   # expect the header, reflecting this origin
curl -s -D - -o /dev/null -H 'Origin: http://random-site.example' http://localhost:3100/sim/health | grep -i access-control-allow-origin   # expect no output - not on the allowlist
docker stop sim-service-authtest 2>/dev/null
sleep 2

### ---------- 12. Replay mode (same one-off pattern) ----------
docker compose run -d --rm --service-ports --name sim-service-replaytest \
  -e SIM_MODE=replay -e SIM_REPLAY_DATE=$(date -u -d '2 days ago' +%F) sim-service
sleep 5
docker logs --tail=30 sim-service-replaytest
docker stop sim-service-replaytest 2>/dev/null
sleep 2

### ---------- 13. Restore the normal long-running sim-service container ----------
docker compose up -d sim-service
sleep 3
curl -s http://localhost:3100/sim/health | jq .

### ---------- 14. Cleanup ----------
echo "done — stack is left running. To tear down: docker compose down"
echo "To restore native Postgres/Mosquitto: sudo systemctl start postgresql mosquitto"
