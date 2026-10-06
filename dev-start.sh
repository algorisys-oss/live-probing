#!/usr/bin/env bash
#
# LiveProbe end-to-end dev runner.
#
# Modes:
#   ./dev-start.sh            Hot-reload dev loop (DEFAULT):
#                         - LiveProbe UI runs under Vite with HMR at http://localhost:5173
#                         - LiveProbe server runs under `tsx watch` (restarts on change)
#                         - testbed services run under `tsx watch` (via docker-compose.dev.yml)
#                       Edit any source and it reloads. Open http://localhost:5173.
#   ./dev-start.sh --static   Build the UI and serve it statically from the server at :4319.
#                       No hot reload (good for a demo / just using it).
#   ./dev-start.sh --no-load  Don't start the traffic generator.
#   ./dev-start.sh --no-build (static mode only) Reuse the existing UI build.
#   ./dev-start.sh --chaos    Inject failure modes (slow catalog, flaky order, retries + circuit
#                             breaking) so LiveProbe's health/alert views show real red/amber.
#                             See testbed/docker-compose.chaos.yml. Combine with any mode.
#
# The foreground process is the LiveProbe server; Ctrl-C stops it (and, in watch mode, the
# UI dev server). The Docker stack keeps running — stop it all with ./dev-stop.sh.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

LIVEPROBE_PORT="${LIVEPROBE_PORT:-4319}"
UI_DEV_PORT="${UI_DEV_PORT:-5173}"
WATCH=1
DO_BUILD=1
DO_LOAD=1
CHAOS=0
for arg in "$@"; do
  case "$arg" in
    --watch) WATCH=1 ;;                 # default; kept for back-compat
    --static | --build) WATCH=0 ;;      # build the UI and serve it statically
    --no-build) DO_BUILD=0 ;;
    --no-load) DO_LOAD=0 ;;
    --chaos) CHAOS=1 ;;                 # inject failure modes (see testbed/docker-compose.chaos.yml)
    *) echo "unknown option: $arg" >&2; exit 1 ;;
  esac
done

# Optional chaos overlay: adds the fault/resilience env so LiveProbe shows real red/amber.
CHAOS_FILE=()
if [[ "$CHAOS" == "1" ]]; then
  CHAOS_FILE=(-f docker-compose.chaos.yml)
  echo "==> CHAOS mode: injecting failure modes (slow catalog, flaky order, retries + breaker)"
fi

echo "==> Installing LiveProbe dependencies"
npm install --silent

pkill -f "packages/server/src/index.ts" 2>/dev/null || true

if [[ "$WATCH" == "1" ]]; then
  echo "==> WATCH mode: hot reload for UI, server, and testbed"

  echo "==> Starting the testbed under tsx watch (docker)"
  ( cd testbed && docker compose -f docker-compose.yml -f docker-compose.dev.yml "${CHAOS_FILE[@]}" up -d --build )
  if [[ "$DO_LOAD" == "1" ]]; then
    ( cd testbed && docker compose -f docker-compose.yml -f docker-compose.dev.yml "${CHAOS_FILE[@]}" --profile load up -d loadgen )
  fi

  echo "==> Starting the LiveProbe UI dev server (Vite HMR)"
  ( cd packages/ui && npm install --silent )
  ( cd packages/ui && npm run dev -- --host --port "$UI_DEV_PORT" ) &
  UI_PID=$!
  trap 'echo; echo "stopping UI dev server…"; kill "$UI_PID" 2>/dev/null || true' EXIT INT TERM

  cat <<EOF

------------------------------------------------------------
  LiveProbe UI (HMR)   http://localhost:${UI_DEV_PORT}     <-- open this in --watch mode
  LiveProbe API/ws     http://localhost:${LIVEPROBE_PORT}
  Jaeger (compare)     http://localhost:16687
------------------------------------------------------------
  Edit any source and it reloads. Ctrl-C stops the server + UI dev.
  Stop everything:  ./dev-stop.sh
------------------------------------------------------------

EOF

  echo "==> Starting the LiveProbe server under tsx watch on :${LIVEPROBE_PORT}"
  # Bind all interfaces so the dockerized testbed collector can reach us via
  # host.docker.internal (host-gateway); the server defaults to loopback-only.
  HOST="${HOST:-0.0.0.0}" PORT="${LIVEPROBE_PORT}" npx tsx watch packages/server/src/index.ts
  exit 0
fi

# --- build (non-watch) mode ---
if [[ "$DO_BUILD" == "1" ]]; then
  echo "==> Building the LiveProbe UI"
  ( cd packages/ui && npm install --silent && npm run build )
  rm -rf packages/server/public
  cp -r packages/ui/dist packages/server/public
else
  echo "==> Skipping UI build (--no-build)"
fi

echo "==> Starting the Shopwave testbed (Docker; first run builds images)"
( cd testbed && docker compose -f docker-compose.yml "${CHAOS_FILE[@]}" up -d --build )

if [[ "$DO_LOAD" == "1" ]]; then
  echo "==> Starting the traffic generator"
  ( cd testbed && docker compose -f docker-compose.yml "${CHAOS_FILE[@]}" --profile load up -d loadgen )
fi

sleep 1
cat <<EOF

------------------------------------------------------------
  LiveProbe UI      http://localhost:${LIVEPROBE_PORT}
  Jaeger (compare)  http://localhost:16687
  Storefront SPA    http://localhost:8088   (cd testbed && docker compose --profile ui up -d frontend)
------------------------------------------------------------
  Ctrl-C stops the LiveProbe server. The Docker stack stays up.
  Stop everything:  ./dev-stop.sh
------------------------------------------------------------

EOF

echo "==> Starting the LiveProbe server on :${LIVEPROBE_PORT} (serves UI + API + ws)"
# Bind all interfaces so the dockerized testbed collector can reach us via
# host.docker.internal (host-gateway); the server defaults to loopback-only.
HOST="${HOST:-0.0.0.0}" PORT="${LIVEPROBE_PORT}" exec npx tsx packages/server/src/index.ts
