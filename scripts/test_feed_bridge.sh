#!/usr/bin/env bash
# Starts a fresh disposable local D1; never points tests at production.
set -euo pipefail
cd "$(dirname "$0")/.."
# Refuse to reuse any server/database already bound to the test port.
python3 - <<'PY_PORT'
import socket
s=socket.socket()
try:s.bind(('127.0.0.1',8807))
except OSError:raise SystemExit('Port 8807 is occupied; stop that local test server first.')
finally:s.close()
PY_PORT
TEST_DIR=$(mktemp -d /tmp/honey-feed-tests.XXXXXX)
TEST_PID=''
cleanup() {
  if [[ -n "$TEST_PID" ]]; then kill "$TEST_PID" 2>/dev/null || true; wait "$TEST_PID" 2>/dev/null || true; fi
  rm -rf "$TEST_DIR"
}
trap cleanup EXIT
npm run build > "$TEST_DIR/build.log" 2>&1
node_modules/.bin/wrangler d1 migrations apply DB --local --persist-to "$TEST_DIR/db" > "$TEST_DIR/server.log" 2>&1
node_modules/.bin/wrangler pages dev --port 8807 --ip 127.0.0.1 --persist-to "$TEST_DIR/db" --binding FEED_MCP_ORIGIN=http://127.0.0.1:8807 --binding FEED_OAUTH_SECRET=local-test-only-012345678901234567890123456789 --binding DEV_NO_AUTH=1 >> "$TEST_DIR/server.log" 2>&1 &
TEST_PID=$!
python3 - <<'PY'
import time,urllib.request
for attempt in range(40):
 try:
  with urllib.request.urlopen('http://127.0.0.1:8807/.well-known/oauth-authorization-server',timeout=1) as r:
   if r.status==200:break
 except Exception:time.sleep(.5)
else:raise SystemExit('Local test server failed to start')
PY
python3 -B tests/feed_fixture.py http://127.0.0.1:8807
python3 -B tests/test_feed_bridge.py

python3 -B tests/test_daily_feeds.py "$TEST_DIR/db"
python3 -B tests/test_focus_background.py http://127.0.0.1:8807 "$TEST_DIR/db"
