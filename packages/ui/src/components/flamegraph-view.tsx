import { useState } from "react";
import type { FlameNode } from "../lib/types";
import { formatMicros } from "../lib/format";

const W = 820;
const ROW = 22;
const MIN_W = 0.5; // cull sub-pixel rects (and their subtrees)

// Deterministic color bucket per participant so the same service is the same color across the
// chart. Six theme-neutral hues (mid-tone, legible with white labels in light and dark).
function colorClass(participant: string): string {
  let h = 0;
  for (let i = 0; i < participant.length; i++) h = (h * 31 + participant.charCodeAt(i)) | 0;
  return `flame-c${Math.abs(h) % 6}`;
}

interface Cell {
  node: FlameNode;
  x: number;
  width: number;
  depth: number;
}

// Icicle layout: each node spans [x, x+width]; its children sit one row below, their widths
// proportional to the parent's total, left-aligned — so the uncovered right remainder is the
// parent's self time (the classic flamegraph read).
function layout(node: FlameNode, x: number, width: number, depth: number, out: Cell[]): number {
  if (width < MIN_W) return depth;
  out.push({ node, x, width, depth });
  const total = node.totalMicros || 1;
  let cx = x;
  let maxDepth = depth;
  for (const c of node.children) {
    const cw = width * (c.totalMicros / total);
    maxDepth = Math.max(maxDepth, layout(c, cx, cw, depth + 1, out));
    cx += cw;
  }
  return maxDepth;
}

export function FlamegraphView({ root }: { root: FlameNode }) {
  const [hover, setHover] = useState<FlameNode | null>(null);

  if (root.children.length === 0) return <div className="muted">No spans to aggregate.</div>;

  const cells: Cell[] = [];
  const grand = root.children.reduce((a, c) => a + c.totalMicros, 0) || 1;
  let cx = 0;
  let maxDepth = 0;
  for (const c of root.children) {
    const cw = W * (c.totalMicros / grand);
    maxDepth = Math.max(maxDepth, layout(c, cx, cw, 0, cells));
    cx += cw;
  }
  const H = (maxDepth + 1) * ROW;

  const pct = (n: FlameNode) => Math.round((n.totalMicros / grand) * 100);

  return (
    <div className="flame-wrap">
      <svg className="flame" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
        {cells.map((c, i) => {
          const showLabel = c.width > 44;
          return (
            <g
              key={i}
              className="flame-cell"
              onMouseEnter={() => setHover(c.node)}
              onMouseLeave={() => setHover((h) => (h === c.node ? null : h))}
            >
              <rect
                className={colorClass(c.node.participant)}
                x={c.x + 0.5}
                y={c.depth * ROW}
                width={Math.max(0.5, c.width - 1)}
                height={ROW - 1}
                rx={2}
              >
                <title>
                  {c.node.participant} · {c.node.operation}
                  {"\n"}total {formatMicros(c.node.totalMicros)} · self {formatMicros(c.node.selfMicros)} · {c.node.count} calls ({pct(c.node)}%)
                </title>
              </rect>
              {showLabel && (
                <text className="flame-label" x={c.x + 5} y={c.depth * ROW + ROW / 2 + 3}>
                  {c.node.operation}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <div className="flame-hover muted">
        {hover
          ? `${hover.participant} · ${hover.operation} — total ${formatMicros(hover.totalMicros)}, self ${formatMicros(hover.selfMicros)}, ${hover.count} calls (${pct(hover)}%)`
          : "Hover a block: width = share of total time; the uncovered right of a bar is its self time."}
      </div>
    </div>
  );
}
