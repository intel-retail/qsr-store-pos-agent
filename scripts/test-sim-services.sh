#!/usr/bin/env bash
# Manual test/verification script for the 3 sim services (sim-service,
# table-sim-service, footfall-sim-service) on feature/sim-service.
# Run on a Linux box with Postgres + Mosquitto installed and reachable.
# Not part of the app's runtime/build — copy or scp this onto the test host.

REPO_DIR="${REPO_DIR:-$HOME/project/qsr-store-pos-agent}"
DB_PASSWORD="${DB_PASSWORD:-posdev2024}"

### ---------- 0. Kill any previous run ----------
pkill -f "src/sim-service/index.js" 2>/dev/null
pkill -f "src/table-sim-service/index.js" 2>/dev/null
pkill -f "src/footfall-sim-service/index.js" 2>/dev/null
sleep 2   # let old processes fully release their ports

### ---------- 1. Sync the hub.js fix (client-ID collision) ----------
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
EOF

### ---------- 4. Static sanity check ----------
cd "$REPO_DIR/backend"
for f in src/sim-service/*.js src/table-sim-service/*.js src/footfall-sim-service/*.js; do
  node --check "$f" || echo "FAILED: $f"
done
echo "syntax check done"

### ---------- 5. Start all three headless services ----------
mkdir -p /tmp/sim-logs
nohup node src/sim-service/index.js          > /tmp/sim-logs/sim.log          2>&1 & echo $! > /tmp/sim-logs/sim.pid
nohup node src/table-sim-service/index.js    > /tmp/sim-logs/table-sim.log    2>&1 & echo $! > /tmp/sim-logs/table-sim.pid
nohup node src/footfall-sim-service/index.js > /tmp/sim-logs/footfall-sim.log 2>&1 & echo $! > /tmp/sim-logs/footfall-sim.pid
sleep 10   # give producers + DB init + MQTT connect/subscribe time to settle
tail -n 20 /tmp/sim-logs/*.log

### ---------- 6. Health checks (all three should show "mqtt": "ok") ----------
curl -s http://localhost:3100/sim/health          | jq .
curl -s http://localhost:3200/table-sim/health     | jq .
curl -s http://localhost:3300/footfall-sim/health  | jq .

### ---------- 7. Seed history ----------
node src/sim-service/seed-history.js --days=7
node src/table-sim-service/seed-history.js --days=7
node src/footfall-sim-service/seed-history.js --days=7
node src/sim-service/seed-history.js --days=-5   || echo "expected failure above (invalid --days)"
node src/sim-service/seed-history.js --days=foo  || echo "expected failure above (invalid --days)"
sleep 1

### ---------- 8. sim-service read endpoints ----------
curl -s http://localhost:3100/sim/event-types | jq .
curl -s "http://localhost:3100/sim/history?experience=cafe&group_by=day" | jq .
curl -s "http://localhost:3100/sim/tail?limit=10" | jq .
curl -s "http://localhost:3100/sim/tail?limit=-5" | jq .
curl -s "http://localhost:3100/sim/snapshot?experience=cafe" | jq .
curl -s "http://localhost:3100/sim/compare?experience=cafe&event_type=table.dirty&date=$(date -u +%F)&baseline_date=$(date -u -d '1 day ago' +%F)" | jq .

### ---------- 9. sim-service action endpoints ----------
curl -s -X POST http://localhost:3100/sim/actions/mark-table-cleared \
  -H 'Content-Type: application/json' -d '{"experience":"cafe","table_ref":"table-4"}' | jq .
curl -s -X POST http://localhost:3100/sim/actions/inject-event \
  -H 'Content-Type: application/json' \
  -d '{"experience":"cafe","event_type":"table.occupied","ref":"table-4","severity":"info","payload":{}}' | jq .
sleep 1

### ---------- 10. SSE stream (with resume) ----------
timeout 5 curl -N http://localhost:3100/sim/events/stream
sleep 1
LAST_ID=$(curl -s "http://localhost:3100/sim/tail?limit=1" | jq -r '.[0].event_id')
timeout 5 curl -N -H "Last-Event-ID: $LAST_ID" http://localhost:3100/sim/events/stream
sleep 1

### ---------- 11. table-sim-service ----------
curl -s "http://localhost:3200/table-sim/utilization?table_ref=table-4&start_date=$(date -u -d '7 days ago' +%F)&end_date=$(date -u +%F)" | jq .
curl -s "http://localhost:3200/table-sim/dirty-duration?table_ref=table-4&start_date=$(date -u -d '7 days ago' +%F)&end_date=$(date -u +%F)" | jq .
curl -s "http://localhost:3200/table-sim/history?table_ref=table-4&limit=20" | jq .
curl -s "http://localhost:3200/table-sim/history" | jq .   # missing table_ref -> expect 400
curl -s -X POST http://localhost:3200/table-sim/actions/mark-table-occupied \
  -H 'Content-Type: application/json' -d '{"experience":"cafe","table_ref":"table-4"}' | jq .
curl -s -X POST http://localhost:3200/table-sim/actions/mark-table-cleared \
  -H 'Content-Type: application/json' -d '{"experience":"cafe","table_ref":"table-4"}' | jq .
curl -s -X POST http://localhost:3200/table-sim/ingest \
  -H 'Content-Type: application/json' \
  -d '{"event_type":"table.occupied","experience":"cafe","severity":"info","occurred_at":"'"$(date -u +%FT%TZ)"'","sim_date":"'"$(date -u +%F)"'"}' | jq .
  # expect 400 (missing ref) — only active when SOURCE=real
sleep 1

### ---------- 12. footfall-sim-service (read-only) ----------
curl -s "http://localhost:3300/footfall-sim/total?start_date=$(date -u -d '7 days ago' +%F)&end_date=$(date -u +%F)" | jq .
curl -s "http://localhost:3300/footfall-sim/busy-patterns?start_date=$(date -u -d '7 days ago' +%F)&end_date=$(date -u +%F)" | jq .
curl -s http://localhost:3300/footfall-sim/event-types | jq .
sleep 1

### ---------- 13. MQTT fan-out ----------
mosquitto_sub -h localhost -t 'sim/+/events/#' -t 'table-sim/+/events/#' -t 'footfall-sim/+/events/#' -v &
SUB_PID=$!
sleep 3   # let the subscription establish before publishing
curl -s -X POST http://localhost:3100/sim/actions/inject-event \
  -H 'Content-Type: application/json' \
  -d '{"experience":"cafe","event_type":"table.dirty","ref":"table-2","severity":"info","payload":{}}' > /dev/null
sleep 2   # let the message arrive before killing the subscriber
kill "$SUB_PID" 2>/dev/null
sleep 1

### ---------- 14. Confirm no more client-ID collisions ----------
sudo grep -iE "sim-hub" /var/log/mosquitto/mosquitto.log | tail -n 20
# expect: no repeating "already connected, closing old connection" for the same client id anymore

### ---------- 15. MCP servers (stdio) ----------
npm install -g @modelcontextprotocol/inspector 2>/dev/null
sleep 1
npx @modelcontextprotocol/inspector --cli node src/sim-service/mcp-sim-server.js --method tools/list
npx @modelcontextprotocol/inspector --cli node src/sim-service/mcp-sim-server.js --method tools/call --tool-name describe_service
npx @modelcontextprotocol/inspector --cli node src/table-sim-service/mcp-table-sim-server.js --method tools/list
npx @modelcontextprotocol/inspector --cli node src/footfall-sim-service/mcp-footfall-sim-server.js --method tools/list
sleep 1

### ---------- 16. Auth & CORS ----------
kill "$(cat /tmp/sim-logs/sim.pid)" 2>/dev/null
sleep 2   # let port 3100 free up before restarting
SIM_API_KEY=test123 SIM_CORS_ORIGIN='*' nohup node src/sim-service/index.js > /tmp/sim-logs/sim.log 2>&1 &
echo $! > /tmp/sim-logs/sim.pid
sleep 5   # let it reconnect DB/MQTT before hitting it
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3100/sim/actions/mark-table-cleared \
  -H 'Content-Type: application/json' -d '{"table_ref":"table-4"}'   # expect 401
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3100/sim/actions/mark-table-cleared \
  -H 'Content-Type: application/json' -H 'X-Api-Key: test123' -d '{"table_ref":"table-4"}'   # expect 200
curl -s -D - -o /dev/null -H 'Origin: http://random-site.example' http://localhost:3100/sim/health | grep -i access-control-allow-origin
sleep 1

### ---------- 17. Replay mode ----------
kill "$(cat /tmp/sim-logs/sim.pid)" 2>/dev/null
sleep 2   # let port 3100 free up before restarting
SIM_MODE=replay SIM_REPLAY_DATE=$(date -u -d '2 days ago' +%F) \
  nohup node src/sim-service/index.js > /tmp/sim-logs/sim-replay.log 2>&1 &
sleep 5
tail -n 30 /tmp/sim-logs/sim-replay.log

### ---------- 18. Cleanup ----------
pkill -f "src/sim-service/index.js" 2>/dev/null
pkill -f "src/table-sim-service/index.js" 2>/dev/null
pkill -f "src/footfall-sim-service/index.js" 2>/dev/null
sleep 1
echo "done"
