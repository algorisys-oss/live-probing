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
