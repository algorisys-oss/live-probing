import { test } from "node:test";
import assert from "node:assert/strict";
import { topologyHealth, DEFAULT_THRESHOLDS } from "./topology-health.js";
import type { Topology } from "./types.js";

const edge = (from: string, to: string, calls: number, errors: number, avgDurationMicros: number) => ({
  from,
  to,
  calls,
  errors,
  avgDurationMicros,
});

test("edge error rate: >=5% is error, >=1% is warn, below is ok", () => {
  const topo: Topology = {
    nodes: ["a", "b", "c", "d"],
    edges: [
      edge("a", "b", 100, 6, 1000), // 6% -> error
      edge("a", "c", 100, 2, 1000), // 2% -> warn
      edge("a", "d", 100, 0, 1000), // 0% -> ok
    ],
  };
  const { edgeHealth } = topologyHealth(topo);
  assert.deepEqual(edgeHealth, ["error", "warn", "ok"]);
});

test("edge latency: >= factor x median is amber, and only ever amber (not red)", () => {
  // medians of [1000, 1000, 1000, 5000] = 1000; factor 2 -> cutoff 2000.
  const topo: Topology = {
    nodes: ["a", "b", "c", "d", "e"],
    edges: [
      edge("a", "b", 100, 0, 1000),
      edge("a", "c", 100, 0, 1000),
      edge("a", "d", 100, 0, 1000),
      edge("a", "e", 100, 0, 5000), // 5x median -> warn
    ],
  };
  const { edgeHealth, medianLatencyMicros } = topologyHealth(topo);
  assert.equal(medianLatencyMicros, 1000);
  assert.deepEqual(edgeHealth, ["ok", "ok", "ok", "warn"]);
});

test("error dominates latency: a slow AND erroring edge is red, not amber", () => {
  const topo: Topology = {
    nodes: ["a", "b", "c"],
    edges: [
      edge("a", "b", 100, 0, 1000),
      edge("a", "c", 100, 10, 9000), // 10% error + very slow -> error wins
    ],
  };
  assert.equal(topologyHealth(topo).edgeHealth[1], "error");
});

test("node health reflects calls INTO the node (points at the culprit)", () => {
  const topo: Topology = {
    nodes: ["gateway", "auth", "redis"],
    edges: [
      edge("gateway", "auth", 100, 8, 1000), // auth is failing (8%)
      edge("auth", "redis", 100, 0, 1000), // redis is fine
    ],
  };
  const { nodeHealth } = topologyHealth(topo);
  assert.equal(nodeHealth["auth"], "error"); // callee lit, not the caller
  assert.equal(nodeHealth["gateway"], "ok"); // no inbound edges -> ok
  assert.equal(nodeHealth["redis"], "ok");
});

test("node error rate aggregates across inbound edges before classifying", () => {
  // Two callers of "svc": 2 + 2 errors over 100 + 100 calls = 2% -> warn, though
  // neither single edge would be red.
  const topo: Topology = {
    nodes: ["x", "y", "svc"],
    edges: [
      edge("x", "svc", 100, 2, 1000),
      edge("y", "svc", 100, 2, 1000),
    ],
  };
  assert.equal(topologyHealth(topo).nodeHealth["svc"], "warn");
});

test("empty / single-edge topology never throws and reports ok", () => {
  assert.deepEqual(topologyHealth({ nodes: [], edges: [] }), {
    edgeHealth: [],
    nodeHealth: {},
    medianLatencyMicros: 0,
  });
  const one = topologyHealth({ nodes: ["a", "b"], edges: [edge("a", "b", 5, 0, 1000)] });
  assert.equal(one.edgeHealth[0], "ok"); // single edge: no latency spread to flag
  assert.equal(one.nodeHealth["b"], "ok");
});

test("thresholds are overridable", () => {
  const topo: Topology = { nodes: ["a", "b"], edges: [edge("a", "b", 100, 3, 1000)] };
  assert.equal(topologyHealth(topo).edgeHealth[0], "warn"); // 3% default
  assert.equal(
    topologyHealth(topo, { ...DEFAULT_THRESHOLDS, errorRateError: 0.02 }).edgeHealth[0],
    "error", // 3% >= 2%
  );
});
