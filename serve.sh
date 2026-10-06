#!/usr/bin/env bash
#
# Run just the LiveProbe server — ingest (:4319 OTLP/JSON + native) + API + UI.
# No testbed, no watch mode. This is the entry point for pointing a real app at
# LiveProbe (see docs/integrating-your-app.md); dev-start.sh is for developing
# LiveProbe itself.
#
#   ./serve.sh                 # build the UI if missing, serve on :4319
#   ./serve.sh --build         # force a UI rebuild first
#   ./serve.sh --collector     # also run the algo-instrumentation collector on :4320
#
# Flags combine (order-independent): ./serve.sh --build --collector
#
# The server only speaks OTLP + already-normalized native events. Apps that emit the
# internal instrumentation-service format (/v1/event/*, module/function granularity) POST
# to the collector, which maps them to Events and forwards to the server. --collector runs
# it alongside the server so that richer stream isn't silently dropped.
#
# Env:
#   PORT            server listen port                    (default 4319)
#   COLLECTOR_PORT  collector http-source port (--collector only) (default 4320)
#   DB_PATH         history SQLite file                   (default packages/server/data/liveprobe.db)
#   RETENTION_DAYS  keep N most recent days of history    (default 14; 0 disables)

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

BUILD=0
COLLECTOR=0
for arg in "$@"; do
  case "$arg" in
    --build) BUILD=1 ;;
    --collector) COLLECTOR=1 ;;
    *) echo "serve.sh: unknown option '$arg' (use --build, --collector)" >&2; exit 2 ;;
  esac
done

[[ -d node_modules ]] || { echo "==> Installing dependencies"; npm install --silent; }

if [[ "$BUILD" == 1 || ! -f packages/server/public/index.html ]]; then
  echo "==> Building the UI"
  (cd packages/ui && npm install --silent && npm run build)
  rm -rf packages/server/public
  cp -r packages/ui/dist packages/server/public
fi

PORT="${PORT:-4319}"

if [[ "$COLLECTOR" == 1 ]]; then
  COLLECTOR_PORT="${COLLECTOR_PORT:-4320}"
  echo "==> algo-instrumentation collector on :${COLLECTOR_PORT}  ->  :${PORT}/v1/events"
  echo "    Point your app's /v1/event/* emitter at :${COLLECTOR_PORT}."
  SOURCE=http ADAPTER=algo-instrumentation HTTP_PORT="$COLLECTOR_PORT" \
    LIVEPROBE_URL="http://localhost:${PORT}" npx tsx packages/collector/src/index.ts &
  COLLECTOR_PID=$!
  # Tear the collector down when the server exits or we're interrupted.
  trap 'kill "$COLLECTOR_PID" 2>/dev/null || true' EXIT INT TERM
fi

echo "==> LiveProbe listening on :${PORT}  (UI + OTLP/native ingest + ws)"
echo "    Keep this port private — the ingest has no auth."

# Foreground the server. With --collector we can't exec (the trap must survive to reap the
# collector); without it, exec keeps the original single-process behavior.
if [[ "$COLLECTOR" == 1 ]]; then
  PORT="$PORT" npx tsx packages/server/src/index.ts
else
  PORT="$PORT" exec npx tsx packages/server/src/index.ts
fi
