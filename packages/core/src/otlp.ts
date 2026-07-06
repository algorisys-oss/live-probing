import type { Event, SpanKind, SpanStatus } from "./event.js";

// Minimal shapes of OTLP/HTTP JSON. We parse defensively rather than pull in the full
// protobuf schema: the collector is configured to export OTLP as JSON.
interface AnyValue {
  stringValue?: string;
  boolValue?: boolean;
  intValue?: string | number;
  doubleValue?: number;
}
interface KeyValue {
  key: string;
  value?: AnyValue;
}
interface OtlpSpan {
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  name?: string;
  kind?: number | string;
  startTimeUnixNano?: string | number;
  endTimeUnixNano?: string | number;
  attributes?: KeyValue[];
  status?: { code?: number | string };
}
interface ScopeSpans {
  spans?: OtlpSpan[];
}
interface ResourceSpans {
  resource?: { attributes?: KeyValue[] };
  scopeSpans?: ScopeSpans[];
  instrumentationLibrarySpans?: ScopeSpans[]; // older OTLP field name
}
export interface OtlpPayload {
  resourceSpans?: ResourceSpans[];
}

type Attrs = Record<string, string | number | boolean>;

function attrValue(v: AnyValue | undefined): string | number | boolean | undefined {
  if (!v) return undefined;
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.boolValue !== undefined) return v.boolValue;
  if (v.intValue !== undefined) return typeof v.intValue === "string" ? Number(v.intValue) : v.intValue;
  if (v.doubleValue !== undefined) return v.doubleValue;
  return undefined;
}

function toAttrs(attributes: KeyValue[] | undefined): Attrs {
  const out: Attrs = {};
  for (const a of attributes ?? []) {
    const val = attrValue(a.value);
    if (val !== undefined) out[a.key] = val;
  }
  return out;
}

function mapKind(kind: number | string | undefined): SpanKind {
  switch (kind) {
    case 2:
    case "2":
    case "SPAN_KIND_SERVER":
      return "server";
    case 3:
    case "3":
    case "SPAN_KIND_CLIENT":
      return "client";
    case 4:
    case "4":
    case "SPAN_KIND_PRODUCER":
      return "producer";
    case 5:
    case "5":
    case "SPAN_KIND_CONSUMER":
      return "consumer";
    default:
      return "internal";
  }
}

function mapStatus(code: number | string | undefined): SpanStatus {
  if (code === 2 || code === "2" || code === "STATUS_CODE_ERROR") return "error";
  if (code === 1 || code === "1" || code === "STATUS_CODE_OK") return "ok";
  return "unset";
}

// Nanosecond unix timestamps arrive as strings that overflow a JS number, so divide as
// BigInt before narrowing to microseconds.
function toMicros(nano: string | number | undefined): number {
  if (nano === undefined || nano === null || nano === "") return 0;
  try {
    return Number(BigInt(String(nano)) / 1000n);
  } catch {
    return 0;
  }
}

// HTTP instrumentation often names spans by bare method ("GET"), which makes a useless
// trace title. Rebuild "METHOD /path" from attributes so the UI shows the real endpoint.
// Prefer http.route (the low-cardinality template) but skip it when it's a catch-all
// wildcard — Remix/SPA apps report http.route="*", which would collapse every URL to
// "GET *"; the concrete request path (url.path/http.target) is the useful title there.
function httpName(attrs: Attrs): string | undefined {
  const method = attrs["http.request.method"] ?? attrs["http.method"];
  const route = attrs["http.route"];
  const path =
    typeof route === "string" && route !== "*" ? route : attrs["url.path"] ?? attrs["http.target"];
  if (typeof method === "string" && typeof path === "string") {
    return `${method} ${String(path).split("?")[0]}`;
  }
  return undefined;
}

// The other side of a call. A datastore/broker if the span carries one, otherwise the
// remote service/host. Only meaningful for spans that call out (client/producer/consumer).
function resolvePeer(kind: SpanKind, attrs: Attrs): string | undefined {
  if (kind === "server" || kind === "internal") return undefined;
  const db = attrs["db.system"];
  if (typeof db === "string") return db;
  const messaging = attrs["messaging.system"];
  if (typeof messaging === "string") return messaging;
  for (const key of ["peer.service", "server.address", "net.peer.name", "network.peer.address"]) {
    const v = attrs[key];
    if (typeof v === "string") return v;
  }
  const dest = attrs["messaging.destination.name"];
  if (typeof dest === "string") return dest;
  return undefined;
}

// Flatten an OTLP/HTTP JSON payload into normalized events.
export function normalizeOtlp(payload: OtlpPayload): Event[] {
  const events: Event[] = [];
  for (const rs of payload.resourceSpans ?? []) {
    const resourceAttrs = toAttrs(rs.resource?.attributes);
    const participant = String(resourceAttrs["service.name"] ?? "unknown");
    const scopes = rs.scopeSpans ?? rs.instrumentationLibrarySpans ?? [];
    for (const scope of scopes) {
      for (const span of scope.spans ?? []) {
        if (!span.traceId || !span.spanId) continue;
        const attrs = toAttrs(span.attributes);
        const kind = mapKind(span.kind);
        const start = toMicros(span.startTimeUnixNano);
        const end = toMicros(span.endTimeUnixNano);
        events.push({
          traceId: String(span.traceId),
          spanId: String(span.spanId),
          parentSpanId: span.parentSpanId ? String(span.parentSpanId) : undefined,
          participant,
          peer: resolvePeer(kind, attrs),
          operation: httpName(attrs) ?? String(span.name ?? ""),
          kind,
          startTime: start,
          duration: Math.max(0, end - start),
          status: mapStatus(span.status?.code),
          attributes: attrs,
        });
      }
    }
  }
  return events;
}
