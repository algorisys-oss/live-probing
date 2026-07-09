import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregateFlamegraph, type FlameSpan, type FlameNode } from "./flamegraph.js";

const s = (spanId: string, parentSpanId: string | undefined, participant: string, operation: string, duration: number): FlameSpan => ({
  spanId,
  parentSpanId,
  participant,
  operation,
  duration,
});

const child = (n: FlameNode, participant: string, operation: string): FlameNode =>
  n.children.find((c) => c.participant === participant && c.operation === operation)!;

test("aggregates two traces of one endpoint, merging by operation path", () => {
  // Each trace: gw GET /x -> db query. Two traces.
  const t1 = [s("a", undefined, "gw", "GET /x", 100), s("b", "a", "gw", "query", 40)];
  const t2 = [s("a", undefined, "gw", "GET /x", 120), s("b", "a", "gw", "query", 60)];
  const root = aggregateFlamegraph([t1, t2]);

  assert.equal(root.children.length, 1); // one endpoint
  const ep = root.children[0]!;
  assert.equal(ep.operation, "GET /x");
  assert.equal(ep.totalMicros, 220); // 100 + 120
  assert.equal(ep.count, 2);

  const q = child(ep, "gw", "query");
  assert.equal(q.totalMicros, 100); // 40 + 60
  assert.equal(q.count, 2);

  // self time = total - children total
  assert.equal(ep.selfMicros, 220 - 100); // 120
  assert.equal(q.selfMicros, 100); // leaf: all self
});

test("same operation under different parents stays distinct", () => {
  // gw GET /x -> auth verify -> redis get ; and gw GET /x -> cart list -> redis get
  const t = [
    s("r", undefined, "gw", "GET /x", 100),
    s("a", "r", "auth", "verify", 30),
    s("ar", "a", "redis", "get", 10),
    s("c", "r", "cart", "list", 40),
    s("cr", "c", "redis", "get", 15),
  ];
  const ep = aggregateFlamegraph([t]).children[0]!;
  const auth = child(ep, "auth", "verify");
  const cart = child(ep, "cart", "list");
  // two separate redis-get nodes, one under each parent (not merged)
  assert.equal(child(auth, "redis", "get").totalMicros, 10);
  assert.equal(child(cart, "redis", "get").totalMicros, 15);
});

test("counts repeated sibling calls within one trace (N+1 shows as a fat node)", () => {
  const t = [
    s("r", undefined, "gw", "GET /x", 100),
    s("q1", "r", "db", "query", 5),
    s("q2", "r", "db", "query", 6),
    s("q3", "r", "db", "query", 7),
  ];
  const q = child(aggregateFlamegraph([t]).children[0]!, "db", "query");
  assert.equal(q.count, 3); // three sibling calls merged into one node
  assert.equal(q.totalMicros, 18);
});

test("a child whose parent isn't in the trace is treated as a root", () => {
  const t = [s("orphan", "missing", "svc", "op", 50)];
  const root = aggregateFlamegraph([t]);
  assert.equal(root.children[0]!.operation, "op");
  assert.equal(root.children[0]!.totalMicros, 50);
});

test("empty input yields an empty synthetic root", () => {
  const root = aggregateFlamegraph([]);
  assert.deepEqual(root.children, []);
});
