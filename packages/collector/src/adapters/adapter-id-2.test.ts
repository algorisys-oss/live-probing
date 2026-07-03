import { test } from "node:test";
import assert from "node:assert/strict";
import { adapterId2 } from "./adapter-id-2.js";

const TS = "2026-05-28T10:15:00Z";
const TS_MICROS = Date.parse(TS) * 1000;

test("adapterId2 maps an instrumentation event to a synthetic root + server span", () => {
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
  const events = adapterId2(raw);
  assert.equal(events.length, 2);

  const [root, span] = events as [(typeof events)[0], (typeof events)[0]];
  // Synthetic per-request root: deterministic spanId so the window dedupes re-emissions.
  assert.equal(root.traceId, "req-123");
  assert.equal(root.spanId, "req-123");
  assert.equal(root.parentSpanId, undefined);
  assert.equal(root.participant, "client");
  assert.equal(root.kind, "client");

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

test("adapterId2 marks failed instrumentation events as errors", () => {
  const base = {
    eventId: "e1",
    eventType: "instrumentation",
    timestamp: TS,
    application: { name: "propeak", module: "invoice" },
    request: { requestId: "req-1" },
  };
  const failed = adapterId2({ ...base, payload: { endpoint: "/x", method: "GET", statusCode: 500, success: false } });
  assert.equal(failed[1]!.status, "error");
  const clientErr = adapterId2({ ...base, payload: { endpoint: "/x", method: "GET", statusCode: 404 } });
  assert.equal(clientErr[1]!.status, "error");
});

test("adapterId2 maps a log event; ERROR level -> error status", () => {
  const raw = {
    eventId: "log-1",
    eventType: "log",
    timestamp: TS,
    application: { name: "hrms", module: "employee", environment: "prod" },
    request: { requestId: "req-456" },
    payload: { level: "ERROR", message: "Failed to process payroll", file: "payroll_service.go", line: 225 },
  };
  const events = adapterId2(raw);
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

test("adapterId2 maps an audit event with before/after flattened", () => {
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
  const events = adapterId2(raw);
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

test("adapterId2 without a requestId emits a single parentless span keyed by eventId", () => {
  const events = adapterId2({
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

test("adapterId2 drops events without an eventId", () => {
  assert.equal(adapterId2({ eventType: "log" }).length, 0);
  assert.equal(adapterId2(null).length, 0);
  assert.equal(adapterId2("nope").length, 0);
});
