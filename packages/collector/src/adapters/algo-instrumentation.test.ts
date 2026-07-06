import { test } from "node:test";
import assert from "node:assert/strict";
import { algoInstrumentation } from "./algo-instrumentation.js";

const TS = "2026-05-28T10:15:00Z";
const TS_MICROS = Date.parse(TS) * 1000;

test("algoInstrumentation maps an instrumentation event to a synthetic root + server span", () => {
  const raw = {
    eventId: "550e8400-e29b-41d4-a716-446655440000",
    eventType: "instrumentation",
    timestamp: TS,
    application: { name: "propeak", module: "invoice", environment: "prod" },
    request: { requestId: "req-123" },
    payload: {
      endpoint: "/api/payroll/process",
      method: "POST",
      statusCode: 200,
      durationMs: 135,
      success: true,
    },
  };
  const events = algoInstrumentation(raw);
  assert.equal(events.length, 2);

  const [root, span] = events as [(typeof events)[0], (typeof events)[0]];
  // Synthetic per-request root: deterministic spanId so the window dedupes re-emissions.
  assert.equal(root.traceId, "req-123");
  assert.equal(root.spanId, "req-123");
  assert.equal(root.parentSpanId, undefined);
  assert.equal(root.participant, "client");
  assert.equal(root.kind, "client");
  // Root title = the child operation (the endpoint), so the trace feed reads
  // "POST /api/payroll/process", not the opaque requestId.
  assert.equal(root.operation, "POST /api/payroll/process");

  assert.equal(span.traceId, "req-123");
  assert.equal(span.spanId, "550e8400-e29b-41d4-a716-446655440000");
  assert.equal(span.parentSpanId, "req-123");
  assert.equal(span.participant, "propeak.invoice"); // application + module on the lifeline
  assert.equal(span.operation, "POST /api/payroll/process");
  assert.equal(span.kind, "server");
  assert.equal(span.startTime, TS_MICROS);
  assert.equal(span.duration, 135_000); // durationMs -> micros
  assert.equal(span.status, "ok");
  assert.equal(span.attributes["application"], "propeak");
  assert.equal(span.attributes["module"], "invoice");
  assert.equal(span.attributes["environment"], "prod");
  assert.equal(span.attributes["statusCode"], 200);
});

test("algoInstrumentation marks failed instrumentation events as errors", () => {
  const base = {
    eventId: "e1",
    eventType: "instrumentation",
    timestamp: TS,
    application: { name: "propeak", module: "invoice" },
    request: { requestId: "req-1" },
  };
  const failed = algoInstrumentation({ ...base, payload: { endpoint: "/x", method: "GET", statusCode: 500, success: false } });
  assert.equal(failed[1]!.status, "error");
  const clientErr = algoInstrumentation({ ...base, payload: { endpoint: "/x", method: "GET", statusCode: 404 } });
  assert.equal(clientErr[1]!.status, "error");
});

test("algoInstrumentation maps a log event; ERROR level -> error status", () => {
  const raw = {
    eventId: "log-1",
    eventType: "log",
    timestamp: TS,
    application: { name: "hrms", module: "employee", environment: "prod" },
    request: { requestId: "req-456" },
    payload: { level: "ERROR", message: "Failed to process payroll", file: "payroll_service.go", line: 225 },
  };
  const events = algoInstrumentation(raw);
  assert.equal(events.length, 2);
  const span = events[1]!;
  assert.equal(span.participant, "hrms.employee");
  assert.equal(span.parentSpanId, "req-456");
  assert.equal(span.operation, "log ERROR: Failed to process payroll");
  assert.equal(span.kind, "internal");
  assert.equal(span.status, "error");
  assert.equal(span.attributes["file"], "payroll_service.go");
  assert.equal(span.attributes["line"], 225);
});

test("algoInstrumentation maps an audit event with before/after flattened", () => {
  const raw = {
    eventId: "aud-1",
    eventType: "audit",
    timestamp: TS,
    application: { name: "hrms", module: "employee", environment: "prod" },
    request: { requestId: "req-789" },
    payload: {
      entityType: "employee",
      entityId: "EMP100",
      action: "UPDATE",
      before: { salary: 50000 },
      after: { salary: 70000 },
      changedFields: ["salary"],
      reason: "Annual appraisal",
      createdBy: "admin",
      userId: "U100",
      timestamp: TS,
    },
  };
  const events = algoInstrumentation(raw);
  const span = events[1]!;
  assert.equal(span.operation, "audit UPDATE employee EMP100");
  assert.equal(span.kind, "internal");
  assert.equal(span.status, "unset");
  assert.equal(span.attributes["changedFields"], "salary");
  assert.equal(span.attributes["before.salary"], 50000);
  assert.equal(span.attributes["after.salary"], 70000);
  assert.equal(span.attributes["createdBy"], "admin");
  assert.equal(span.attributes["reason"], "Annual appraisal");
});

test("algoInstrumentation without a requestId emits a single parentless span keyed by eventId", () => {
  const events = algoInstrumentation({
    eventId: "solo-1",
    eventType: "log",
    timestamp: TS,
    application: { name: "hrms", module: "employee" },
    payload: { level: "INFO", message: "started" },
  });
  assert.equal(events.length, 1);
  assert.equal(events[0]!.traceId, "solo-1");
  assert.equal(events[0]!.parentSpanId, undefined);
});

test("algoInstrumentation drops events without an eventId", () => {
  assert.equal(algoInstrumentation({ eventType: "log" }).length, 0);
  assert.equal(algoInstrumentation(null).length, 0);
  assert.equal(algoInstrumentation("nope").length, 0);
});

test("algoInstrumentation unwraps a { events: [...] } batch envelope", () => {
  const envelope = {
    events: [
      {
        eventId: "b1",
        eventType: "instrumentation",
        timestamp: TS,
        application: { name: "hrms", module: "roles" },
        request: { requestId: "rq-1" },
        payload: { endpoint: "/roles", method: "GET", status_code: 200, durationMs: 58, success: true },
      },
      {
        eventId: "b2",
        eventType: "instrumentation",
        timestamp: TS,
        application: { name: "hrms", module: "company" },
        request: { requestId: "rq-2" },
        payload: { endpoint: "/company", method: "GET", status_code: 200, durationMs: 129, success: true },
      },
    ],
  };
  const events = algoInstrumentation(envelope);
  // two events -> two synthetic roots + two child spans
  assert.equal(events.length, 4);
  assert.deepEqual(
    events.map((e) => e.participant).sort(),
    ["client", "client", "hrms.company", "hrms.roles"],
  );
});

test("algoInstrumentation reads snake_case status_code for status", () => {
  const base = {
    eventId: "s1",
    eventType: "instrumentation",
    timestamp: TS,
    application: { name: "hrms", module: "roles" },
    request: { requestId: "rq-1" },
  };
  const ok = algoInstrumentation({ ...base, payload: { endpoint: "/x", method: "GET", status_code: 200, success: true } });
  assert.equal(ok[1]!.status, "ok");
  assert.equal(ok[1]!.attributes["status_code"], 200);
  // A 5xx with no explicit success flag must still be an error.
  const err = algoInstrumentation({ ...base, payload: { endpoint: "/x", method: "GET", status_code: 500 } });
  assert.equal(err[1]!.status, "error");
});

test("algoInstrumentation captures service, version, severity, message, tags, memory", () => {
  const raw = {
    eventId: "x1",
    eventType: "instrumentation",
    timestamp: TS,
    application: { name: "hrms", module: "roles", service: "frontend", environment: "dev", version: "0.0.0" },
    request: { requestId: "rq-1" },
    severity: "INFO",
    message: "Web access",
    tags: { route_type: "loader" },
    payload: { endpoint: "/roles", method: "GET", status_code: 200, durationMs: 58, success: true, memory_usage_mb: 407.52 },
  };
  const span = algoInstrumentation(raw)[1]!;
  assert.equal(span.attributes["service"], "frontend");
  assert.equal(span.attributes["version"], "0.0.0");
  assert.equal(span.attributes["severity"], "INFO");
  assert.equal(span.attributes["message"], "Web access");
  assert.equal(span.attributes["tags.route_type"], "loader");
  assert.equal(span.attributes["memory_usage_mb"], 407.52);
});

test("adapterId2 prefers real request.traceId/spanId and unpacks spans[] children", () => {
  const raw = {
    eventId: "evt-1",
    eventType: "instrumentation",
    timestamp: TS,
    application: { name: "hrms", module: "dashboard" },
    request: { requestId: "rq-1", traceId: "trace-abc", spanId: "req-span-1" },
    payload: { endpoint: "/dashboard", method: "GET", status_code: 200, durationMs: 129, success: true },
    spans: [
      {
        spanId: "s-auth",
        parentSpanId: "req-span-1",
        traceId: "trace-abc",
        kind: "function",
        name: "authenticate",
        startTime: TS,
        endTime: "2026-05-28T10:15:00.002Z",
        durationMs: 1.93,
        success: true,
      },
      {
        spanId: "s-perm",
        parentSpanId: "req-span-1",
        traceId: "trace-abc",
        kind: "db",
        name: "fetchPermissions",
        startTime: TS,
        endTime: "2026-05-28T10:15:00.005Z",
        durationMs: 5.39,
        success: true,
      },
    ],
  };
  const events = algoInstrumentation(raw);
  // synthetic client root + the request span + 2 children
  assert.equal(events.length, 4);
  type E = (typeof events)[0];
  const [root, reqSpan, auth, perm] = events as [E, E, E, E];

  // Real identity wins: trace = request.traceId, event span uses request.spanId.
  assert.equal(reqSpan.traceId, "trace-abc");
  assert.equal(reqSpan.spanId, "req-span-1");
  assert.equal(reqSpan.parentSpanId, "rq-1"); // under the synthetic client root
  assert.equal(root.spanId, "rq-1");

  // function child → internal, on the module lifeline, parented to the request span.
  assert.equal(auth.spanId, "s-auth");
  assert.equal(auth.parentSpanId, "req-span-1");
  assert.equal(auth.participant, "hrms.dashboard");
  assert.equal(auth.operation, "authenticate");
  assert.equal(auth.kind, "internal");
  assert.equal(auth.peer, undefined);
  assert.equal(auth.duration, 1930); // 1.93ms -> micros

  // db child → client with a "database" peer (draws the db lifeline + edge).
  assert.equal(perm.operation, "fetchPermissions");
  assert.equal(perm.kind, "client");
  assert.equal(perm.peer, "database");
  assert.equal(perm.status, "ok");
  assert.equal(perm.attributes["spanKind"], "db");
});

test("adapterId2 stays backward-compatible when traceId/spans are absent", () => {
  const events = algoInstrumentation({
    eventId: "old-1",
    eventType: "instrumentation",
    timestamp: TS,
    application: { name: "hrms", module: "roles" },
    request: { requestId: "rq-9" }, // no traceId/spanId, no spans[]
    payload: { endpoint: "/roles", method: "GET", status_code: 200, success: true },
  });
  assert.equal(events.length, 2); // root + span, as before
  assert.equal(events[1]!.traceId, "rq-9"); // falls back to requestId
  assert.equal(events[1]!.spanId, "old-1"); // falls back to eventId
});
