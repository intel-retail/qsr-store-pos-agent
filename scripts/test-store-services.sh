#!/usr/bin/env bash
# Manual test/verification script for the 3 store services
# (store-activity-service, table-occupancy-service, footfall-service).
# Run on a Linux box with Postgres + Mosquitto installed and reachable.
# Not part of the app's runtime/build — copy or scp this onto the test host.

REPO_DIR="${REPO_DIR:-$HOME/project/qsr-store-pos-agent}"
DB_PASSWORD="${DB_PASSWORD:?Set DB_PASSWORD (see .env.example)}"
# Optional: only needed when the local Mosquitto has password auth enabled.
MQTT_USERNAME="${MQTT_USERNAME:-}"
MQTT_PASSWORD="${MQTT_PASSWORD:-}"
LOG_DIR=/tmp/store-logs

### ---------- 0. Kill any previous run ----------
pkill -f "src/store-activity-service/index.js" 2>/dev/null
pkill -f "src/table-occupancy-service/index.js" 2>/dev/null
pkill -f "src/footfall-service/index.js" 2>/dev/null
sleep 2   # let old processes fully release their ports

### ---------- 1. Sync the latest code ----------
cd "$REPO_DIR"
git pull
sleep 1

### ---------- 2. Database (idempotent) ----------
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='pos_cafe'" | grep -q 1 \
  || sudo -u postgres createdb pos_cafe
sudo -u postgres psql -d pos_cafe -c "\dt"

### ---------- 3. Env file ----------
cat > backend/.env <<EOF
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=${DB_PASSWORD}
CAFE_DB_NAME=pos_cafe
CAFE_TABLE_COUNT=15
MQTT_BROKER_URL=mqtt://localhost:1883
MQTT_USERNAME=${MQTT_USERNAME}
MQTT_PASSWORD=${MQTT_PASSWORD}
EOF

### ---------- 4. Static sanity check ----------
cd "$REPO_DIR/backend"
for f in src/service-common/*.js src/store-activity-service/*.js src/table-occupancy-service/*.js src/footfall-service/*.js; do
  node --check "$f" || echo "FAILED: $f"
done
echo "syntax check done"

### ---------- 5. Start all three headless services ----------
mkdir -p "$LOG_DIR"
nohup node src/store-activity-service/index.js   > "$LOG_DIR/store-activity.log"   2>&1 & echo $! > "$LOG_DIR/store-activity.pid"
nohup node src/table-occupancy-service/index.js  > "$LOG_DIR/table-occupancy.log"  2>&1 & echo $! > "$LOG_DIR/table-occupancy.pid"
nohup node src/footfall-service/index.js         > "$LOG_DIR/footfall.log"         2>&1 & echo $! > "$LOG_DIR/footfall.pid"
sleep 10   # give producers + DB init + MQTT connect/subscribe time to settle
tail -n 20 "$LOG_DIR"/*.log

### ---------- 6. Health checks (all three should show "mqtt": "ok") ----------
curl -s http://localhost:3100/store-activity/health   | jq .
curl -s http://localhost:3200/table-occupancy/health  | jq .
curl -s http://localhost:3300/footfall/health         | jq .

### ---------- 7. Seed history ----------
node src/store-activity-service/seed-history.js --days=7
node src/table-occupancy-service/seed-history.js --days=7
node src/footfall-service/seed-history.js --days=7
node src/store-activity-service/seed-history.js --days=-5   || echo "expected failure above (invalid --days)"
node src/store-activity-service/seed-history.js --days=foo  || echo "expected failure above (invalid --days)"
sleep 1

### ---------- 8. store-activity-service read endpoints ----------
curl -s http://localhost:3100/store-activity/event-types | jq .
curl -s "http://localhost:3100/store-activity/history?experience=cafe&group_by=day" | jq .
curl -s "http://localhost:3100/store-activity/tail?limit=10" | jq .
curl -s "http://localhost:3100/store-activity/tail?limit=-5" | jq .   # invalid limit -> falls back to the default
curl -s "http://localhost:3100/store-activity/snapshot?experience=cafe" | jq .
curl -s "http://localhost:3100/store-activity/compare?experience=cafe&event_type=table.dirty&date=$(date -u +%F)&baseline_date=$(date -u -d '1 day ago' +%F)" | jq .
curl -s "http://localhost:3100/store-activity/compare?experience=cafe&event_type=table.dirty&date=not-a-date" | jq .   # expect 400 (bad date)

### ---------- 9. store-activity-service action endpoints ----------
curl -s -X POST http://localhost:3100/store-activity/actions/mark-table-cleared \
  -H 'Content-Type: application/json' -d '{"experience":"cafe","table_ref":"table-4"}' | jq .
curl -s -X POST http://localhost:3100/store-activity/actions/inject-event \
  -H 'Content-Type: application/json' \
  -d '{"experience":"cafe","event_type":"table.occupied","ref":"table-4","severity":"info","payload":{}}' | jq .
sleep 1

### ---------- 10. SSE stream (with resume) ----------
timeout 5 curl -N http://localhost:3100/store-activity/events/stream
sleep 1
LAST_ID=$(curl -s "http://localhost:3100/store-activity/tail?limit=1" | jq -r '.[0].event_id')
timeout 5 curl -N -H "Last-Event-ID: $LAST_ID" http://localhost:3100/store-activity/events/stream
sleep 1

### ---------- 11. table-occupancy-service ----------
curl -s "http://localhost:3200/table-occupancy/utilization?table_ref=table-4&start_date=$(date -u -d '7 days ago' +%F)&end_date=$(date -u +%F)" | jq .
curl -s "http://localhost:3200/table-occupancy/dirty-duration?table_ref=table-4&start_date=$(date -u -d '7 days ago' +%F)&end_date=$(date -u +%F)" | jq .
curl -s "http://localhost:3200/table-occupancy/history?table_ref=table-4&limit=20" | jq .
curl -s "http://localhost:3200/table-occupancy/history" | jq .   # missing table_ref -> expect 400
curl -s -X POST http://localhost:3200/table-occupancy/actions/mark-table-occupied \
  -H 'Content-Type: application/json' -d '{"experience":"cafe","table_ref":"table-4"}' | jq .
curl -s -X POST http://localhost:3200/table-occupancy/actions/mark-table-cleared \
  -H 'Content-Type: application/json' -d '{"experience":"cafe","table_ref":"table-4"}' | jq .
curl -s -X POST http://localhost:3200/table-occupancy/ingest \
  -H 'Content-Type: application/json' \
  -d '{"event_type":"table.occupied","experience":"cafe","severity":"info","occurred_at":"'"$(date -u +%FT%TZ)"'","sim_date":"'"$(date -u +%F)"'"}' | jq .
  # SOURCE=sim -> 409 (ingest disabled); with SOURCE=real -> 400 (missing ref)
sleep 1

### ---------- 12. footfall-service (read-only) ----------
curl -s "http://localhost:3300/footfall/total?start_date=$(date -u -d '7 days ago' +%F)&end_date=$(date -u +%F)" | jq .
curl -s "http://localhost:3300/footfall/busy-patterns?start_date=$(date -u -d '7 days ago' +%F)&end_date=$(date -u +%F)" | jq .
curl -s http://localhost:3300/footfall/event-types | jq .
sleep 1

### ---------- 13. MQTT fan-out ----------
# MQTT topic prefixes are unchanged: sim/, table-sim/, footfall-sim/
mosquitto_sub -h localhost ${MQTT_USERNAME:+-u "$MQTT_USERNAME" -P "$MQTT_PASSWORD"} -t 'sim/+/events/#' -t 'table-sim/+/events/#' -t 'footfall-sim/+/events/#' -v &
SUB_PID=$!
sleep 3   # let the subscription establish before publishing
curl -s -X POST http://localhost:3100/store-activity/actions/inject-event \
  -H 'Content-Type: application/json' \
  -d '{"experience":"cafe","event_type":"table.dirty","ref":"table-2","severity":"info","payload":{}}' > /dev/null
sleep 2   # let the message arrive before killing the subscriber
kill "$SUB_PID" 2>/dev/null
sleep 1

### ---------- 14. Confirm no client-ID collisions ----------
sudo grep -iE "hub-" /var/log/mosquitto/mosquitto.log | tail -n 20
# expect: no repeating "already connected, closing old connection" for the same client id

### ---------- 15. MCP servers (stdio) ----------
npm install -g @modelcontextprotocol/inspector 2>/dev/null
sleep 1
npx @modelcontextprotocol/inspector --cli node src/store-activity-service/mcp-store-activity-server.js --method tools/list
npx @modelcontextprotocol/inspector --cli node src/store-activity-service/mcp-store-activity-server.js --method tools/call --tool-name describe_service
npx @modelcontextprotocol/inspector --cli node src/table-occupancy-service/mcp-table-occupancy-server.js --method tools/list
npx @modelcontextprotocol/inspector --cli node src/footfall-service/mcp-footfall-server.js --method tools/list
sleep 1

### ---------- 16. Auth & CORS ----------
kill "$(cat "$LOG_DIR/store-activity.pid")" 2>/dev/null
sleep 2   # let port 3100 free up before restarting
# SIM_CORS_ORIGIN is always an explicit allowlist (no '*' wildcard) —
# list the one origin this test expects to be allowed, plus the default.
SIM_API_KEY=test123 SIM_CORS_ORIGIN='http://localhost:4200,http://allowed.example' nohup node src/store-activity-service/index.js > "$LOG_DIR/store-activity.log" 2>&1 &
echo $! > "$LOG_DIR/store-activity.pid"
sleep 5   # let it reconnect DB/MQTT before hitting it
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3100/store-activity/actions/mark-table-cleared \
  -H 'Content-Type: application/json' -d '{"table_ref":"table-4"}'   # expect 401
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3100/store-activity/actions/mark-table-cleared \
  -H 'Content-Type: application/json' -H 'X-Api-Key: test123' -d '{"table_ref":"table-4"}'   # expect 200
curl -s -D - -o /dev/null -H 'Origin: http://allowed.example' http://localhost:3100/store-activity/health | grep -i access-control-allow-origin   # expect the header, reflecting this origin
curl -s -D - -o /dev/null -H 'Origin: http://random-site.example' http://localhost:3100/store-activity/health | grep -i access-control-allow-origin   # expect no output - not on the allowlist
sleep 1

### ---------- 17. Replay mode ----------
kill "$(cat "$LOG_DIR/store-activity.pid")" 2>/dev/null
sleep 2   # let port 3100 free up before restarting
SIM_MODE=replay SIM_REPLAY_DATE=$(date -u -d '2 days ago' +%F) \
  nohup node src/store-activity-service/index.js > "$LOG_DIR/store-activity-replay.log" 2>&1 &
sleep 5
tail -n 30 "$LOG_DIR/store-activity-replay.log"

### ---------- 17b. Config validation (a typo must be a startup error, not a silent default) ----------
SIM_MODE=lve node src/store-activity-service/index.js || echo "expected failure above (invalid SIM_MODE)"

### ---------- 18. Cleanup ----------
pkill -f "src/store-activity-service/index.js" 2>/dev/null
pkill -f "src/table-occupancy-service/index.js" 2>/dev/null
pkill -f "src/footfall-service/index.js" 2>/dev/null
sleep 1
echo "done"
