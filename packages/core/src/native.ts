import { clampMicros, startTimeCeiling, type Event, type SpanKind, type SpanStatus } from "./event.js";

// Validate/coerce a batch of already-normalized events (the shape adapters produce and the
// server accepts at POST /v1/events). Anything missing traceId/spanId is dropped; other
// fields get safe defaults so a sloppy adapter can't poison the window.

const KINDS = new Set<SpanKind>(["client", "server", "producer", "consumer", "internal"]);
const STATUSES = new Set<SpanStatus>(["ok", "error", "unset"]);

export function coerceEvents(input: unknown): Event[] {
  const arr = Array.isArray(input)
    ? input
    : input && typeof input === "object" && Array.isArray((input as { events?: unknown }).events)
      ? (input as { events: unknown[] }).events
      : [];

  const startCeil = startTimeCeiling();
  const out: Event[] = [];
  for (const raw of arr) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    if (typeof r["traceId"] !== "string" || typeof r["spanId"] !== "string") continue;

    const kind = KINDS.has(r["kind"] as SpanKind) ? (r["kind"] as SpanKind) : "internal";
    const status = STATUSES.has(r["status"] as SpanStatus) ? (r["status"] as SpanStatus) : "unset";
    const rawAttrs = r["attributes"];
    const attributes =
      rawAttrs && typeof rawAttrs === "object" ? (rawAttrs as Record<string, string | number | boolean>) : {};

    out.push({
      traceId: r["traceId"] as string,
      spanId: r["spanId"] as string,
      parentSpanId: typeof r["parentSpanId"] === "string" && r["parentSpanId"] ? (r["parentSpanId"] as string) : undefined,
      participant: typeof r["participant"] === "string" && r["participant"] ? (r["participant"] as string) : "unknown",
      peer: typeof r["peer"] === "string" && r["peer"] ? (r["peer"] as string) : undefined,
      operation: typeof r["operation"] === "string" ? (r["operation"] as string) : "",
      kind,
      startTime: clampMicros(r["startTime"], startCeil),
      duration: clampMicros(r["duration"]),
      status,
      attributes,
    });
  }
  return out;
}
