import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { extname, join, normalize, resolve } from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import {
  TraceWindow,
  normalizeOtlp,
  toMermaidFlow,
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
}

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

  const ingest = (payload: OtlpPayload) => {
    const events = normalizeOtlp(payload);
    if (events.length === 0) return;
    window.add(events);

    const affected = [...new Set(events.map((e) => e.traceId))];
    const assembled = affected
      .map((id) => window.assemble(id))
      .filter((t): t is NonNullable<typeof t> => t !== null);
    if (assembled.length > 0) {
      broadcast({ type: "traces", traces: assembled.map(summarize) });
      store.upsertMany(assembled); // persist for the daily/history view
    }
    topologyDirty = true;
  };

  const httpServer = createHttpServer((req, res) => void handle(req, res));

  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });
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
      }),
    );
  });

  const timer = setInterval(() => {
    if (!topologyDirty) return;
    topologyDirty = false;
    const topology = window.topology();
    broadcast({ type: "topology", topology, mermaidFlow: toMermaidFlow(topology) });
  }, opts.topologyIntervalMs ?? 750);
  timer.unref();

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-headers", "content-type");
    if (req.method === "OPTIONS") return end(res, 204, "");

    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;

    try {
      if (req.method === "POST" && path === "/v1/traces") {
        const raw = await readBody(req);
        const encoding = String(req.headers["content-encoding"] ?? "");
        const text = encoding.includes("gzip") ? gunzipSync(raw).toString("utf8") : raw.toString("utf8");
        ingest(text ? (JSON.parse(text) as OtlpPayload) : {});
        return json(res, 200, {}); // OTLP success
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
      if (req.method === "GET" && path === "/api/search") {
        const q = url.searchParams;
        const errParam = q.get("error");
        const minMs = Number(q.get("minMs"));
        const limit = Number(q.get("limit"));
        const traces = store.search({
          q: q.get("q") ?? undefined,
          service: q.get("service") ?? undefined,
          error: errParam === null || errParam === "" ? undefined : errParam === "true",
          minMicros: Number.isFinite(minMs) && minMs > 0 ? minMs * 1000 : undefined,
          traceId: q.get("traceId") ?? undefined,
          limit: Number.isFinite(limit) && limit > 0 ? limit : 100,
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
      return json(res, 400, { error: "bad_request", message: String((err as Error).message) });
    }
  }

  return {
    window,
    listen: (port: number) =>
      new Promise((resolvePromise) => httpServer.listen(port, "0.0.0.0", () => resolvePromise())),
    close: () =>
      new Promise((resolvePromise) => {
        clearInterval(timer);
        for (const ws of clients) ws.close();
        wss.close(() => httpServer.close(() => {
          store.close();
          resolvePromise();
        }));
      }),
  };
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolvePromise, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolvePromise(Buffer.concat(chunks)));
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
