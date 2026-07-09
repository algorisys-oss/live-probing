import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useLiveStore } from "../store/use-live-store";
import { dependencyMatrix, cellKey, type MatrixCell } from "../lib/dependency-matrix";
import { formatMicros, isDatastore } from "../lib/format";
import type { Health } from "../lib/topology-health";

type Metric = "calls" | "errors" | "latency";

const CELL = 30; // cell size (px, svg units)
const ROW_LABEL_W = 132; // left gutter for caller names
const COL_LABEL_H = 96; // top area for rotated callee names
const PAD = 8;
const LABEL_MAX = 18; // chars before truncation

const truncate = (s: string) => (s.length > LABEL_MAX ? s.slice(0, LABEL_MAX - 1) + "…" : s);

function cellText(cell: MatrixCell, metric: Metric): string {
  if (metric === "errors") return cell.errors > 0 ? String(cell.errors) : "";
  if (metric === "latency") return formatMicros(cell.avgDurationMicros);
  // calls: compact (1.2k) so a busy cell doesn't overflow.
  const c = cell.calls;
  return c >= 1000 ? `${(c / 1000).toFixed(c < 10000 ? 1 : 0)}k` : String(c);
}

const healthFill: Record<Health, string> = {
  ok: "var(--live)",
  warn: "var(--new)",
  error: "var(--error)",
};

// Filled-cell opacity: color signals health; opacity signals how much traffic rides that edge, so
// a hot dependency reads darker. Relative to the busiest cell in view.
function opacityFor(cell: MatrixCell, maxCalls: number): number {
  return 0.28 + 0.62 * (Math.log(1 + cell.calls) / Math.log(1 + maxCalls));
}

export function DependencyMatrix() {
  const fullTopology = useLiveStore((s) => s.topology);
  const filterService = useLiveStore((s) => s.filterService);
  const navigate = useNavigate();
  const [metric, setMetric] = useState<Metric>("calls");

  // Mirror the flow graph's filter: when a service is selected, keep only the calls touching it.
  const topology = useMemo(() => {
    if (!filterService) return fullTopology;
    const edges = fullTopology.edges.filter((e) => e.from === filterService || e.to === filterService);
    const nodes = [...new Set([filterService, ...edges.flatMap((e) => [e.from, e.to])])];
    return { nodes, edges, externals: fullTopology.externals };
  }, [fullTopology, filterService]);

  const externals = useMemo(() => new Set(topology.externals ?? []), [topology.externals]);
  const m = useMemo(() => dependencyMatrix(topology), [topology]);
  const maxCalls = useMemo(() => Math.max(1, ...m.cells.map((c) => c.calls)), [m.cells]);

  if (m.rows.length === 0 || m.cols.length === 0) {
    return <div className="empty-hint">No service-to-service calls observed yet.</div>;
  }

  const linkable = (id: string) => !isDatastore(id) && !externals.has(id);
  const goto = (id: string) => linkable(id) && navigate(`/service/${encodeURIComponent(id)}`);

  const gridW = ROW_LABEL_W + m.cols.length * CELL + PAD;
  const gridH = COL_LABEL_H + m.rows.length * CELL + PAD;

  return (
    <div className="depmatrix">
      <div className="depmatrix-toolbar">
        <span className="depmatrix-caption">Who calls whom · rows call columns</span>
        <div className="depmatrix-metric" role="group" aria-label="cell metric">
          {(["calls", "errors", "latency"] as Metric[]).map((mm) => (
            <button
              key={mm}
              className={metric === mm ? "seg-btn seg-btn-active" : "seg-btn"}
              onClick={() => setMetric(mm)}
            >
              {mm}
            </button>
          ))}
        </div>
      </div>
      <div className="depmatrix-scroll">
        <svg
          className="depmatrix-svg"
          viewBox={`0 0 ${gridW} ${gridH}`}
          width={gridW}
          height={gridH}
          preserveAspectRatio="xMinYMin meet"
        >
          {/* column headers (callees), rotated up */}
          {m.cols.map((c, ci) => {
            const x = ROW_LABEL_W + ci * CELL + CELL / 2;
            return (
              <text
                key={c}
                className={linkable(c) ? "depmatrix-collabel clickable" : "depmatrix-collabel"}
                x={x}
                y={COL_LABEL_H - 6}
                transform={`rotate(-55 ${x} ${COL_LABEL_H - 6})`}
                onClick={() => goto(c)}
              >
                {truncate(c)}
              </text>
            );
          })}

          {/* row headers (callers) */}
          {m.rows.map((r, ri) => {
            const y = COL_LABEL_H + ri * CELL + CELL / 2;
            return (
              <text
                key={r}
                className={linkable(r) ? "depmatrix-rowlabel clickable" : "depmatrix-rowlabel"}
                x={ROW_LABEL_W - 8}
                y={y + 4}
                textAnchor="end"
                onClick={() => goto(r)}
              >
                {truncate(r)}
              </text>
            );
          })}

          {/* cells */}
          {m.rows.map((r, ri) =>
            m.cols.map((c, ci) => {
              const x = ROW_LABEL_W + ci * CELL;
              const y = COL_LABEL_H + ri * CELL;
              const cell = m.byKey.get(cellKey(r, c));
              if (!cell) {
                // Empty (no call) — a faint slot so the grid structure reads.
                return <rect key={`${r}-${c}`} className="depmatrix-empty" x={x + 1} y={y + 1} width={CELL - 2} height={CELL - 2} rx={3} />;
              }
              const txt = cellText(cell, metric);
              return (
                <g
                  key={`${r}-${c}`}
                  className={linkable(c) ? "depmatrix-cell clickable" : "depmatrix-cell"}
                  onClick={() => goto(c)}
                >
                  <rect
                    x={x + 1}
                    y={y + 1}
                    width={CELL - 2}
                    height={CELL - 2}
                    rx={3}
                    style={{ fill: healthFill[cell.health], opacity: opacityFor(cell, maxCalls) }}
                  />
                  {txt && (
                    <text x={x + CELL / 2} y={y + CELL / 2 + 3} className="depmatrix-cell-text">
                      {txt}
                    </text>
                  )}
                  <title>
                    {r} → {c}: {cell.calls} calls
                    {cell.errors > 0 ? `, ${cell.errors} err (${(cell.errorRate * 100).toFixed(1)}%)` : ""}, avg{" "}
                    {formatMicros(cell.avgDurationMicros)}
                  </title>
                </g>
              );
            }),
          )}
        </svg>
      </div>
      <div className="flow-legend" aria-hidden="true">
        <span className="flow-legend-item"><span className="flow-legend-swatch flow-legend-ok" /> healthy</span>
        <span className="flow-legend-item"><span className="flow-legend-swatch flow-legend-warn" /> slow</span>
        <span className="flow-legend-item"><span className="flow-legend-swatch flow-legend-error" /> errors</span>
        <span className="flow-legend-item depmatrix-legend-note">darker = more traffic</span>
      </div>
    </div>
  );
}
