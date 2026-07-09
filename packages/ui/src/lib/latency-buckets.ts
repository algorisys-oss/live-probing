// Presentational mirror of @liveprobe/core's LATENCY_BUCKET_LABELS. The UI package is
// decoupled from core and mirrors its shapes (same pattern as sequence-layout); the server
// buckets the data with the core edges, the charts just need the labels. Keep in sync.
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
