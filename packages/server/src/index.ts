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
  // RETENTION_DAYS: keep the N most recent UTC days of history (default 14; 0 disables).
  const retentionEnv = Number(process.env.RETENTION_DAYS);
  const server = createServer({
    publicDir: existsSync(publicDir) ? publicDir : undefined,
    dbPath,
    retentionDays: Number.isFinite(retentionEnv) ? retentionEnv : undefined,
  });

  const shutdown = () => void server.close().then(() => process.exit(0));
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  server.listen(port).then(() => {
    console.log(`liveprobe server listening on :${port} (OTLP ingest POST /v1/traces, ws /ws)`);
  });
}
