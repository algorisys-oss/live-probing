import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useLiveStore } from "../store/use-live-store";
import { computeLayout, type LayoutResult } from "../lib/layout";
import { formatMicros, isDatastore } from "../lib/format";
import { copyText, downloadPng, downloadSvg } from "../lib/export-diagram";
import type { Edge } from "../lib/types";

const NODE_W = 132;
const NODE_H = 44;
const PAD = 70;

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

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

// Bounding box that encloses every node, padded — the "fit" view.
function contentBox(positions: Record<string, { x: number; y: number }>, nodes: string[]): Box {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    const p = positions[n];
    if (!p) continue;
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, w: 400, h: 300 };
  return {
    x: minX - NODE_W / 2 - PAD,
    y: minY - NODE_H / 2 - PAD,
    w: maxX - minX + NODE_W + PAD * 2,
    h: maxY - minY + NODE_H + PAD * 2,
  };
}

function NodeShape({ id, x, y, ghost, onClick }: { id: string; x: number; y: number; ghost?: boolean; onClick?: () => void }) {
  const ds = isDatastore(id);
  const left = x - NODE_W / 2;
  const top = y - NODE_H / 2;
  const label = id.length > 16 ? id.slice(0, 15) + "…" : id;
  const nodeClass = ds
    ? "flow-node flow-node-datastore"
    : ghost
      ? "flow-node flow-node-external"
      : "flow-node flow-node-service";
  return (
    <g
      className={onClick ? "flow-node-group clickable" : "flow-node-group"}
      onClick={onClick}
      onMouseDown={onClick ? (e) => e.stopPropagation() : undefined}
    >
      <rect x={left} y={top} width={NODE_W} height={NODE_H} rx={ds ? NODE_H / 2 : 7} className={nodeClass} />
      <text x={x} y={y + 4} className={ghost ? "flow-node-label flow-node-label-external" : "flow-node-label"}>
        {label}
      </text>
    </g>
  );
}

export function FlowView() {
  const fullTopology = useLiveStore((s) => s.topology);
  const filterService = useLiveStore((s) => s.filterService);
  const mermaidFlow = useLiveStore((s) => s.mermaidFlow);
  const navigate = useNavigate();

  // When filtered, show the subgraph around the service: it + its direct neighbors,
  // and only the edges touching it.
  const topology = useMemo(() => {
    if (!filterService) return fullTopology;
    const edges = fullTopology.edges.filter((e) => e.from === filterService || e.to === filterService);
    const nodes = [...new Set([filterService, ...edges.flatMap((e) => [e.from, e.to])])];
    return { nodes, edges, externals: fullTopology.externals };
  }, [fullTopology, filterService]);

  // Uninstrumented "ghost" peers render dashed and aren't clickable (no service page).
  const externals = useMemo(() => new Set(topology.externals ?? []), [topology.externals]);

  // Stable layout: recompute only when the *set* of node ids changes.
  const nodeKey = useMemo(() => [...topology.nodes].sort().join("|"), [topology.nodes]);
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

  const { positions } = layout;
  const half = { w: NODE_W / 2 + 6, h: NODE_H / 2 + 6 };

  // Fit box is stable per node set; the manual view starts there and re-fits when the
  // topology's node set changes (not on every call-count delta).
  const fitBox = useMemo(() => contentBox(positions, topology.nodes), [layout, topology.nodes]);
  const svgRef = useRef<SVGSVGElement>(null);
  const [view, setView] = useState<Box>(fitBox);
  useEffect(() => setView(fitBox), [fitBox]);

  // px-per-svg-unit under preserveAspectRatio="meet" (uniform scale, letterboxed).
  const measure = () => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    const scale = Math.min(rect.width / view.w, rect.height / view.h);
    return { rect, scale, offX: (rect.width - view.w * scale) / 2, offY: (rect.height - view.h * scale) / 2 };
  };

  const zoomAround = (clientX: number, clientY: number, factor: number) => {
    const m = measure();
    if (!m) return;
    const sx = view.x + (clientX - m.rect.left - m.offX) / m.scale;
    const sy = view.y + (clientY - m.rect.top - m.offY) / m.scale;
    setView({ x: sx - (sx - view.x) * factor, y: sy - (sy - view.y) * factor, w: view.w * factor, h: view.h * factor });
  };

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    zoomAround(e.clientX, e.clientY, e.deltaY > 0 ? 1.1 : 0.9);
  };

  const drag = useRef<{ x: number; y: number } | null>(null);
  const onMouseDown = (e: React.MouseEvent) => {
    drag.current = { x: e.clientX, y: e.clientY };
  };
  const onMouseMove = (e: React.MouseEvent) => {
    if (!drag.current) return;
    const m = measure();
    if (!m) return;
    const dx = (e.clientX - drag.current.x) / m.scale;
    const dy = (e.clientY - drag.current.y) / m.scale;
    drag.current = { x: e.clientX, y: e.clientY };
    setView((v) => ({ ...v, x: v.x - dx, y: v.y - dy }));
  };
  const endDrag = () => {
    drag.current = null;
  };
  const zoomButton = (factor: number) => {
    const m = measure();
    const cx = m ? m.rect.left + m.rect.width / 2 : 0;
    const cy = m ? m.rect.top + m.rect.height / 2 : 0;
    zoomAround(cx, cy, factor);
  };

  if (topology.nodes.length === 0) {
    return <div className="empty-hint">Waiting for topology… no services observed yet.</div>;
  }

  const renderEdge = (e: Edge, i: number) => {
    const a = positions[e.from];
    const b = positions[e.to];
    if (!a || !b || e.from === e.to) return null;

    const start = anchor(a, b, half);
    const end = anchor(b, a, half);
    const mx = (start.x + end.x) / 2;
    const my = (start.y + end.y) / 2;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const len = Math.hypot(dx, dy) || 1;
    const bend = Math.min(28, len * 0.12);
    const cx = mx + (-dy / len) * bend;
    const cy = my + (dx / len) * bend;
    const hasError = e.errors > 0;

    return (
      <g key={`${e.from}->${e.to}-${i}`} className="flow-edge-group">
        <path
          d={`M ${start.x} ${start.y} Q ${cx} ${cy} ${end.x} ${end.y}`}
          className={hasError ? "flow-edge flow-edge-error" : "flow-edge"}
          strokeWidth={edgeWidth(e.calls)}
          markerEnd={hasError ? "url(#arrow-error)" : "url(#arrow)"}
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
    <div className="flow-fit">
      <div className="flow-controls">
        <button className="flow-btn" title="Zoom in" onClick={() => zoomButton(0.83)}>
          +
        </button>
        <button className="flow-btn" title="Zoom out" onClick={() => zoomButton(1.2)}>
          −
        </button>
        <button className="flow-btn flow-btn-fit" title="Fit to view" onClick={() => setView(fitBox)}>
          Fit
        </button>
        <span className="flow-ctrl-sep" />
        <button className="flow-btn flow-btn-fit" title="Copy Mermaid" onClick={() => mermaidFlow && copyText(mermaidFlow)}>
          mmd
        </button>
        <button className="flow-btn flow-btn-fit" title="Download SVG" onClick={() => svgRef.current && downloadSvg(svgRef.current, "topology.svg")}>
          svg
        </button>
        <button className="flow-btn flow-btn-fit" title="Download PNG" onClick={() => svgRef.current && downloadPng(svgRef.current, "topology.png")}>
          png
        </button>
      </div>
      <svg
        ref={svgRef}
        className={drag.current ? "flow-svg grabbing" : "flow-svg"}
        width="100%"
        height="100%"
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        preserveAspectRatio="xMidYMid meet"
        onWheel={onWheel}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={endDrag}
        onMouseLeave={endDrag}
      >
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" className="flow-arrow" />
          </marker>
          <marker id="arrow-error" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" className="flow-arrow-error" />
          </marker>
        </defs>

        <g>{topology.edges.map(renderEdge)}</g>
        <g>
          {topology.nodes.map((n) => {
            const p = positions[n];
            if (!p) return null;
            return (
              <NodeShape
                key={n}
                id={n}
                x={p.x}
                y={p.y}
                ghost={externals.has(n)}
                onClick={isDatastore(n) || externals.has(n) ? undefined : () => navigate(`/service/${encodeURIComponent(n)}`)}
              />
            );
          })}
        </g>
      </svg>
    </div>
  );
}
