import { test } from "node:test";
import assert from "node:assert/strict";
import { dependencyMatrix, cellKey } from "./dependency-matrix.js";
import type { Topology } from "./types.js";

const edge = (from: string, to: string, calls: number, errors: number, avgDurationMicros: number) => ({
  from,
  to,
  calls,
  errors,
  avgDurationMicros,
});

test("rows are callers, cols are callees, both sorted; a cell exists only where a call was seen", () => {
  const topo: Topology = {
    nodes: ["gateway", "order", "auth", "postgresql"],
    edges: [
      edge("gateway", "order", 100, 0, 1000),
      edge("gateway", "auth", 100, 0, 1000),
      edge("order", "postgresql", 100, 0, 1000),
    ],
  };
  const m = dependencyMatrix(topo);

  assert.deepEqual(m.rows, ["gateway", "order"]); // only services that make calls
  assert.deepEqual(m.cols, ["auth", "order", "postgresql"]); // only services that receive calls
  assert.ok(m.byKey.get(cellKey("gateway", "order")));
  assert.equal(m.byKey.get(cellKey("gateway", "postgresql")), undefined); // no such call
  assert.equal(m.cells.length, 3);
});

test("cell carries calls / errors / errorRate / latency and reuses topology edge health", () => {
  const topo: Topology = {
    nodes: ["a", "b", "c", "d"],
    edges: [
      edge("a", "b", 100, 8, 1000), // 8% -> error
      edge("a", "c", 100, 2, 1000), // 2% -> warn
      edge("a", "d", 100, 0, 1000), // ok
    ],
  };
  const m = dependencyMatrix(topo);
  const ab = m.byKey.get(cellKey("a", "b"))!;

  assert.equal(ab.calls, 100);
  assert.equal(ab.errors, 8);
  assert.equal(ab.errorRate, 0.08);
  assert.equal(ab.avgDurationMicros, 1000);
  assert.equal(ab.health, "error");
  assert.equal(m.byKey.get(cellKey("a", "c"))!.health, "warn");
  assert.equal(m.byKey.get(cellKey("a", "d"))!.health, "ok");
});

test("latency drives an amber cell (reusing topologyHealth's relative band)", () => {
  // medians of [1000,1000,1000,5000] = 1000; factor 2 -> cutoff 2000.
  const topo: Topology = {
    nodes: ["a", "b", "c", "d", "slow"],
    edges: [
      edge("a", "b", 100, 0, 1000),
      edge("a", "c", 100, 0, 1000),
      edge("a", "d", 100, 0, 1000),
      edge("a", "slow", 100, 0, 5000),
    ],
  };
  const m = dependencyMatrix(topo);
  assert.equal(m.byKey.get(cellKey("a", "slow"))!.health, "warn");
  assert.equal(m.medianLatencyMicros, 1000);
});

test("self-loops are not dependencies and are skipped", () => {
  const topo: Topology = {
    nodes: ["a", "b"],
    edges: [edge("a", "a", 50, 0, 1000), edge("a", "b", 100, 0, 1000)],
  };
  const m = dependencyMatrix(topo);
  assert.deepEqual(m.rows, ["a"]);
  assert.deepEqual(m.cols, ["b"]);
  assert.equal(m.cells.length, 1);
});

test("empty topology yields no rows, cols, or cells", () => {
  const m = dependencyMatrix({ nodes: [], edges: [] });
  assert.deepEqual(m.rows, []);
  assert.deepEqual(m.cols, []);
  assert.deepEqual(m.cells, []);
});

test("thresholds are overridable (a stricter error cutoff reclassifies a cell)", () => {
  const topo: Topology = { nodes: ["a", "b"], edges: [edge("a", "b", 100, 3, 1000)] };
  const strict = dependencyMatrix(topo, { errorRateError: 0.02, errorRateWarn: 0.01, latencyWarnFactor: 2 });
  assert.equal(strict.byKey.get(cellKey("a", "b"))!.health, "error"); // 3% >= 2%
  const loose = dependencyMatrix(topo);
  assert.equal(loose.byKey.get(cellKey("a", "b"))!.health, "warn"); // 3% is only warn at defaults
});
