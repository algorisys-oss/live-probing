import type { Event, SpanKind, SpanStatus } from "@liveprobe/core";

// Adapter for the internal instrumentation-service format (algo-instrumentation): three event
// types — instrumentation / log / audit — each a standalone JSON document carrying
// application { name, module, environment } and request { requestId }, but no span ids.
//
// Structure is synthesized so sequence diagrams render:
// - traceId = request.requestId (all three event types of one request share a trace)
// - a synthetic "client" root span with spanId = requestId anchors the request; every
//   event re-emits it and the trace window dedupes by spanId, so arrival order and
//   missing siblings don't matter
// - each event becomes a child span whose participant is `application.module` — the
//   application and module names ARE the sequence-diagram lifelines
// The format carries no causality between events, so all arrows originate at the
// synthetic client lifeline; cross-module call nesting is not reconstructable from it.
// Spec + mapping notes: adapters-hidden/algo-instrumentation.md.

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
  const requestId = str(obj(r["request"])["requestId"]);
  const eventType = str(r["eventType"]);

  const traceId = requestId || eventId;
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
    spanId: eventId,
    parentSpanId: requestId || undefined,
    participant,
    operation,
    kind,
    startTime,
    duration,
    status,
    attributes,
  };
  if (!requestId) return [span];

  const root: Event = {
    traceId,
    spanId: requestId, // deterministic: every event of the request re-emits it, the window dedupes
    participant: "client",
    operation: requestId,
    kind: "client",
    startTime,
    duration: 0,
    status: "unset",
    attributes: {},
  };
  return [root, span];
}
