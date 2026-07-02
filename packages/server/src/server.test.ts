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
