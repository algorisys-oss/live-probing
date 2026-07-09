import type { Edge } from "./trace-window.js";
import type { RedMetric } from "./red-metrics.js";

// A firing condition derived from the live window. Deliberately split by concern so alerts point
// at a culprit, not a symptom cloud: error-rate alerts fire on the *service* handling the failing
// requests; latency alerts fire on the *edge* (the specific slow call). `since` is stamped by the
// caller (the server), not here — evaluation stays pure and time-independent.
export interface Alert {
  id: string; // stable key across ticks, so the same condition de-dupes and keeps its `since`
  kind: "service" | "edge";
  target: string; // "order" or "gateway→order"
  metric: "error-rate" | "latency";
  severity: "warn" | "error";
  value: number; // observed (error rate 0..1, or latency µs)
  threshold: number; // the boundary it crossed
  message: string;
}

export interface AlertThresholds {
  errorRateError: number;
  errorRateWarn: number;
  latencyWarnFactor: number; // edge latency ≥ factor × median edge latency
}

export const DEFAULT_ALERT_THRESHOLDS: AlertThresholds = {
  errorRateError: 0.05,
  errorRateWarn: 0.01,
  latencyWarnFactor: 2,
};

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

const ms = (micros: number) => (micros >= 1000 ? `${Math.round(micros / 1000)}ms` : `${Math.round(micros)}µs`);
const pct = (r: number) => `${(r * 100).toFixed(r >= 0.1 ? 0 : 1)}%`;

/**
 * Evaluate active alerts from a snapshot of the live window. Pure and order-independent — the
 * server calls it each topology tick, then reconciles the result with the previously-firing set
 * to stamp `since` and detect transitions. Same thresholds as the topology health colouring, so
 * the graph, the RED tiles, and the alerts all agree on what "red" means.
 */
export function evaluateAlerts(
  input: { services: RedMetric[]; edges: Edge[] },
  t: AlertThresholds = DEFAULT_ALERT_THRESHOLDS,
): Alert[] {
  const alerts: Alert[] = [];

  for (const s of input.services) {
    const sev: "error" | "warn" | null =
      s.errorRate >= t.errorRateError ? "error" : s.errorRate >= t.errorRateWarn ? "warn" : null;
    if (sev) {
      alerts.push({
        id: `service:${s.service}:error-rate`,
        kind: "service",
        target: s.service,
        metric: "error-rate",
        severity: sev,
        value: s.errorRate,
        threshold: sev === "error" ? t.errorRateError : t.errorRateWarn,
        message: `${s.service} error rate ${pct(s.errorRate)} (${s.errors}/${s.calls})`,
      });
    }
  }

  const med = median(input.edges.filter((e) => e.calls > 0).map((e) => e.avgDurationMicros));
  if (med > 0) {
    const cutoff = med * t.latencyWarnFactor;
    for (const e of input.edges) {
      if (e.calls > 0 && e.avgDurationMicros >= cutoff) {
        alerts.push({
          id: `edge:${e.from}->${e.to}:latency`,
          kind: "edge",
          target: `${e.from}→${e.to}`,
          metric: "latency",
          severity: "warn",
          value: e.avgDurationMicros,
          threshold: cutoff,
          message: `${e.from}→${e.to} avg ${ms(e.avgDurationMicros)} ≥ ${ms(cutoff)} (2× median)`,
        });
      }
    }
  }

  return alerts;
}
