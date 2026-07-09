import { test } from "node:test";
import assert from "node:assert/strict";
import { redMetrics } from "./red-metrics.js";
import type { AssembledTrace } from "./trace-window.js";
import type { Event } from "./event.js";

const ev = (p: Partial<Event> & { participant: string; kind: Event["kind"] }): Event => ({
  traceId: "t",
  spanId: Math.random().toString(36).slice(2),
  operation: "op",
  startTime: 0,
  duration: 1000,
  status: "ok",
  attributes: {},
  ...p,
});

const trace = (events: Event[]): AssembledTrace => ({
  traceId: events[0]?.traceId ?? "t",
  roots: [],
  events,
  start: 0,
  end: 0,
});

test("aggregates server spans per service into rate / errors / p95", () => {
  // gw handles 4 requests over a 2s window: durations 1,2,3,4 ms, one error.
  const t = trace([
    ev({ participant: "gw", kind: "server", startTime: 0, duration: 1000, status: "ok" }),
    ev({ participant: "gw", kind: "server", startTime: 500_000, duration: 2000, status: "ok" }),
    ev({ participant: "gw", kind: "server", startTime: 1_000_000, duration: 3000, status: "error" }),
    ev({ participant: "gw", kind: "server", startTime: 2_000_000 - 4000, duration: 4000, status: "ok" }),
  ]);
  const [m] = redMetrics([t]);
  assert.equal(m!.service, "gw");
  assert.equal(m!.calls, 4);
  assert.equal(m!.errors, 1);
  assert.equal(m!.errorRate, 0.25);
  // window span = 0 .. 2s -> 2s; rate = 4/2 = 2/s
  assert.equal(m!.ratePerSec, 2);
  // p95 of [1000,2000,3000,4000]: floor(4*0.95)=3 -> 4000
  assert.equal(m!.p95Micros, 4000);
});

test("ignores non-server spans (client/internal don't count as handled requests)", () => {
  const t = trace([
    ev({ participant: "gw", kind: "server", duration: 1000 }),
    ev({ participant: "gw", kind: "client", peer: "redis", duration: 9999 }), // outbound, ignored
    ev({ participant: "gw", kind: "internal", duration: 5000 }), // internal, ignored
  ]);
  const [m] = redMetrics([t]);
  assert.equal(m!.calls, 1);
  assert.equal(m!.p95Micros, 1000);
});

test("a datastore/ghost with no server span is omitted", () => {
  const t = trace([
    ev({ participant: "gw", kind: "server", duration: 1000 }),
    ev({ participant: "gw", kind: "client", peer: "postgresql", duration: 500 }),
  ]);
  const services = redMetrics([t]).map((m) => m.service);
  assert.deepEqual(services, ["gw"]); // no "postgresql" tile
});

test("sorted by call volume, most-trafficked first", () => {
  const t = trace([
    ev({ participant: "a", kind: "server" }),
    ev({ participant: "b", kind: "server" }),
    ev({ participant: "b", kind: "server" }),
    ev({ participant: "b", kind: "server" }),
  ]);
  assert.deepEqual(
    redMetrics([t]).map((m) => m.service),
    ["b", "a"],
  );
});

test("empty input yields no tiles and never divides by zero", () => {
  assert.deepEqual(redMetrics([]), []);
});
