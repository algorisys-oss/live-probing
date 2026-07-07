import { useState } from "react";
import type { SpanRow } from "../lib/types";
import { formatMicros, hashString, isDatastore } from "../lib/format";

const LABEL_W = 280; // keep in sync with .wf-label width in styles.css

function serviceColor(name: string): string {
  if (isDatastore(name)) return "var(--datastore)";
  const hue = hashString(name) % 360;
  return `hsl(${hue} 55% 58%)`;
}

export function SpanDetail({ span, traceStart }: { span: SpanRow; traceStart: number }) {
  const attrs = Object.entries(span.attributes).sort((a, b) => a[0].localeCompare(b[0]));
  return (
    <div className="wf-detail">
      <div className="wf-detail-op" title={span.operation}>
        {span.operation}
      </div>
      <div className="wf-detail-meta">
        <span className="chip" style={{ borderColor: serviceColor(span.participant) }}>
          {span.participant}
        </span>
        <span>{span.kind}</span>
        {span.peer && <span>→ {span.peer}</span>}
        {span.status === "error" && <span className="badge badge-error">error</span>}
      </div>
      <div className="wf-detail-rows">
        <div className="wf-kv">
          <span className="wf-k">duration</span>
          <span className="wf-v">{formatMicros(span.duration)}</span>
        </div>
        <div className="wf-kv">
          <span className="wf-k">start +</span>
          <span className="wf-v">{formatMicros(span.startTime - traceStart)}</span>
        </div>
        <div className="wf-kv">
          <span className="wf-k">status</span>
          <span className="wf-v">{span.status}</span>
        </div>
      </div>
      <div className="wf-detail-attrs-title">attributes</div>
      {attrs.length === 0 ? (
        <div className="muted">no attributes</div>
      ) : (
        <div className="wf-detail-rows">
          {attrs.map(([k, v]) => (
            <div className="wf-kv" key={k}>
              <span className="wf-k" title={k}>
                {k}
              </span>
              <span className="wf-v" title={String(v)}>
                {String(v)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Evenly-spaced tick offsets (micros) across the trace duration, for the time axis + grid.
function axisTicks(total: number, count = 4): number[] {
  return Array.from({ length: count + 1 }, (_, i) => (total * i) / count);
}

// Merged time intervals covered by a span's direct children (clipped to the span). The bar's
// solid remainder outside these ranges is the span's self-time.
function childCoverage(spanStart: number, spanEnd: number, children: SpanRow[]): Array<[number, number]> {
  const iv = children
    .map((c): [number, number] => [Math.max(spanStart, c.startTime), Math.min(spanEnd, c.startTime + c.duration)])
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  const merged: Array<[number, number]> = [];
  for (const [a, b] of iv) {
    const last = merged[merged.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else merged.push([a, b]);
  }
  return merged;
}

export function WaterfallView({
  spans = [],
  traceStart,
  traceDuration,
  selectedId,
  onSelect,
  criticalPath = [],
}: {
  spans?: SpanRow[];
  traceStart: number;
  traceDuration: number;
  selectedId: string | null;
  onSelect: (spanId: string) => void;
  criticalPath?: string[];
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  if (spans.length === 0) {
    return (
      <div className="empty-hint">
        Waterfall not available for this trace (recorded before span capture). Try the Sequence tab.
      </div>
    );
  }

  const total = Math.max(traceDuration, 1);
  const ticks = axisTicks(total, 4);
  const criticalSet = new Set(criticalPath);

  // Direct children per span (for self-time shading).
  const childrenByParent = new Map<string, SpanRow[]>();
  for (const s of spans) {
    if (!s.parentSpanId) continue;
    const arr = childrenByParent.get(s.parentSpanId);
    if (arr) arr.push(s);
    else childrenByParent.set(s.parentSpanId, [s]);
  }

  // # of descendants each span hides when collapsed (spans are DFS-ordered, so a node's
  // descendants are the contiguous following rows deeper than it).
  const descCount = spans.map((s, i) => {
    let c = 0;
    for (let j = i + 1; j < spans.length && spans[j]!.depth > s.depth; j++) c++;
    return c;
  });

  // Rows currently visible (a collapsed node hides its whole subtree).
  const visible: Array<{ s: SpanRow; i: number; hasChildren: boolean }> = [];
  let hideDeeperThan = Infinity;
  spans.forEach((s, i) => {
    if (s.depth > hideDeeperThan) return; // inside a collapsed subtree
    hideDeeperThan = Infinity;
    const next = spans[i + 1];
    const hasChildren = !!next && next.depth > s.depth;
    visible.push({ s, i, hasChildren });
    if (hasChildren && collapsed.has(s.spanId)) hideDeeperThan = s.depth;
  });

  const toggle = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setCollapsed((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  return (
    <div className="waterfall">
      {/* time axis, aligned over the track column */}
      <div className="wf-axis">
        <div className="wf-axis-gutter" style={{ width: LABEL_W }}>
          <span className="wf-axis-hint">▚ self-time · ◆ critical path</span>
        </div>
        <div className="wf-axis-track">
          {ticks.map((t, i) => (
            <span
              key={i}
              className="wf-tick-label"
              style={{ left: `${(t / total) * 100}%` }}
            >
              {formatMicros(t)}
            </span>
          ))}
        </div>
      </div>

      <div className="wf-body">
        {/* vertical gridlines behind the rows (x-fixed, so they ignore vertical scroll) */}
        <div className="wf-grid" style={{ left: LABEL_W }}>
          {ticks.map((t, i) => (
            <span key={i} className="wf-gridline" style={{ left: `${(t / total) * 100}%` }} />
          ))}
        </div>

        <div className="wf-rows">
          {visible.map(({ s, i, hasChildren }) => {
            const leftPct = Math.min(100, Math.max(0, ((s.startTime - traceStart) / total) * 100));
            const widthPct = Math.min(100 - leftPct, Math.max(0.4, (s.duration / total) * 100));
            const color = serviceColor(s.participant);
            const error = s.status === "error";
            const critical = criticalSet.has(s.spanId);
            const isCollapsed = collapsed.has(s.spanId);
            const durInside = widthPct > 12;
            const spanEnd = s.startTime + s.duration;
            const coverage = hasChildren
              ? childCoverage(s.startTime, spanEnd, childrenByParent.get(s.spanId) ?? [])
              : [];
            const rowClass = [
              "wf-row",
              s.spanId === selectedId ? "wf-row-selected" : "",
              critical ? "wf-row-critical" : "",
            ]
              .filter(Boolean)
              .join(" ");
            return (
              <div key={s.spanId} className={rowClass} onClick={() => onSelect(s.spanId)}>
                <div className="wf-label" style={{ paddingLeft: 6 + s.depth * 12 }}>
                  {/* depth rails — one vertical guide per ancestor level */}
                  {Array.from({ length: s.depth }).map((_, d) => (
                    <span key={d} className="wf-rail" style={{ left: 6 + d * 12 }} />
                  ))}
                  {hasChildren ? (
                    <button
                      className="wf-toggle"
                      title={isCollapsed ? "Expand subtree" : "Collapse subtree"}
                      onClick={(e) => toggle(s.spanId, e)}
                    >
                      {isCollapsed ? "▸" : "▾"}
                    </button>
                  ) : (
                    <span className="wf-toggle wf-toggle-leaf" />
                  )}
                  {critical && <span className="wf-critical-mark" title="on the critical path">◆</span>}
                  <span className="wf-dot" style={{ background: color }} />
                  <span className="wf-label-op" title={`${s.participant} · ${s.operation}`}>
                    {s.operation}
                  </span>
                  {isCollapsed && descCount[i]! > 0 && (
                    <span className="wf-hidden-count">+{descCount[i]}</span>
                  )}
                </div>
                <div className="wf-track">
                  <div
                    className={
                      ["wf-bar", error ? "wf-bar-error" : "", critical ? "wf-bar-critical" : ""].filter(Boolean).join(" ")
                    }
                    style={{ left: `${leftPct}%`, width: `${widthPct}%`, background: error ? undefined : color }}
                  />
                  {/* self-time shading: overlay the ranges covered by children (the solid remainder is self-time) */}
                  {coverage.map(([a, b], ci) => (
                    <div
                      key={ci}
                      className="wf-bar-childtime"
                      style={{
                        left: `${((a - traceStart) / total) * 100}%`,
                        width: `${((b - a) / total) * 100}%`,
                      }}
                    />
                  ))}
                  <span
                    className="wf-bar-dur"
                    style={durInside ? { left: `${leftPct}%`, right: "auto", marginLeft: 4 } : { left: `${leftPct + widthPct}%`, right: "auto", marginLeft: 4 }}
                  >
                    {formatMicros(s.duration)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
