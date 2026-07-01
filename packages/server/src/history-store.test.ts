import { test } from "node:test";
import assert from "node:assert/strict";
import { TraceWindow, normalizeOtlp } from "@liveprobe/core";
import { HistoryStore } from "./history-store.js";

const NS = 1_000_000_000; // 1e9 ns -> 1e6 us -> 1970-01-01
const attr = (key: string, value: string) => ({ key, value: { stringValue: value } });
const payload = {
  resourceSpans: [
    {
      resource: { attributes: [attr("service.name", "gateway")] },
      scopeSpans: [
        {
          spans: [
            { traceId: "t1", spanId: "g1", name: "POST", kind: 2, startTimeUnixNano: String(NS), endTimeUnixNano: String(NS + 10_000_000), attributes: [attr("http.method", "POST"), attr("http.target", "/api/checkout")], status: { code: 2 } },
            { traceId: "t1", spanId: "g2", parentSpanId: "g1", name: "GET", kind: 3, startTimeUnixNano: String(NS + 1_000_000), endTimeUnixNano: String(NS + 5_000_000), attributes: [attr("db.system", "postgresql")], status: { code: 0 } },
          ],
        },
      ],
    },
  ],
};

test("HistoryStore persists and aggregates by day", () => {
  const window = new TraceWindow();
  window.add(normalizeOtlp(payload));
  const trace = window.assemble("t1")!;

  const store = new HistoryStore(":memory:");
  store.upsertMany([trace]);
  store.upsertMany([trace]); // idempotent upsert (trace grows) — still one row

  const days = store.days();
  assert.equal(days.length, 1);
  assert.equal(days[0]!.day, "1970-01-01");
  assert.equal(days[0]!.requests, 1);
  assert.equal(days[0]!.errors, 1); // g1 status error

  const summary = store.daySummary("1970-01-01");
  assert.equal(summary.requests, 1);
  assert.equal(summary.errorRate, 1);
  assert.ok(summary.p95Micros > 0);
  assert.equal(summary.topEndpoints[0]!.operation, "POST /api/checkout");
  assert.equal(summary.slowest[0]!.traceId, "t1");
  assert.ok(summary.throughput.length >= 1);

  const list = store.dayTraces("1970-01-01", 10);
  assert.equal(list.length, 1);
  assert.equal(list[0]!.rootOperation, "POST /api/checkout");

  const detail = store.getDetail("t1");
  assert.ok(detail, "detail retrievable from history");
  assert.match(detail!.mermaidSequence, /sequenceDiagram/);

  store.close();
});

test("HistoryStore search filters by text, service, error, and latency", () => {
  const window = new TraceWindow();
  window.add(normalizeOtlp(payload));
  const store = new HistoryStore(":memory:");
  store.upsertMany([window.assemble("t1")!]);

  assert.equal(store.search({ q: "checkout" }).length, 1);
  assert.equal(store.search({ q: "nonexistent" }).length, 0);
  assert.equal(store.search({ service: "gateway" }).length, 1);
  assert.equal(store.search({ service: "catalog" }).length, 0);
  assert.equal(store.search({ error: true }).length, 1); // g1 errored
  assert.equal(store.search({ error: false }).length, 0);
  assert.equal(store.search({ minMicros: 5_000 }).length, 1); // 10ms trace
  assert.equal(store.search({ minMicros: 50_000 }).length, 0);
  assert.equal(store.search({ maxMicros: 5_000 }).length, 0); // 10ms > 5ms ceiling
  assert.equal(store.search({ maxMicros: 20_000 }).length, 1);
  assert.equal(store.search({ minSpans: 2 }).length, 1); // trace has 2 spans
  assert.equal(store.search({ minSpans: 3 }).length, 0);
  assert.equal(store.search({ sort: "slowest" }).length, 1);
  assert.equal(store.search({ traceId: "t1" }).length, 1);
  // attribute search (fixture spans carry db.system=postgresql, http.target=/api/checkout)
  assert.equal(store.search({ attr: "db.system=postgresql" }).length, 1);
  assert.equal(store.search({ attr: "postgresql" }).length, 1);
  assert.equal(store.search({ attr: "db.system=redis" }).length, 0);
  store.close();
});
