// The normalized interaction event. Every diagram LiveProbe draws is a projection of a
// stream of these, so this is the single source of truth. One event == one span.

export type SpanKind = "client" | "server" | "producer" | "consumer" | "internal";
export type SpanStatus = "ok" | "error" | "unset";

export interface Event {
  traceId: string;
  spanId: string;
  parentSpanId?: string; // absent for a trace root
  participant: string; // logical name of the side doing this span's work (the service)
  peer?: string; // the other side for client/producer/consumer spans (service or datastore)
  operation: string; // span name / method / route
  kind: SpanKind;
  startTime: number; // epoch microseconds
  duration: number; // microseconds
  status: SpanStatus;
  attributes: Record<string, string | number | boolean>;
}

// Absolute upper bound for an epoch-microsecond timestamp. Chosen so that
// `new Date(micros / 1000)` always stays inside JS's valid Date range (±8.64e15 ms):
// this value divides to ~year 2243, is a safe integer, and rejects absurd inputs
// (e.g. 1e30) that would otherwise throw `RangeError` deep in the history writer.
export const MAX_EPOCH_MICROS = 8_640_000_000_000_000;

// Allowed clock skew for an ingested start time: timestamps up to this far past "now" are
// accepted as-is; further-future values are clamped down. A far-future start time is almost
// always bogus, and left unclamped it becomes the live window's clock reference and evicts
// every genuinely-recent trace (a live-view denial of service). Kept well under any sane live
// horizon (default 5 min) so a clamped outlier can't push the window past a real trace.
export const FUTURE_SKEW_MICROS = 60_000_000; // 60 seconds

// Coerce an untrusted timestamp/duration into a finite, non-negative, in-range number of
// microseconds. Non-finite or negative becomes 0; anything above `max` (default: the hard
// Date-range bound) is clamped down. Pass a wall-clock-derived `max` for start times so a
// hostile emitter can't poison time-based logic downstream.
export function clampMicros(value: unknown, max: number = MAX_EPOCH_MICROS): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  const ceil = max < MAX_EPOCH_MICROS ? max : MAX_EPOCH_MICROS;
  return n > ceil ? ceil : n;
}

// The current ceiling for an acceptable start time (now + allowed skew), in epoch micros.
export function startTimeCeiling(): number {
  return Date.now() * 1000 + FUTURE_SKEW_MICROS;
}

// Peers that are infrastructure rather than services. Used to decide when an edge or a
// message points at a datastore node vs another service.
export const DATASTORE_SYSTEMS: ReadonlySet<string> = new Set([
  "postgresql",
  "mysql",
  "redis",
  "rabbitmq",
  "amqp",
  "kafka",
  "mongodb",
  "memcached",
  "elasticsearch",
]);
