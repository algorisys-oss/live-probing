import { test } from "node:test";
import assert from "node:assert/strict";
import { WebSocket } from "ws";
import { createServer } from "./server.js";

const NS = 1_000_000_000;
const attr = (key: string, value: string) => ({ key, value: { stringValue: value } });
const otlp = {
  resourceSpans: [
    {
      resource: { attributes: [attr("service.name", "gateway")] },
      scopeSpans: [
        {
          spans: [
            { traceId: "trace-1", spanId: "g1", name: "POST /checkout", kind: 2, startTimeUnixNano: String(NS), endTimeUnixNano: String(NS + 50_000_000), status: { code: 0 } },
            { traceId: "trace-1", spanId: "g2", parentSpanId: "g1", name: "GET", kind: 3, startTimeUnixNano: String(NS + 5_000_000), endTimeUnixNano: String(NS + 45_000_000), attributes: [attr("server.address", "catalog")], status: { code: 0 } },
          ],
        },
      ],
    },
    {
      resource: { attributes: [attr("service.name", "catalog")] },
      scopeSpans: [
        {
          spans: [
            { traceId: "trace-1", spanId: "c1", parentSpanId: "g2", name: "GET /products", kind: 2, startTimeUnixNano: String(NS + 10_000_000), endTimeUnixNano: String(NS + 40_000_000), status: { code: 0 } },
            { traceId: "trace-1", spanId: "c2", parentSpanId: "c1", name: "pg.query:SELECT", kind: 3, startTimeUnixNano: String(NS + 15_000_000), endTimeUnixNano: String(NS + 30_000_000), attributes: [attr("db.system", "postgresql")], status: { code: 0 } },
            { traceId: "trace-1", spanId: "c3", parentSpanId: "c1", name: "get", kind: 3, startTimeUnixNano: String(NS + 31_000_000), endTimeUnixNano: String(NS + 35_000_000), attributes: [attr("db.system", "redis")], status: { code: 0 } },
          ],
        },
      ],
    },
  ],
};

test("server ingests OTLP and serves REST + websocket", async () => {
  const PORT = 4399;
  const server = createServer();
  await server.listen(PORT);
  const base = `http://localhost:${PORT}`;

  try {
    const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
    const snapshot = await new Promise<any>((res, rej) => {
      ws.once("message", (d) => res(JSON.parse(d.toString())));
      ws.once("error", rej);
    });
    assert.equal(snapshot.type, "snapshot");

    const deltaP = new Promise<any>((res) => {
      ws.on("message", (d) => {
        const m = JSON.parse(d.toString());
        if (m.type === "traces") res(m);
      });
    });

    const ingestRes = await fetch(`${base}/v1/traces`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(otlp),
    });
    assert.equal(ingestRes.status, 200);

    const delta = await deltaP;
    assert.equal(delta.traces[0].traceId, "trace-1");
    assert.equal(delta.traces[0].spanCount, 5);
    assert.deepEqual(new Set(delta.traces[0].services), new Set(["gateway", "catalog"]));

    const list = (await (await fetch(`${base}/api/traces`)).json()) as any;
    assert.equal(list.traces.length, 1);

    const det = (await (await fetch(`${base}/api/traces/trace-1`)).json()) as any;
    assert.match(det.mermaidSequence, /^sequenceDiagram/);
    assert.ok(det.sequence.messages.length >= 3, "sequence has messages");

    const topo = (await (await fetch(`${base}/api/topology`)).json()) as any;
    assert.ok(topo.topology.edges.length >= 3, "topology has edges");
    assert.match(topo.mermaidFlow, /^graph LR/);

    const missing = await fetch(`${base}/api/traces/nope`);
    assert.equal(missing.status, 404);

    ws.close();
  } finally {
    await server.close();
  }
});

test("history writes are debounced but flushed on API reads (read-your-writes)", async () => {
  const PORT = 4401;
  // A flush interval far longer than the test: only flush-on-read can make the data visible.
  const server = createServer({ historyFlushMs: 60_000 });
  await server.listen(PORT);
  const base = `http://localhost:${PORT}`;
  try {
    const res = await fetch(`${base}/v1/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        events: [
          { traceId: "d-1", spanId: "a", participant: "gw", operation: "GET /debounced", kind: "server", startTime: Date.now() * 1000, duration: 5000, status: "ok", attributes: {} },
        ],
      }),
    });
    assert.equal(res.status, 200);

    // These endpoints are served from the history store, not the live window.
    const search = (await (await fetch(`${base}/api/search?q=debounced`)).json()) as any;
    assert.equal(search.traces.length, 1);
    const days = (await (await fetch(`${base}/api/days`)).json()) as any;
    assert.equal(days.days.length, 1);
  } finally {
    await server.close();
  }
});

test("retentionDays prunes old history on startup", async (t) => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dbPath = join(mkdtempSync(join(tmpdir(), "lp-retention-")), "history.db");

  // Seed a trace from 1970 directly into the store, then reopen via the server with retention.
  const { HistoryStore } = await import("./history-store.js");
  const { TraceWindow } = await import("@liveprobe/core");
  const w = new TraceWindow();
  w.add([
    { traceId: "ancient", spanId: "s", participant: "gw", operation: "GET /old", kind: "server", startTime: 1_000_000, duration: 1000, status: "ok", attributes: {} },
  ]);
  const seedStore = new HistoryStore(dbPath);
  seedStore.upsertMany([w.assemble("ancient")!]);
  assert.equal(seedStore.days().length, 1);
  seedStore.close();

  const PORT = 4402;
  const server = createServer({ dbPath, retentionDays: 7 });
  await server.listen(PORT);
  try {
    const days = (await (await fetch(`http://localhost:${PORT}/api/days`)).json()) as any;
    assert.equal(days.days.length, 0, "1970 day pruned at startup");
  } finally {
    await server.close();
  }
  t.diagnostic(`db: ${dbPath}`);
});

test("server accepts native events at /v1/events", async () => {
  const PORT = 4400;
  const server = createServer();
  await server.listen(PORT);
  const base = `http://localhost:${PORT}`;
  try {
    const res = await fetch(`${base}/v1/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        events: [
          { traceId: "nt-1", spanId: "a", participant: "gw", operation: "GET /x", kind: "server", startTime: 1_000_000, duration: 5000, status: "ok", attributes: {} },
          { traceId: "nt-1", spanId: "b", parentSpanId: "a", participant: "billing", operation: "charge", kind: "client", startTime: 1_001_000, duration: 2000, status: "error", attributes: { "user.id": "42" } },
        ],
      }),
    });
    assert.equal(res.status, 200);
    assert.equal(((await res.json()) as { accepted: number }).accepted, 2);

    const list = (await (await fetch(`${base}/api/traces`)).json()) as any;
    assert.equal(list.traces.length, 1);
    assert.equal(list.traces[0].traceId, "nt-1");
    assert.equal(list.traces[0].hasError, true);

    const det = (await (await fetch(`${base}/api/traces/nt-1`)).json()) as any;
    assert.equal(det.spans.length, 2);
  } finally {
    await server.close();
  }
});

test("a poison event with an out-of-range timestamp cannot crash the history flush", async () => {
  const PORT = 4407;
  // Long flush interval so only the read-triggered flush exercises the writer synchronously.
  const server = createServer({ historyFlushMs: 60_000 });
  await server.listen(PORT);
  const base = `http://localhost:${PORT}`;
  try {
    const res = await fetch(`${base}/v1/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        events: [{ traceId: "poison", spanId: "poison", operation: "x", startTime: 1e30, duration: 1 }],
      }),
    });
    assert.equal(res.status, 200);
    // A GET on /api forces a synchronous flush (read-your-writes). Before the fix this threw
    // RangeError inside upsertMany and killed the process.
    assert.equal((await fetch(`${base}/api/traces`)).status, 200);
    assert.equal((await fetch(`${base}/healthz`)).status, 200, "server still alive after the poison event");
  } finally {
    await server.close();
  }
});

test("ingest scrubs PII/secrets before storage", async () => {
  const PORT = 4408;
  const server = createServer();
  await server.listen(PORT);
  const base = `http://localhost:${PORT}`;
  try {
    await fetch(`${base}/v1/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        events: [
          {
            traceId: "pii-1",
            spanId: "s",
            participant: "auth",
            operation: "POST /login",
            kind: "server",
            startTime: 1_700_000_000_000_000,
            duration: 1000,
            status: "ok",
            attributes: {
              "app.user.email": "victim@example.com",
              "enduser.credit_card": "4242 4242 4242 4242",
              "http.request.header.authorization": "Bearer abc.def.ghi",
            },
          },
        ],
      }),
    });
    const det = (await (await fetch(`${base}/api/traces/pii-1`)).json()) as any;
    const attrs = det.spans[0].attributes;
    assert.equal(attrs["app.user.email"], "[redacted]");
    assert.equal(attrs["enduser.credit_card"], "[redacted]");
    assert.equal(attrs["http.request.header.authorization"], "[redacted]");
  } finally {
    await server.close();
  }
});

test("ingest rejects an oversized body and caps gzip decompression", async () => {
  const { gzipSync } = await import("node:zlib");
  const PORT = 4409;
  const server = createServer();
  await server.listen(PORT);
  const base = `http://localhost:${PORT}`;
  try {
    const oversized = "A".repeat(12 * 1024 * 1024); // > 8 MB body cap
    const tooBig = await fetch(`${base}/v1/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ events: [{ traceId: "x", spanId: "y", operation: oversized }] }),
    });
    assert.equal(tooBig.status, 413);

    // Small compressed payload, huge decompressed — must be rejected, not expanded to memory.
    const bomb = gzipSync(Buffer.alloc(64 * 1024 * 1024, 65));
    const bombRes = await fetch(`${base}/v1/traces`, {
      method: "POST",
      headers: { "content-type": "application/json", "content-encoding": "gzip" },
      body: bomb,
    });
    assert.ok(bombRes.status >= 400, "gzip bomb rejected");
    assert.equal((await fetch(`${base}/healthz`)).status, 200, "server survives the gzip bomb");
  } finally {
    await server.close();
  }
});

test("CORS reflects loopback origins only; cross-site origins are denied", async () => {
  const PORT = 4410;
  const server = createServer();
  await server.listen(PORT);
  const base = `http://localhost:${PORT}`;
  try {
    const dev = await fetch(`${base}/api/traces`, { headers: { origin: "http://localhost:5173" } });
    assert.equal(dev.headers.get("access-control-allow-origin"), "http://localhost:5173");
    const evil = await fetch(`${base}/api/traces`, { headers: { origin: "https://evil.example" } });
    assert.equal(evil.headers.get("access-control-allow-origin"), null);
  } finally {
    await server.close();
  }
});

test("an inactive→active alert transition fires the outbound webhook exactly once", async () => {
  const PORT = 4411;
  const calls: any[] = [];
  const fetchImpl = (async (_url: string | URL, init: RequestInit = {}) => {
    calls.push(JSON.parse(String(init.body)));
    return new Response("", { status: 200 });
  }) as unknown as typeof fetch;

  const server = createServer({
    topologyIntervalMs: 20, // fire the tick quickly so the transition is observed
    alertWebhook: { url: "http://hook.test", fetchImpl, cooldownMs: 60_000 },
  });
  await server.listen(PORT);
  const base = `http://localhost:${PORT}`;

  // A service ("order") handling only failing requests → error rate 100% → an error alert.
  const nowMicros = Math.floor(Date.now() * 1000);
  const events = [0, 1, 2, 3].map((i) => ({
    traceId: `t${i}`,
    spanId: `s${i}`,
    participant: "order",
    operation: "POST /order",
    kind: "server" as const,
    startTime: nowMicros + i,
    duration: 5000,
    status: "error" as const,
    attributes: {},
  }));

  try {
    const res = await fetch(`${base}/v1/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(events),
    });
    assert.equal(res.status, 200);

    // Wait for the tick to observe the transition and the (async) delivery to land.
    const deadline = Date.now() + 2000;
    while (calls.length === 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));

    assert.equal(calls.length, 1, "webhook fired once for the new alert");
    assert.equal(calls[0].event, "alert.firing");
    assert.equal(calls[0].alert.id, "service:order:error-rate");
    assert.equal(calls[0].alert.severity, "error");

    // Subsequent ticks with the same firing alert must NOT re-fire (de-dup on transition).
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(calls.length, 1, "no re-fire while the alert stays active");
  } finally {
    await server.close();
  }
});
