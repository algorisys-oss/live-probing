import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import { createServer } from "./server.js";

export { createServer } from "./server.js";
export type { LiveProbeServer, ServerOptions } from "./server.js";
export { summarize, detail, type TraceSummary, type TraceDetail } from "./summary.js";

// Run directly (not when imported by a test).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.env.PORT ?? "4318");
  // Serve the built UI if it has been copied next to the server.
  const here = dirname(fileURLToPath(import.meta.url));
  const publicDir = join(here, "..", "public");
  // Persist history at DB_PATH (e.g. a mounted /data volume) or next to the server by default.
  // Ensure the db's own directory exists — not a hardcoded one — so a custom DB_PATH works and
  // we never try to mkdir an unwritable path (e.g. running unprivileged in a container).
  const dbPath = process.env.DB_PATH ?? join(here, "..", "data", "liveprobe.db");
  if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });
  // A finite, in-range env number or undefined (fall back to the createServer default).
  const numEnv = (name: string, { min = -Infinity } = {}): number | undefined => {
    const raw = process.env[name];
    if (raw === undefined || raw === "") return undefined;
    const n = Number(raw);
    return Number.isFinite(n) && n >= min ? n : undefined;
  };
  // RETENTION_DAYS: keep the N most recent UTC days of history (default 30; 0 disables).
  const retentionDays = numEnv("RETENTION_DAYS", { min: 0 });
  // LIVE_WINDOW_MINUTES: how long a trace stays in the live in-memory streaming window
  // (default 5). MAX_TRACES: hard cap on traces held live in memory (default 2000). Neither
  // affects the by-id waterfall/sequence detail view — that is governed by RETENTION_DAYS.
  const liveWindowMinutes = numEnv("LIVE_WINDOW_MINUTES", { min: 0 });
  const maxTraces = numEnv("MAX_TRACES", { min: 1 });
  const server = createServer({
    publicDir: existsSync(publicDir) ? publicDir : undefined,
    dbPath,
    retentionDays,
    horizonMicros: liveWindowMinutes !== undefined ? liveWindowMinutes * 60 * 1_000_000 : undefined,
    maxTraces,
  });

  const shutdown = () => void server.close().then(() => process.exit(0));
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  server.listen(port).then(() => {
    console.log(`liveprobe server listening on :${port} (OTLP ingest POST /v1/traces, ws /ws)`);
  });
}
