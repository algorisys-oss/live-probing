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
