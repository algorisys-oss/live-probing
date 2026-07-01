import type { Event, SpanKind, SpanStatus } from "@liveprobe/core";

// Reference adapter for a structured instrumentation event format that already carries
// distributed-tracing ids (trace_id / span_id / parent_span_id) alongside service/event
// fields. One client event maps to one span (Event). Field mapping and assumptions are
// documented in docs/integration-adapters.md — tune per client.

function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

// Timestamps: a number is treated as epoch milliseconds; a string is parsed as ms or ISO.
function toMicros(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return Math.round(v * 1000);
  if (typeof v === "string" && v.trim() !== "") {
    const asNum = Number(v);
    if (Number.isFinite(asNum)) return Math.round(asNum * 1000);
    const parsed = Date.parse(v);
    if (Number.isFinite(parsed)) return parsed * 1000;
  }
  return 0;
}

export function adapterId1(raw: unknown): Event[] {
  if (!raw || typeof raw !== "object") return [];
  const r = raw as Record<string, unknown>;

  const traceId = str(r["trace_id"]);
  const spanId = str(r["span_id"]);
  if (!traceId || !spanId) return []; // need span identity to place it in a trace

  const service = str(r["service"]);
  const eventType = str(r["event_type"]);
  const participant = str(r["service_category"]) || str(r["component"]) || service || "unknown";
  const operation = service && eventType ? `${service}:${eventType}` : str(r["span_name"]) || service || eventType || "event";

  const level = str(r["level"]).toUpperCase();
  const status: SpanStatus = level === "ERROR" || level === "CRITICAL" ? "error" : "unset";

  const attributes: Record<string, string | number | boolean> = {};
  const add = (k: string, v: unknown) => {
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") attributes[k] = v;
  };
  for (const k of ["event_value", "correlation_id", "reference_id", "reference_type", "ou_id", "event_source", "level"]) {
    add(k, r[k]);
  }
  if (r["details"] && typeof r["details"] === "object") {
    for (const [k, v] of Object.entries(r["details"] as Record<string, unknown>)) add(`details.${k}`, v);
  }

  return [
    {
      traceId,
      spanId,
      parentSpanId: str(r["parent_span_id"]) || undefined,
      participant,
      operation,
      kind: "internal" as SpanKind, // this format has no span kind; topology still works via parent/child
      startTime: toMicros(r["span_start_timestamp"] ?? r["timestamp"]),
      duration: 0, // format is event-centric; no per-span duration (documented gap)
      status,
      attributes,
    },
  ];
}
