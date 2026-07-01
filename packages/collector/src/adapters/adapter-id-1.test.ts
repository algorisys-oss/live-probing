import { test } from "node:test";
import assert from "node:assert/strict";
import { adapterId1 } from "./adapter-id-1.js";

test("adapterId1 maps a structured event to a normalized Event", () => {
  const raw = {
    trace_id: "t1",
    span_id: "s2",
    parent_span_id: "s1",
    service_category: "orders-api",
    component: "OrdersModule",
    service: "OrderState",
    event_type: "Created",
    event_value: "42",
    correlation_id: "ORD-123",
    reference_id: "R1",
    reference_type: "OrderID",
    level: "ERROR",
    ou_id: "OU9",
    timestamp: 1_700_000_000_000, // epoch ms
    details: { exception_name: "IOException", retries: 3 },
  };
  const events = adapterId1(raw);
  assert.equal(events.length, 1);
  const e = events[0]!;
  assert.equal(e.traceId, "t1");
  assert.equal(e.spanId, "s2");
  assert.equal(e.parentSpanId, "s1");
  assert.equal(e.participant, "orders-api");
  assert.equal(e.operation, "OrderState:Created");
  assert.equal(e.status, "error"); // level ERROR
  assert.equal(e.startTime, 1_700_000_000_000 * 1000); // ms -> micros
  assert.equal(e.kind, "internal");
  assert.equal(e.attributes["correlation_id"], "ORD-123");
  assert.equal(e.attributes["details.exception_name"], "IOException");
  assert.equal(e.attributes["details.retries"], 3);
});

test("adapterId1 drops events without span identity", () => {
  assert.equal(adapterId1({ trace_id: "t" }).length, 0);
  assert.equal(adapterId1(null).length, 0);
});
