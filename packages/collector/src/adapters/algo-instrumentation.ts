import type { Event, SpanKind, SpanStatus } from "@liveprobe/core";

// Adapter for the internal instrumentation-service format (algo-instrumentation): three event
// types — instrumentation / log / audit — each a JSON document carrying
// application { name, module, environment } and request { requestId }.
//
// HRMS now also emits real trace structure (optional, back-compat preserved):
// - request.traceId / request.spanId — genuine identity; preferred over the old synthesis.
// - payload-level spans[] — child operations (db / function / http …) parented to
//   request.spanId, so a request draws its real internal fan-out (e.g. dashboard → database).
//
// Mapping:
// - traceId   = request.traceId ?? request.requestId ?? eventId
// - the event's own span uses request.spanId (so children attach); a synthetic "client"
//   root (spanId = requestId) still anchors the entry arrow when a requestId is present.
// - participant = application.name.module — the app+module ARE the sequence lifelines.
// - each spans[] child → an Event: kind "db" → client with peer "database" (draws a db
//   lifeline + topology edge), "function" → internal, others mapped in CHILD_KIND.
// When traceId/spans are absent (older emitters) the adapter falls back to synthesizing a
// trace from requestId, exactly as before.
// Spec + mapping notes: docs/adapters/algo-instrumentation.md.

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

// Timestamps are ISO-8601 strings; epoch micros out.
function toMicros(v: unknown): number {
  if (typeof v === "string") {
    const parsed = Date.parse(v);
    if (Number.isFinite(parsed)) return parsed * 1000;
  }
  return 0;
}

const ERROR_LEVELS = new Set(["ERROR", "FATAL", "CRITICAL"]);

// How a child span's `kind` maps to LiveProbe. Client kinds carry a `peer` so they draw
// as an arrow to a dedicated lifeline (and a topology edge); function/internal stay put.
const CHILD_KIND: Record<string, { kind: SpanKind; peer?: string }> = {
  db: { kind: "client", peer: "database" },
  redis: { kind: "client", peer: "redis" },
  cache: { kind: "client", peer: "cache" },
  http: { kind: "client" },
  function: { kind: "internal" },
};

// Map one HRMS spans[] entry (a real child operation) to a normalized Event. Returns null
// if it lacks a spanId. traceId/participant default from the parent event.
function childSpan(raw: unknown, traceId: string, participant: string): Event | null {
  const s = obj(raw);
  const spanId = str(s["spanId"]);
  if (!spanId) return null;
  const kindName = str(s["kind"]).toLowerCase();
  const mapped = CHILD_KIND[kindName] ?? { kind: "internal" as SpanKind };
  const start = toMicros(s["startTime"]);
  const durationMs = Number(s["durationMs"]);
  const duration =
    Number.isFinite(durationMs) && durationMs > 0
      ? Math.round(durationMs * 1000)
      : Math.max(0, toMicros(s["endTime"]) - start);
  const success = s["success"];

  const attributes: Record<string, string | number | boolean> = {};
  if (kindName) attributes["spanKind"] = kindName;
  if (Number.isFinite(durationMs)) attributes["durationMs"] = durationMs;
  if (typeof success === "boolean") attributes["success"] = success;

  const event: Event = {
    traceId: str(s["traceId"]) || traceId,
    spanId,
    parentSpanId: str(s["parentSpanId"]) || undefined,
    participant,
    operation: str(s["name"]) || kindName || "span",
    kind: mapped.kind,
    startTime: start,
    duration,
    status: success === false ? "error" : success === true ? "ok" : "unset",
    attributes,
  };
  if (mapped.peer) event.peer = mapped.peer;
  return event;
}

export function algoInstrumentation(raw: unknown): Event[] {
  if (!raw || typeof raw !== "object") return [];
  const r = raw as Record<string, unknown>;

  // Batch envelope: emitters POST { events: [ ... ] }. Flatten each through the adapter;
  // a single event never carries an `events` array, so this is unambiguous.
  const batch = r["events"];
  if (Array.isArray(batch)) return batch.flatMap((e) => algoInstrumentation(e));

  const eventId = str(r["eventId"]);
  if (!eventId) return []; // need span identity to place it anywhere

  const application = obj(r["application"]);
  const payload = obj(r["payload"]);
  const request = obj(r["request"]);
  const requestId = str(request["requestId"]);
  const reqSpanId = str(request["spanId"]);
  const eventType = str(r["eventType"]);

  // Prefer the real trace identity HRMS now emits; fall back to the old synthesis.
  const traceId = str(request["traceId"]) || requestId || eventId;
  const appName = str(application["name"]) || "unknown";
  const module = str(application["module"]);
  const participant = module ? `${appName}.${module}` : appName;
  const startTime = toMicros(r["timestamp"]);

  const attributes: Record<string, string | number | boolean> = {};
  const add = (k: string, v: unknown) => {
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") attributes[k] = v;
  };
  add("application", application["name"]);
  add("module", application["module"]);
  add("service", application["service"]);
  add("version", application["version"]);
  add("environment", application["environment"]);
  add("eventType", eventType);
  add("severity", r["severity"]);
  add("message", r["message"]);
  for (const [k, v] of Object.entries(obj(r["tags"]))) add(`tags.${k}`, v);

  let operation = eventType || "event";
  let kind: SpanKind = "internal";
  let status: SpanStatus = "unset";
  let duration = 0;

  if (eventType === "instrumentation") {
    kind = "server"; // the app handled an inbound request (OTel: server side of the call)
    const method = str(payload["method"]);
    const endpoint = str(payload["endpoint"]);
    operation = [method, endpoint].filter(Boolean).join(" ") || operation;
    const durationMs = Number(payload["durationMs"]);
    if (Number.isFinite(durationMs) && durationMs > 0) duration = Math.round(durationMs * 1000);
    // Status code arrives as statusCode (spec) or status_code (real HRMS payload).
    const statusCode = Number(payload["statusCode"] ?? payload["status_code"]);
    if (payload["success"] === false || (Number.isFinite(statusCode) && statusCode >= 400)) status = "error";
    else if (payload["success"] === true || (Number.isFinite(statusCode) && statusCode > 0)) status = "ok";
    for (const k of ["endpoint", "method", "statusCode", "status_code", "durationMs", "success", "memory_usage_mb"])
      add(k, payload[k]);
  } else if (eventType === "log") {
    const level = str(payload["level"]).toUpperCase();
    const message = str(payload["message"]);
    operation = ["log", level ? `${level}:` : "", message].filter(Boolean).join(" ");
    if (ERROR_LEVELS.has(level)) status = "error";
    for (const k of ["level", "message", "file", "line"]) add(k, payload[k]);
  } else if (eventType === "audit") {
    operation = ["audit", str(payload["action"]), str(payload["entityType"]), str(payload["entityId"])]
      .filter(Boolean)
      .join(" ");
    for (const k of ["entityType", "entityId", "action", "reason", "createdBy", "userId"]) add(k, payload[k]);
    const changed = payload["changedFields"];
    if (Array.isArray(changed)) attributes["changedFields"] = changed.map(str).filter(Boolean).join(",");
    for (const side of ["before", "after"] as const) {
      for (const [k, v] of Object.entries(obj(payload[side]))) add(`${side}.${k}`, v);
    }
  } else {
    // Unknown event types still render: keep primitive payload fields as attributes.
    for (const [k, v] of Object.entries(payload)) add(k, v);
  }

  const span: Event = {
    traceId,
    // Use the real request.spanId when present so HRMS's spans[] children attach to it;
    // fall back to eventId for older emitters that carry no span identity.
    spanId: reqSpanId || eventId,
    parentSpanId: requestId || undefined,
    participant,
    operation,
    kind,
    startTime,
    duration,
    status,
    attributes,
  };

  // Real child operations (db / function / http …), parented to request.spanId.
  const children: Event[] = [];
  if (eventType === "instrumentation" && Array.isArray(r["spans"])) {
    for (const raw of r["spans"] as unknown[]) {
      const child = childSpan(raw, traceId, participant);
      if (child) children.push(child);
    }
  }

  if (!requestId) return [span, ...children];

  const root: Event = {
    traceId,
    spanId: requestId, // deterministic: every event of the request re-emits it, the window dedupes
    participant: "client",
    // Title the trace by the child operation (the endpoint, e.g. "GET /roles") rather than the
    // opaque requestId — that's what the trace feed shows.
    operation,
    kind: "client",
    startTime,
    duration: 0,
    status: "unset",
    attributes: {},
  };
  return [root, span, ...children];
}
