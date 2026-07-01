#!/usr/bin/env bash
#
# Stop everything LiveProbe: the host-side LiveProbe server and the whole Docker testbed
# (all services, including the loadgen and frontend profiles).
#
# Usage:
#   ./stop.sh           # stop the server + tear down the stack, keep data
#   ./stop.sh --wipe    # also remove Docker volumes (wipes the Postgres data)

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

WIPE=0
for arg in "$@"; do
  case "$arg" in
    --wipe) WIPE=1 ;;
    *) echo "unknown option: $arg" >&2; exit 1 ;;
  esac
done

echo "==> Stopping the LiveProbe server (host process)"
if pkill -f "packages/server/src/index.ts" 2>/dev/null; then
  echo "    stopped"
else
  echo "    (not running)"
fi

echo "==> Tearing down the Docker testbed"
if [[ "$WIPE" == "1" ]]; then
  ( cd testbed && docker compose down -v )
  echo "    containers, networks, and volumes removed (data wiped)"
else
  ( cd testbed && docker compose down )
  echo "    containers and networks removed (Postgres data kept)"
fi

echo "==> Done. Everything is stopped."
