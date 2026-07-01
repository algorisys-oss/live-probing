import { useMemo, useRef } from "react";
import { useLiveStore } from "../store/use-live-store";
import { computeLayout, type LayoutResult } from "../lib/layout";
import { formatMicros, isDatastore } from "../lib/format";
import type { Edge } from "../lib/types";

const NODE_W = 132;
const NODE_H = 44;

/** Edge stroke width scaled by log(calls). */
function edgeWidth(calls: number): number {
  return 1 + Math.log(1 + Math.max(0, calls)) * 1.4;
}

/** Where a straight line from a-center to b-center exits a's box, roughly. */
function anchor(
  from: { x: number; y: number },
  to: { x: number; y: number },
  half: { w: number; h: number },
): { x: number; y: number } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 0 && dy === 0) return { x: from.x, y: from.y };
  const scaleX = dx !== 0 ? half.w / Math.abs(dx) : Infinity;
  const scaleY = dy !== 0 ? half.h / Math.abs(dy) : Infinity;
  const s = Math.min(scaleX, scaleY);
  return { x: from.x + dx * s, y: from.y + dy * s };
}

function NodeShape({ id, x, y }: { id: string; x: number; y: number }) {
  const ds = isDatastore(id);
  const left = x - NODE_W / 2;
  const top = y - NODE_H / 2;
  const label = id.length > 16 ? id.slice(0, 15) + "…" : id;
  if (ds) {
    return (
      <g>
        <rect
          x={left}
          y={top}
          width={NODE_W}
          height={NODE_H}
          rx={NODE_H / 2}
          className="flow-node flow-node-datastore"
        />
        <text x={x} y={y + 4} className="flow-node-label">
          {label}
        </text>
      </g>
    );
  }
  return (
    <g>
      <rect
        x={left}
        y={top}
        width={NODE_W}
        height={NODE_H}
        rx={7}
        className="flow-node flow-node-service"
      />
      <text x={x} y={y + 4} className="flow-node-label">
        {label}
      </text>
    </g>
  );
}

export function FlowView() {
  const topology = useLiveStore((s) => s.topology);

  // Stable layout: recompute only when the *set* of node ids changes.
  const nodeKey = useMemo(
    () => [...topology.nodes].sort().join("|"),
    [topology.nodes],
  );
  const layoutRef = useRef<{ key: string; result: LayoutResult } | null>(null);
  const layout = useMemo<LayoutResult>(() => {
    if (layoutRef.current && layoutRef.current.key === nodeKey) {
      return layoutRef.current.result;
    }
    const result = computeLayout(topology.nodes, topology.edges);
    layoutRef.current = { key: nodeKey, result };
    return result;
    // Depend on nodeKey only — edges change (call counts) must NOT reflow.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeKey]);

  const { positions, width, height } = layout;
  const half = { w: NODE_W / 2 + 6, h: NODE_H / 2 + 6 };

  if (topology.nodes.length === 0) {
    return (
      <div className="empty-hint">
        Waiting for topology… no services observed yet.
      </div>
    );
  }

  const renderEdge = (e: Edge, i: number) => {
    const a = positions[e.from];
    const b = positions[e.to];
    if (!a || !b) return null;
    if (e.from === e.to) return null;

    const start = anchor(a, b, half);
    const end = anchor(b, a, half);
    // slight curve via quadratic control offset perpendicular to the line
    const mx = (start.x + end.x) / 2;
    const my = (start.y + end.y) / 2;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const bend = Math.min(28, len * 0.12);
    const cx = mx + nx * bend;
    const cy = my + ny * bend;

    const hasError = e.errors > 0;
    return (
      <g key={`${e.from}->${e.to}-${i}`} className="flow-edge-group">
        <path
          d={`M ${start.x} ${start.y} Q ${cx} ${cy} ${end.x} ${end.y}`}
          className={hasError ? "flow-edge flow-edge-error" : "flow-edge"}
          strokeWidth={edgeWidth(e.calls)}
          markerEnd={
            hasError ? "url(#arrow-error)" : "url(#arrow)"
          }
        />
        <g className="flow-edge-label">
          <text x={cx} y={cy - 4}>
            {e.calls}
            {e.errors > 0 ? ` · ${e.errors} err` : ""}
          </text>
          <text x={cx} y={cy + 9} className="flow-edge-sublabel">
            {formatMicros(e.avgDurationMicros)}
          </text>
        </g>
      </g>
    );
  };

  return (
    <div className="flow-scroll">
      <svg
        className="flow-svg"
        width={Math.max(width, 400)}
        height={Math.max(height, 300)}
        viewBox={`0 0 ${Math.max(width, 400)} ${Math.max(height, 300)}`}
      >
        <defs>
          <marker
            id="arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" className="flow-arrow" />
          </marker>
          <marker
            id="arrow-error"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" className="flow-arrow-error" />
          </marker>
        </defs>

        <g>{topology.edges.map(renderEdge)}</g>
        <g>
          {topology.nodes.map((n) => {
            const p = positions[n];
            if (!p) return null;
            return <NodeShape key={n} id={n} x={p.x} y={p.y} />;
          })}
        </g>
      </svg>
    </div>
  );
}
