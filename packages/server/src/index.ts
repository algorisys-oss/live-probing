import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import type { Alert } from "@liveprobe/core";
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
  // Bind loopback by default (the ingest/API have no auth). Point a containerized collector or
  // a remote app at LiveProbe by setting HOST=0.0.0.0 — and keep the port on a trusted network.
  const host = process.env.HOST || "127.0.0.1";
  // CORS_ORIGINS: comma-separated extra browser origins allowed beyond loopback.
  const corsOrigins = (process.env.CORS_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter((o) => o.length > 0);
  // ALERT_WEBHOOK_URL: POST target fired once per inactive→active alert transition. Unset = off.
  // Tune with ALERT_WEBHOOK_TIMEOUT_MS / _RETRIES / _COOLDOWN_MS (see alert-webhook.ts defaults).
  const alertWebhookUrl = process.env.ALERT_WEBHOOK_URL?.trim();
  const alertWebhook = alertWebhookUrl
    ? {
        url: alertWebhookUrl,
        timeoutMs: numEnv("ALERT_WEBHOOK_TIMEOUT_MS", { min: 1 }),
        retries: numEnv("ALERT_WEBHOOK_RETRIES", { min: 0 }),
        cooldownMs: numEnv("ALERT_WEBHOOK_COOLDOWN_MS", { min: 0 }),
        onSent: (a: Alert & { since: number }) => console.log(`alert webhook sent: ${a.id}`),
        onError: (err: unknown, a: Alert & { since: number }) =>
          console.warn(`alert webhook failed for ${a.id}:`, err instanceof Error ? err.message : err),
      }
    : undefined;
  const server = createServer({
    publicDir: existsSync(publicDir) ? publicDir : undefined,
    dbPath,
    retentionDays,
    horizonMicros: liveWindowMinutes !== undefined ? liveWindowMinutes * 60 * 1_000_000 : undefined,
    maxTraces,
    host,
    // MASK_PII=off disables the built-in PII/secret scrubbing (not recommended).
    mask: process.env.MASK_PII === "off" ? false : undefined,
    corsOrigins: corsOrigins.length > 0 ? corsOrigins : undefined,
    alertWebhook,
  });

  const shutdown = () => void server.close().then(() => process.exit(0));
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  server.listen(port).then(() => {
    console.log(`liveprobe server listening on ${host}:${port} (OTLP ingest POST /v1/traces, ws /ws)`);
  });
}
