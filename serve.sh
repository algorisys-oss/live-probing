#!/usr/bin/env bash
#
# Run just the LiveProbe server — ingest (:4319 OTLP/JSON + native) + API + UI.
# No testbed, no watch mode. This is the entry point for pointing a real app at
# LiveProbe (see docs/integrating-your-app.md); dev-start.sh is for developing
# LiveProbe itself.
#
#   ./serve.sh                 # build the UI if missing, serve on :4319
#   ./serve.sh --build         # force a UI rebuild first
#
# Env:
#   PORT            listen port                          (default 4319)
#   DB_PATH         history SQLite file                  (default packages/server/data/liveprobe.db)
#   RETENTION_DAYS  keep N most recent days of history   (default 14; 0 disables)

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

[[ -d node_modules ]] || { echo "==> Installing dependencies"; npm install --silent; }

if [[ "${1:-}" == "--build" || ! -f packages/server/public/index.html ]]; then
  echo "==> Building the UI"
  (cd packages/ui && npm install --silent && npm run build)
  rm -rf packages/server/public
  cp -r packages/ui/dist packages/server/public
fi

echo "==> LiveProbe listening on :${PORT:-4319}  (UI + OTLP/native ingest + ws)"
echo "    Keep this port private — the ingest has no auth."
PORT="${PORT:-4319}" exec npx tsx packages/server/src/index.ts
