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

const DAY = 86_400_000_000; // one UTC day in micros

// A one-span trace starting at the given epoch-micros (its own window avoids horizon eviction).
function traceAt(traceId: string, startMicros: number) {
  const w = new TraceWindow({ horizonMicros: Number.MAX_SAFE_INTEGER });
  w.add([
    {
      traceId,
      spanId: `${traceId}-s`,
      participant: "gw",
      operation: "GET /x",
      kind: "server",
      startTime: startMicros,
      duration: 1000,
      status: "ok",
      attributes: {},
    },
  ]);
  return w.assemble(traceId)!;
}

test("prune drops whole days older than the retention window", () => {
  const store = new HistoryStore(":memory:");
  store.upsertMany([
    traceAt("old", 1_000_000), // 1970-01-01
    traceAt("mid", 4 * DAY + 1_000_000), // 1970-01-05
    traceAt("new", 9 * DAY + 1_000_000), // 1970-01-10
  ]);
  assert.equal(store.days().length, 3);

  // Keep the 7 most recent days including "today" (1970-01-10): cutoff is 1970-01-04.
  const now = 9 * DAY + 12 * 3_600_000_000;
  const dropped = store.prune(7, now);

  assert.equal(dropped, 1);
  assert.deepEqual(
    store.days().map((d) => d.day),
    ["1970-01-10", "1970-01-05"],
  );
  assert.equal(store.getDetail("old"), null); // detail gone with the day
  store.close();
});

test("prune with retention <= 0 is a no-op (retention disabled)", () => {
  const store = new HistoryStore(":memory:");
  store.upsertMany([traceAt("old", 1_000_000)]);
  assert.equal(store.prune(0, 9 * DAY), 0);
  assert.equal(store.prune(-1, 9 * DAY), 0);
  assert.equal(store.days().length, 1);
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

// A one-span trace with an explicit duration, for latency-bucketing tests.
function traceDur(id: string, startMicros: number, durationMicros: number) {
  const w = new TraceWindow({ horizonMicros: Number.MAX_SAFE_INTEGER });
  w.add([
    {
      traceId: id,
      spanId: `${id}-s`,
      participant: "gw",
      operation: "GET /x",
      kind: "server",
      startTime: startMicros,
      duration: durationMicros,
      status: "ok",
      attributes: {},
    },
  ]);
  return w.assemble(id)!;
}

test("endpointDistribution buckets durations into a histogram + per-minute heatmap", () => {
  const store = new HistoryStore(":memory:");
  store.upsertMany([
    traceDur("a", 1_000_000, 500), // minute 0, <1ms -> bucket 0
    traceDur("b", 2_000_000, 1_500), // minute 0, 1–2ms -> bucket 1
    traceDur("c", 3_000_000, 1_500), // minute 0, 1–2ms -> bucket 1
    traceDur("d", 61_000_000, 60_000), // minute 1, 50–100ms -> bucket 6
  ]);
  const dist = store.endpointDistribution("1970-01-01", "GET /x");

  assert.equal(dist.histogram.length, 12);
  assert.equal(dist.histogram[0], 1);
  assert.equal(dist.histogram[1], 2);
  assert.equal(dist.histogram[6], 1);
  assert.equal(dist.histogram.reduce((a, b) => a + b, 0), 4);

  // Heatmap: two minutes, each row's counts land in the right bucket column.
  assert.equal(dist.heatmap.length, 2);
  assert.equal(dist.heatmap[0]!.minute < dist.heatmap[1]!.minute, true);
  assert.equal(dist.heatmap[0]!.counts[0], 1);
  assert.equal(dist.heatmap[0]!.counts[1], 2);
  assert.equal(dist.heatmap[1]!.counts[6], 1);

  // Filtered by endpoint — a different operation has nothing.
  const other = store.endpointDistribution("1970-01-01", "GET /nope");
  assert.equal(other.histogram.reduce((a, b) => a + b, 0), 0);
  assert.equal(other.heatmap.length, 0);
  store.close();
});
