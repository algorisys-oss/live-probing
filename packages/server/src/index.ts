import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { createServer } from "./server.js";

export { createServer } from "./server.js";
export type { LiveProbeServer, ServerOptions } from "./server.js";
export { summarize, detail, type TraceSummary, type TraceDetail } from "./summary.js";

// Run directly (not when imported by a test).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.env.PORT ?? "4318");
  // Serve the built UI if it has been copied next to the server.
  const publicDir = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
  const server = createServer({ publicDir: existsSync(publicDir) ? publicDir : undefined });

  const shutdown = () => void server.close().then(() => process.exit(0));
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  server.listen(port).then(() => {
    console.log(`liveprobe server listening on :${port} (OTLP ingest POST /v1/traces, ws /ws)`);
  });
}
