import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { extname, join, normalize, resolve } from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import {
  TraceWindow,
  normalizeOtlp,
  coerceEvents,
  maskEvents,
  toMermaidFlow,
  redMetrics,
  type AssembledTrace,
  type Event,
  type MaskOptions,
  type OtlpPayload,
} from "@liveprobe/core";
import { detail, summarize, type TraceSummary } from "./summary.js";
import { HistoryStore } from "./history-store.js";

export interface ServerOptions {
  publicDir?: string; // built UI, if present
  dbPath?: string; // sqlite history db; ":memory:" (default) or a file path
  maxTraces?: number;
  horizonMicros?: number;
  topologyIntervalMs?: number;
  // Keep the N most recent UTC days of history (including today); older day-partitions are
  // pruned at startup and hourly. 0 disables retention. Default 30.
  retentionDays?: number;
  // How often staged history writes are flushed to SQLite. Ingest only *stages* the latest
  // assembly of each touched trace; any /api read flushes first (read-your-writes), so this
  // interval bounds crash loss, not visibility. Default 1500ms.
  historyFlushMs?: number;
  // Interface to bind. Default "127.0.0.1" (loopback only) — the ingest and API have no auth,
  // so exposing them on all interfaces is opt-in. Set to "0.0.0.0" to listen everywhere.
  host?: string;
  // PII/secret masking applied to every ingested event before it is buffered, persisted, or
  // broadcast. Defaults to the built-in ruleset. Pass `false` to disable (not recommended).
  mask?: MaskOptions | false;
  // Extra browser origins allowed for CORS / WebSocket beyond the always-allowed loopback
  // origins (localhost / 127.0.0.1 / ::1, any port).
  corsOrigins?: string[];
}

// Hard limits on a single ingest request. The body cap bounds buffering; the decompression
// cap bounds a gzip bomb (a few KB of zeros can otherwise expand to gigabytes).
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const MAX_DECOMPRESSED_BYTES = 32 * 1024 * 1024;

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

export interface LiveProbeServer {
  listen(port: number): Promise<void>;
  close(): Promise<void>;
  readonly window: TraceWindow;
}

export function createServer(opts: ServerOptions = {}): LiveProbeServer {
  const window = new TraceWindow({ maxTraces: opts.maxTraces ?? 2000, horizonMicros: opts.horizonMicros });
  const store = new HistoryStore(opts.dbPath ?? ":memory:");
  const clients = new Set<WebSocket>();
  let topologyDirty = false;

  const broadcast = (message: unknown) => {
    const text = JSON.stringify(message);
    for (const ws of clients) {
      if (ws.readyState === ws.OPEN) ws.send(text);
    }
  };

  const recentSummaries = (limit: number): TraceSummary[] =>
    window
      .traceIds()
      .map((id) => window.assemble(id))
      .filter((t): t is NonNullable<typeof t> => t !== null)
      .map(summarize)
      .sort((a, b) => b.startTime - a.startTime)
      .slice(0, limit);

  // History writes are debounced: ingest stages the latest assembly of each touched trace,
  // and a batch is written on the flush timer or before any /api read (read-your-writes).
  // A trace that grows across many ingest batches is then written once per flush instead of
  // once per batch (the old write-amplification, see docs/implementation-review.md #4).
  const pendingHistory = new Map<string, AssembledTrace>();
  const flushHistory = () => {
    if (pendingHistory.size === 0) return;
    const batch = [...pendingHistory.values()];
    pendingHistory.clear();
    // Never let a bad batch escape: this runs on a timer with no caller to catch it, so an
    // uncaught throw here would take down the whole process (upsertMany already rolls back
    // its transaction on error).
    try {
      store.upsertMany(batch);
    } catch (err) {
      console.error("[liveprobe] history flush failed:", (err as Error).message);
    }
  };
  const flushTimer = setInterval(flushHistory, opts.historyFlushMs ?? 1500);
  flushTimer.unref();

  // Retention: drop day-partitions older than the window, at startup and hourly.
  const retentionDays = opts.retentionDays ?? 30;
  const prune = () => {
    const dropped = store.prune(retentionDays);
    if (dropped > 0) console.log(`[liveprobe] retention: pruned ${dropped} traces older than ${retentionDays} days`);
  };
  prune();
  const pruneTimer = setInterval(prune, 3_600_000);
  pruneTimer.unref();

  // PII/secret masking at the ingest chokepoint: scrub before an event is buffered,
  // persisted, or broadcast. Nothing downstream re-inspects payloads, so this is the place.
  const maskOpt = opts.mask;
  const scrub = (events: Event[]): Event[] => (maskOpt === false ? events : maskEvents(events, maskOpt));

  // Shared ingest path for both OTLP and native events.
  const ingestEvents = (rawEvents: Event[]) => {
    if (rawEvents.length === 0) return;
    const events = scrub(rawEvents);
    window.add(events);

    const affected = [...new Set(events.map((e) => e.traceId))];
    const assembled = affected
      .map((id) => window.assemble(id))
      .filter((t): t is NonNullable<typeof t> => t !== null);
    if (assembled.length > 0) {
      broadcast({ type: "traces", traces: assembled.map(summarize) });
      for (const t of assembled) pendingHistory.set(t.traceId, t); // staged for the daily/history view
    }
    topologyDirty = true;
  };

  // A browser Origin is allowed if it is loopback (any port) or explicitly configured.
  // Non-browser clients (no Origin header — e.g. the collector, curl) are not subject to the
  // same-origin policy and pass through; the check exists to stop a malicious *website* from
  // reading traces cross-origin (CORS) or hijacking the live stream (cross-site WebSocket).
  const originAllowed = (origin: string | undefined): boolean => {
    if (!origin) return true;
    if (opts.corsOrigins?.includes(origin)) return true;
    try {
      const host = new URL(origin).hostname;
      return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
    } catch {
      return false;
    }
  };

  const httpServer = createHttpServer((req, res) => void handle(req, res));

  const wss = new WebSocketServer({
    server: httpServer,
    path: "/ws",
    verifyClient: (info: { origin?: string }) => originAllowed(info.origin),
  });
  // Per-service RED (rate/errors/p95) over the live window — the triage strip on the live view.
  const red = () =>
    redMetrics(
      window
        .traceIds()
        .map((id) => window.assemble(id))
        .filter((t): t is NonNullable<typeof t> => t !== null),
    );

  wss.on("connection", (ws) => {
    clients.add(ws);
    ws.on("close", () => clients.delete(ws));
    ws.on("error", () => clients.delete(ws));
    const topology = window.topology();
    ws.send(
      JSON.stringify({
        type: "snapshot",
        traces: recentSummaries(100),
        topology,
        mermaidFlow: toMermaidFlow(topology),
        red: red(),
      }),
    );
  });

  const timer = setInterval(() => {
    if (!topologyDirty) return;
    topologyDirty = false;
    const topology = window.topology();
    broadcast({ type: "topology", topology, mermaidFlow: toMermaidFlow(topology), red: red() });
  }, opts.topologyIntervalMs ?? 750);
  timer.unref();

  // Per-service view from the live window: deps (from the topology graph) + the service's
  // own operations and error rate (scanned from its spans).
  const serviceDetail = (name: string) => {
    const topology = window.topology();
    const inbound = [...new Set(topology.edges.filter((e) => e.to === name).map((e) => e.from))];
    const outbound = [...new Set(topology.edges.filter((e) => e.from === name).map((e) => e.to))];
    const ops = new Map<string, { calls: number; errors: number; dur: number }>();
    let spans = 0;
    let errors = 0;
    for (const id of window.traceIds()) {
      const t = window.assemble(id);
      if (!t) continue;
      for (const e of t.events) {
        if (e.participant !== name) continue;
        spans++;
        if (e.status === "error") errors++;
        const o = ops.get(e.operation) ?? { calls: 0, errors: 0, dur: 0 };
        o.calls++;
        if (e.status === "error") o.errors++;
        o.dur += e.duration;
        ops.set(e.operation, o);
      }
    }
    const operations = [...ops.entries()]
      .map(([operation, o]) => ({ operation, calls: o.calls, errors: o.errors, avgMicros: Math.round(o.dur / o.calls) }))
      .sort((a, b) => b.calls - a.calls)
      .slice(0, 30);
    return { name, spans, errors, errorRate: spans > 0 ? errors / spans : 0, inbound, outbound, operations };
  };

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Reflect only allowed origins (loopback or configured) rather than a blanket "*", so an
    // arbitrary website can't read the trace store from the operator's browser.
    const origin = req.headers.origin;
    if (typeof origin === "string" && originAllowed(origin)) {
      res.setHeader("access-control-allow-origin", origin);
      res.setHeader("vary", "origin");
      res.setHeader("access-control-allow-headers", "content-type");
    }
    if (req.method === "OPTIONS") return end(res, 204, "");

    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;

    // Read-your-writes: API reads hit the history store, so land staged writes first.
    if (req.method === "GET" && path.startsWith("/api/")) flushHistory();

    try {
      if (req.method === "POST" && (path === "/v1/traces" || path === "/v1/events")) {
        const raw = await readBody(req, MAX_BODY_BYTES);
        const encoding = String(req.headers["content-encoding"] ?? "");
        // Cap decompression so a small gzip payload can't expand to gigabytes (zip bomb).
        const text = encoding.includes("gzip")
          ? gunzipSync(raw, { maxOutputLength: MAX_DECOMPRESSED_BYTES }).toString("utf8")
          : raw.toString("utf8");
        const body: unknown = text ? JSON.parse(text) : {};
        // /v1/traces = OTLP spans; /v1/events = already-normalized events (from an adapter).
        if (path === "/v1/traces") {
          ingestEvents(normalizeOtlp(body as OtlpPayload));
          return json(res, 200, {}); // OTLP success (collector expects an empty response)
        }
        const events = coerceEvents(body);
        ingestEvents(events);
        return json(res, 200, { accepted: events.length });
      }
      if (req.method === "GET" && path === "/healthz") return json(res, 200, { status: "ok" });
      if (req.method === "GET" && path === "/api/traces") {
        const limit = Number(url.searchParams.get("limit") ?? "100");
        return json(res, 200, { traces: recentSummaries(Number.isFinite(limit) ? limit : 100) });
      }
      if (req.method === "GET" && path.startsWith("/api/traces/")) {
        const id = decodeURIComponent(path.slice("/api/traces/".length));
        const trace = window.assemble(id);
        // Fall back to history for traces that have aged out of the live window.
        if (trace) return json(res, 200, detail(trace));
        const stored = store.getDetail(id);
        if (stored) return json(res, 200, stored);
        return json(res, 404, { error: "trace_not_found" });
      }
      if (req.method === "GET" && path === "/api/topology") {
        const topology = window.topology();
        return json(res, 200, { topology, mermaidFlow: toMermaidFlow(topology) });
      }
      if (req.method === "GET" && path.startsWith("/api/service/")) {
        const name = decodeURIComponent(path.slice("/api/service/".length));
        return json(res, 200, serviceDetail(name));
      }
      if (req.method === "GET" && path === "/api/errors") {
        const limit = Number(url.searchParams.get("limit") ?? "100");
        return json(res, 200, { groups: store.errorGroups(Number.isFinite(limit) && limit > 0 ? limit : 100) });
      }
      if (req.method === "GET" && /^\/api\/day\/[^/]+\/latency$/.test(path)) {
        const day = decodeURIComponent(path.split("/")[3]!);
        const endpoint = url.searchParams.get("endpoint");
        if (!endpoint) return json(res, 400, { error: "endpoint_required" });
        return json(res, 200, {
          buckets: store.endpointLatency(day, endpoint),
          distribution: store.endpointDistribution(day, endpoint),
        });
      }
      if (req.method === "GET" && /^\/api\/day\/[^/]+\/flamegraph$/.test(path)) {
        const day = decodeURIComponent(path.split("/")[3]!);
        const endpoint = url.searchParams.get("endpoint");
        if (!endpoint) return json(res, 400, { error: "endpoint_required" });
        return json(res, 200, { flame: store.endpointFlamegraph(day, endpoint) });
      }
      if (req.method === "GET" && path === "/api/search") {
        const q = url.searchParams;
        const errParam = q.get("error");
        const posInt = (name: string): number | undefined => {
          const n = Number(q.get(name));
          return Number.isFinite(n) && n > 0 ? n : undefined;
        };
        const minMs = posInt("minMs");
        const maxMs = posInt("maxMs");
        const limit = posInt("limit");
        const traces = store.search({
          q: q.get("q") ?? undefined,
          service: q.get("service") ?? undefined,
          attr: q.get("attr") ?? undefined,
          error: errParam === null || errParam === "" ? undefined : errParam === "true",
          minMicros: minMs !== undefined ? minMs * 1000 : undefined,
          maxMicros: maxMs !== undefined ? maxMs * 1000 : undefined,
          minSpans: posInt("minSpans"),
          traceId: q.get("traceId") ?? undefined,
          sort: q.get("sort") === "slowest" ? "slowest" : "recent",
          limit: limit ?? 100,
        });
        return json(res, 200, { traces });
      }
      if (req.method === "GET" && path === "/api/days") {
        return json(res, 200, { days: store.days() });
      }
      if (req.method === "GET" && /^\/api\/day\/[^/]+\/summary$/.test(path)) {
        const day = decodeURIComponent(path.split("/")[3]!);
        return json(res, 200, store.daySummary(day));
      }
      if (req.method === "GET" && /^\/api\/day\/[^/]+\/traces$/.test(path)) {
        const day = decodeURIComponent(path.split("/")[3]!);
        const limit = Number(url.searchParams.get("limit") ?? "200");
        return json(res, 200, { traces: store.dayTraces(day, Number.isFinite(limit) ? limit : 200) });
      }
      if (req.method === "GET") return serveStatic(res, path, opts.publicDir);
      return json(res, 404, { error: "not_found" });
    } catch (err) {
      // Map a body-too-large signal to 413; everything else is a generic 400. Don't echo the
      // internal error message back to the client (it can leak paths/state).
      const status = (err as { statusCode?: number }).statusCode === 413 ? 413 : 400;
      return json(res, status, { error: status === 413 ? "payload_too_large" : "bad_request" });
    }
  }

  return {
    window,
    listen: (port: number) =>
      new Promise((resolvePromise) => httpServer.listen(port, opts.host ?? "127.0.0.1", () => resolvePromise())),
    close: () =>
      new Promise((resolvePromise) => {
        clearInterval(timer);
        clearInterval(flushTimer);
        clearInterval(pruneTimer);
        for (const ws of clients) ws.close();
        wss.close(() => httpServer.close(() => {
          flushHistory();
          store.close();
          resolvePromise();
        }));
      }),
  };
}

function readBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise((resolvePromise, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let aborted = false;
    req.on("data", (c: Buffer) => {
      if (aborted) return;
      size += c.length;
      if (size > maxBytes) {
        // Stop buffering and reject; the handler answers 413. We don't destroy the socket so
        // the response can still flush, but nothing further is retained in memory.
        aborted = true;
        reject(Object.assign(new Error("payload too large"), { statusCode: 413 }));
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (!aborted) resolvePromise(Buffer.concat(chunks));
    });
    req.on("error", reject);
  });
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(text);
}

function end(res: ServerResponse, status: number, text: string): void {
  res.writeHead(status);
  res.end(text);
}

async function serveStatic(res: ServerResponse, path: string, publicDir?: string): Promise<void> {
  if (!publicDir) return json(res, 404, { error: "not_found" });
  const root = resolve(publicDir);
  const rel = normalize(path === "/" ? "/index.html" : path).replace(/^(\.\.[/\\])+/, "");
  let file = join(root, rel);
  if (!file.startsWith(root)) return json(res, 403, { error: "forbidden" });

  try {
    const data = await readFile(file);
    res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
    res.end(data);
  } catch {
    // SPA fallback: unknown non-file route serves index.html
    try {
      const indexHtml = await readFile(join(root, "index.html"));
      res.writeHead(200, { "content-type": MIME[".html"]! });
      res.end(indexHtml);
    } catch {
      json(res, 404, { error: "not_found" });
    }
  }
}
