// Fixed logarithmic-ish latency buckets, shared by the distribution histogram and the
// time×latency heatmap. Durations span orders of magnitude, so linear buckets are useless —
// these boundaries (in microseconds) give even visual weight from sub-ms to multi-second.
export const LATENCY_EDGES_MICROS = [
  1_000, 2_000, 5_000, 10_000, 25_000, 50_000, 100_000, 250_000, 500_000, 1_000_000, 2_500_000,
] as const;

// One more bucket than edges: everything below the first edge, the ranges between edges, and
// everything at/above the last edge.
export const NUM_LATENCY_BUCKETS = LATENCY_EDGES_MICROS.length + 1; // 12

export const LATENCY_BUCKET_LABELS = [
  "<1ms",
  "1–2ms",
  "2–5ms",
  "5–10ms",
  "10–25ms",
  "25–50ms",
  "50–100ms",
  "100–250ms",
  "250–500ms",
  "0.5–1s",
  "1–2.5s",
  "≥2.5s",
] as const;

/** Bucket index (0 .. NUM_LATENCY_BUCKETS-1) for a duration in microseconds. */
export function latencyBucketIndex(micros: number): number {
  const d = Number.isFinite(micros) ? micros : 0;
  for (let i = 0; i < LATENCY_EDGES_MICROS.length; i++) {
    if (d < LATENCY_EDGES_MICROS[i]!) return i;
  }
  return LATENCY_EDGES_MICROS.length; // the last, open-ended bucket
}
