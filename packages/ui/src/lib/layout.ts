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
 * Deterministic layered + relaxed force layout.
 *
 * - Columns are assigned by role: source nodes (no inbound edges) on the left,
 *   datastores on the right, everything else in the middle by BFS depth.
 * - Within a column, initial y is seeded by a hash of the node id (stable), then
 *   a few fixed iterations of vertical repulsion spread overlapping nodes.
 *
 * Because the layout only depends on the *set* of node ids and the edge
 * structure (not on call counts), callers recompute it only when the node set
 * changes — keeping positions stable across telemetry deltas.
 */
export function computeLayout(nodes: string[], edges: Edge[]): LayoutResult {
  const COL_W = 220;
  const ROW_H = 90;
  const MARGIN_X = 90;
  const MARGIN_Y = 70;

  const nodeSet = new Set(nodes);
  const inbound = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const n of nodes) {
    inbound.set(n, 0);
    adj.set(n, []);
  }
  for (const e of edges) {
    if (!nodeSet.has(e.from) || !nodeSet.has(e.to)) continue;
    inbound.set(e.to, (inbound.get(e.to) ?? 0) + 1);
    adj.get(e.from)!.push(e.to);
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
  // Any node not reached (cycles / all-inbound) starts at depth 1.
  while (queue.length > 0) {
    const cur = queue.shift()!;
    const d = depth.get(cur) ?? 0;
    for (const next of adj.get(cur) ?? []) {
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

  // Datastores forced to the far right column.
  const dsColumn = maxDepth + 1;
  const column = new Map<string, number>();
  for (const n of nodes) {
    column.set(n, isDatastore(n) ? dsColumn : depth.get(n)!);
  }
  const totalCols = dsColumn + 1;

  // Group nodes per column, ordered deterministically by hash for stable rows.
  const byCol = new Map<number, string[]>();
  for (const n of nodes) {
    const c = column.get(n)!;
    if (!byCol.has(c)) byCol.set(c, []);
    byCol.get(c)!.push(n);
  }

  const positions: LayoutMap = {};
  let maxRows = 1;
  for (const [c, colNodes] of byCol) {
    colNodes.sort((a, b) => hashString(a) - hashString(b));
    maxRows = Math.max(maxRows, colNodes.length);
    colNodes.forEach((n, i) => {
      positions[n] = {
        x: MARGIN_X + c * COL_W,
        y: MARGIN_Y + i * ROW_H,
      };
    });
  }

  // Vertically center each column relative to the tallest column.
  const fullHeight = maxRows * ROW_H;
  for (const [, colNodes] of byCol) {
    const colHeight = colNodes.length * ROW_H;
    const offset = (fullHeight - colHeight) / 2;
    for (const n of colNodes) {
      positions[n]!.y += offset;
    }
  }

  const width = MARGIN_X * 2 + Math.max(0, totalCols - 1) * COL_W;
  const height = MARGIN_Y * 2 + Math.max(0, maxRows - 1) * ROW_H;

  return { positions, width, height };
}
