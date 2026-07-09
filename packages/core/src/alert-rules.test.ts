import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateAlerts, DEFAULT_ALERT_THRESHOLDS } from "./alert-rules.js";
import type { RedMetric } from "./red-metrics.js";
import type { Edge } from "./trace-window.js";

const svc = (service: string, errorRate: number, calls = 100): RedMetric => ({
  service,
  ratePerSec: 1,
  errorRate,
  p95Micros: 1000,
  calls,
  errors: Math.round(errorRate * calls),
});

const edge = (from: string, to: string, calls: number, avgDurationMicros: number): Edge => ({
  from,
  to,
  calls,
  errors: 0,
  avgDurationMicros,
});

test("service error rate: fires error >=5%, warn >=1%, nothing below", () => {
  const alerts = evaluateAlerts({
    services: [svc("order", 0.08), svc("cart", 0.02), svc("auth", 0.0)],
    edges: [],
  });
  const byTarget = Object.fromEntries(alerts.map((a) => [a.target, a.severity]));
  assert.equal(byTarget["order"], "error");
  assert.equal(byTarget["cart"], "warn");
  assert.equal("auth" in byTarget, false);
  assert.equal(alerts.every((a) => a.metric === "error-rate" && a.kind === "service"), true);
});

test("edge latency: fires warn when avg >= 2x median edge latency", () => {
  const alerts = evaluateAlerts({
    services: [],
    // medians of [1000,1000,1000,5000] = 1000 -> cutoff 2000
    edges: [
      edge("a", "b", 100, 1000),
      edge("a", "c", 100, 1000),
      edge("a", "d", 100, 1000),
      edge("gw", "slow", 100, 5000),
    ],
  });
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0]!.target, "gw→slow");
  assert.equal(alerts[0]!.metric, "latency");
  assert.equal(alerts[0]!.severity, "warn");
  assert.equal(alerts[0]!.threshold, 2000);
});

test("alert ids are stable per target+metric (so they de-dupe across ticks)", () => {
  const a1 = evaluateAlerts({ services: [svc("order", 0.08)], edges: [] });
  const a2 = evaluateAlerts({ services: [svc("order", 0.09)], edges: [] });
  assert.equal(a1[0]!.id, a2[0]!.id); // same id despite a different value
  assert.equal(a1[0]!.id, "service:order:error-rate");
});

test("no median comparison when there's no latency spread", () => {
  // single edge -> median exists but nothing is >= 2x itself unless it is exactly... 1000<2000
  const alerts = evaluateAlerts({ services: [], edges: [edge("a", "b", 100, 1000)] });
  assert.equal(alerts.length, 0);
});

test("empty input yields no alerts", () => {
  assert.deepEqual(evaluateAlerts({ services: [], edges: [] }), []);
});

test("thresholds are overridable", () => {
  const strict = { ...DEFAULT_ALERT_THRESHOLDS, errorRateError: 0.02 };
  assert.equal(evaluateAlerts({ services: [svc("x", 0.03)], edges: [] }, strict)[0]!.severity, "error");
  assert.equal(evaluateAlerts({ services: [svc("x", 0.03)], edges: [] })[0]!.severity, "warn");
});
