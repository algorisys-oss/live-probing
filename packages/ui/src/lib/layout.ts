import type { Edge } from "./types";
import { hashString, isDatastore } from "./format";

export interface NodePosition {
  x: number;
  y: number;
}

export type LayoutMap = Record<string, NodePosition>;

export interface LayoutResult {
  positions: LayoutMap;
  width: number;
  height: number;
}

/**
 * Deterministic layered layout with barycenter ordering.
 *
 * - Columns are assigned by role: source nodes (no inbound edges) on the left,
 *   datastores on the right, everything else in the middle by BFS depth.
 * - Within each column, nodes are ordered by the barycenter (mean row) of their
 *   neighbors in the adjacent column, a few down/up sweeps — the classic layered
 *   crossing-reduction pass. This lines children up under their parents, so edges
 *   run mostly straight and the graph packs tighter (much less overlap/whitespace).
 * - Seeded by a hash of the node id, so it stays stable across telemetry deltas
 *   (the layout depends only on the node set + edge structure, not call counts).
 */
export function computeLayout(nodes: string[], edges: Edge[]): LayoutResult {
  const COL_W = 190;
  const ROW_H = 76;
  const MARGIN_X = 80;
  const MARGIN_Y = 56;

  const nodeSet = new Set(nodes);
  const inbound = new Map<string, number>();
  const outAdj = new Map<string, string[]>();
  const inAdj = new Map<string, string[]>();
  for (const n of nodes) {
    inbound.set(n, 0);
    outAdj.set(n, []);
    inAdj.set(n, []);
  }
  for (const e of edges) {
    if (!nodeSet.has(e.from) || !nodeSet.has(e.to)) continue;
    inbound.set(e.to, (inbound.get(e.to) ?? 0) + 1);
    outAdj.get(e.from)!.push(e.to);
    inAdj.get(e.to)!.push(e.from);
  }

  // BFS depth from source nodes to assign a base column.
  const depth = new Map<string, number>();
  const queue: string[] = [];
  for (const n of nodes) {
    if ((inbound.get(n) ?? 0) === 0) {
      depth.set(n, 0);
      queue.push(n);
    }
  }
  while (queue.length > 0) {
    const cur = queue.shift()!;
    const d = depth.get(cur) ?? 0;
    for (const next of outAdj.get(cur) ?? []) {
      if (!depth.has(next) || (depth.get(next) ?? 0) < d + 1) {
        if (!depth.has(next)) queue.push(next);
        depth.set(next, d + 1);
      }
    }
  }

  let maxDepth = 0;
  for (const n of nodes) {
    if (!depth.has(n)) depth.set(n, 1);
    maxDepth = Math.max(maxDepth, depth.get(n)!);
  }

  // Datastores forced to the far-right column.
  const dsColumn = maxDepth + 1;
  const column = new Map<string, number>();
  for (const n of nodes) {
    column.set(n, isDatastore(n) ? dsColumn : depth.get(n)!);
  }

  const byCol = new Map<number, string[]>();
  for (const n of nodes) {
    const c = column.get(n)!;
    if (!byCol.has(c)) byCol.set(c, []);
    byCol.get(c)!.push(n);
  }
  const cols = [...byCol.keys()].sort((a, b) => a - b);

  // Order within each column; seed by hash for a stable starting point.
  const order = new Map<number, string[]>();
  for (const c of cols) order.set(c, [...byCol.get(c)!].sort((a, b) => hashString(a) - hashString(b)));

  const indexMap = (c: number): Map<string, number> => {
    const m = new Map<string, number>();
    (order.get(c) ?? []).forEach((n, i) => m.set(n, i));
    return m;
  };
  const barycenter = (neighbors: string[], idx: Map<string, number>): number | undefined => {
    const vals = neighbors.map((x) => idx.get(x)).filter((v): v is number => v !== undefined);
    if (vals.length === 0) return undefined;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  };
  const reorder = (c: number, neighborCol: number, adj: Map<string, string[]>): void => {
    const idx = indexMap(neighborCol);
    const keyed = (order.get(c) ?? []).map((n, i) => ({ n, i, b: barycenter(adj.get(n) ?? [], idx) ?? i }));
    keyed.sort((p, q) => p.b - q.b || p.i - q.i);
    order.set(c, keyed.map((k) => k.n));
  };

  for (let iter = 0; iter < 4; iter++) {
    for (let ci = 1; ci < cols.length; ci++) reorder(cols[ci]!, cols[ci - 1]!, inAdj); // down
    for (let ci = cols.length - 2; ci >= 0; ci--) reorder(cols[ci]!, cols[ci + 1]!, outAdj); // up
  }

  const positions: LayoutMap = {};
  let maxRows = 1;
  for (const c of cols) {
    const colNodes = order.get(c)!;
    maxRows = Math.max(maxRows, colNodes.length);
    colNodes.forEach((n, i) => {
      positions[n] = { x: MARGIN_X + c * COL_W, y: MARGIN_Y + i * ROW_H };
    });
  }

  // Vertically center each column against the tallest, so rows line up mid-graph.
  const fullHeight = maxRows * ROW_H;
  for (const c of cols) {
    const colNodes = order.get(c)!;
    const offset = (fullHeight - colNodes.length * ROW_H) / 2;
    for (const n of colNodes) positions[n]!.y += offset;
  }

  const maxCol = cols.length > 0 ? cols[cols.length - 1]! : 0;
  const width = MARGIN_X * 2 + maxCol * COL_W;
  const height = MARGIN_Y * 2 + Math.max(0, maxRows - 1) * ROW_H;

  return { positions, width, height };
}
