#!/usr/bin/env bash
#
# LiveProbe end-to-end dev runner.
#
# Brings up the whole thing: the Shopwave testbed (8 services + Postgres/Redis/RabbitMQ +
# OTel collector + Jaeger in Docker), a traffic generator, and the LiveProbe server, which
# also serves the built React UI. The testbed collector is already configured to export
# OTLP to LiveProbe, so traces flow in automatically.
#
# Usage:
#   ./dev.sh              # build UI, start testbed + loadgen + LiveProbe (foreground)
#   ./dev.sh --no-load    # same, but do not start the traffic generator
#   ./dev.sh --no-build   # skip rebuilding the UI (use the existing packages/server/public)
#   LIVEPROBE_PORT=4319 ./dev.sh
#
# The LiveProbe server runs in the foreground; Ctrl-C stops it. The Docker stack keeps
# running — tear it down with:  cd testbed && docker compose down   (add -v to wipe data)

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

LIVEPROBE_PORT="${LIVEPROBE_PORT:-4319}"
DO_BUILD=1
DO_LOAD=1
for arg in "$@"; do
  case "$arg" in
    --no-build) DO_BUILD=0 ;;
    --no-load) DO_LOAD=0 ;;
    *) echo "unknown option: $arg" >&2; exit 1 ;;
  esac
done

echo "==> Installing LiveProbe dependencies"
npm install --silent

if [[ "$DO_BUILD" == "1" ]]; then
  echo "==> Building the LiveProbe UI"
  ( cd packages/ui && npm install --silent && npm run build )
  rm -rf packages/server/public
  cp -r packages/ui/dist packages/server/public
else
  echo "==> Skipping UI build (--no-build)"
fi

echo "==> Starting the Shopwave testbed (Docker; first run builds images)"
( cd testbed && docker compose up -d --build )

if [[ "$DO_LOAD" == "1" ]]; then
  echo "==> Starting the traffic generator"
  ( cd testbed && docker compose --profile load up -d loadgen )
fi

# Free the port if a previous LiveProbe server is still holding it.
pkill -f "packages/server/src/index.ts" 2>/dev/null || true
sleep 1

cat <<EOF

------------------------------------------------------------
  LiveProbe UI      http://localhost:${LIVEPROBE_PORT}
  Jaeger (compare)  http://localhost:16687
  Storefront SPA    http://localhost:8088   (cd testbed && docker compose --profile ui up -d frontend)
------------------------------------------------------------
  Ctrl-C stops the LiveProbe server. The Docker stack stays up.
  Stop everything:  cd testbed && docker compose down
------------------------------------------------------------

EOF

echo "==> Starting the LiveProbe server on :${LIVEPROBE_PORT} (serves UI + API + ws)"
PORT="${LIVEPROBE_PORT}" exec npx tsx packages/server/src/index.ts
