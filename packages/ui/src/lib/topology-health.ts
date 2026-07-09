import type { Topology, Edge } from "./types";

// Health level for a node or edge in the live flow graph. Drives the traffic-light
// colouring — the point of the health-coloured topology is that an operator glances at
// the live map and sees *where* it hurts, without reading every edge label.
export type Health = "ok" | "warn" | "error";

export interface HealthThresholds {
  // Error rate (errors / calls) at/above which an edge is red, then amber.
  errorRateError: number;
  errorRateWarn: number;
  // An edge is amber on latency when its average is at least this multiple of the
  // graph's median edge latency (relative, so it adapts to whatever the system's
  // normal looks like rather than a fixed millisecond guess).
  latencyWarnFactor: number;
}

export const DEFAULT_THRESHOLDS: HealthThresholds = {
  errorRateError: 0.05,
  errorRateWarn: 0.01,
  latencyWarnFactor: 2,
};

export interface TopologyHealthResult {
  // Parallel to topology.edges — edgeHealth[i] is the level for edges[i].
  edgeHealth: Health[];
  // Per-node level, keyed by node id. A node is coloured by the calls *into* it
  // (a failing/slow dependency shows on the callee, pointing at the culprit rather
  // than lighting up every caller too).
  nodeHealth: Record<string, Health>;
  // The median edge latency the latency band was measured against (µs).
  medianLatencyMicros: number;
}

const WORSE: Record<Health, number> = { ok: 0, warn: 1, error: 2 };
const worst = (a: Health, b: Health): Health => (WORSE[b] > WORSE[a] ? b : a);

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function errorRateHealth(errors: number, calls: number, t: HealthThresholds): Health {
  if (calls <= 0) return "ok";
  const rate = errors / calls;
  if (rate >= t.errorRateError) return "error";
  if (rate >= t.errorRateWarn) return "warn";
  return "ok";
}

/**
 * Classify every edge and node of a live topology into ok / warn / error.
 * Pure — a projection of the same edge counts the graph already carries
 * (calls / errors / avgDurationMicros), so no extra data has to be collected.
 */
export function topologyHealth(
  topology: Topology,
  thresholds: HealthThresholds = DEFAULT_THRESHOLDS,
): TopologyHealthResult {
  const edges = topology.edges;
  const medianLatencyMicros = median(
    edges.filter((e) => e.calls > 0).map((e) => e.avgDurationMicros),
  );
  const slowCutoff = medianLatencyMicros * thresholds.latencyWarnFactor;

  const edgeHealth = edges.map((e: Edge): Health => {
    const byError = errorRateHealth(e.errors, e.calls, thresholds);
    if (byError === "error") return "error";
    // Latency only ever raises to amber, never red (a slow call is a warning, an
    // erroring one is the failure). Ignore latency when there is no spread to compare.
    const slow = medianLatencyMicros > 0 && e.calls > 0 && e.avgDurationMicros >= slowCutoff;
    return worst(byError, slow ? "warn" : "ok");
  });

  const nodeHealth: Record<string, Health> = {};
  for (const n of topology.nodes) nodeHealth[n] = "ok";
  // Aggregate the calls into each node, then classify once — a node with a 4% error
  // rate spread over its inbound edges reads amber even if no single edge crosses.
  const inbound = new Map<string, { errors: number; calls: number; slow: boolean }>();
  edges.forEach((e, i) => {
    const acc = inbound.get(e.to) ?? { errors: 0, calls: 0, slow: false };
    acc.errors += e.errors;
    acc.calls += e.calls;
    if (edgeHealth[i] === "warn" && e.errors === 0) acc.slow = true; // latency-driven warn
    inbound.set(e.to, acc);
  });
  for (const [node, acc] of inbound) {
    const byError = errorRateHealth(acc.errors, acc.calls, thresholds);
    nodeHealth[node] = worst(byError, acc.slow ? "warn" : "ok");
  }

  return { edgeHealth, nodeHealth, medianLatencyMicros };
}
